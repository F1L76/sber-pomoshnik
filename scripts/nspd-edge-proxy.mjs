#!/usr/bin/env node
/**
 * Edge-прокси НСПД (+ наш.дом.рф + Авто.ру История) для запуска в РФ (VPS / Mac).
 *
 * Зачем: Render (Frankfurt) часто не достучаться до nspd.gov.ru и дом.рф (403).
 * Прод: deploy/ru-edge на Linux VPS в РФ + Cloudflare named tunnel (не Pinggy/Mac).
 *   1) node nspd-edge-proxy.mjs  (или systemd из deploy/ru-edge)
 *   2) HTTPS наружу: cloudflared tunnel run …  → стабильный URL
 *   3) Render: NSPD_BASES=<HTTPS edge>, NSPD_PROXY_KEY=<тот же ключ>
 *      дом.рф: Digital Core ходит на ${NSPD_BASES}/domrf/… (тот же ключ)
 *
 * Авто.ру с Render: POST /autoru/vin-report {"vin_or_license_plate":"А123АА77"}
 */
import http from "http";
import https from "https";
import { fileURLToPath } from "url";

const PORT = Number(process.env.NSPD_EDGE_PORT) || 8791;
const HOST = process.env.NSPD_EDGE_HOST || "127.0.0.1";
const UPSTREAMS = (process.env.NSPD_UPSTREAMS || "https://nspd.gov.ru,https://nspd.rosreestr.gov.ru")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
const DOMRF_UPSTREAM = String(
    process.env.DOMRF_UPSTREAM || "https://xn--80az8a.xn--d1aqf.xn--p1ai"
).replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.NSPD_EDGE_TIMEOUT_MS) || 12_000;
const PROXY_KEY = String(process.env.NSPD_PROXY_KEY || "").trim();

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/** Strip /domrf prefix → upstream path (+query). Exported for self-check. */
export function domrfUpstreamPath(urlPath) {
    const raw = String(urlPath || "");
    if (raw === "/domrf") return "/";
    if (raw.startsWith("/domrf/")) return raw.slice("/domrf".length) || "/";
    return null;
}

function extractProxyKey(req) {
    const direct = String(req.headers["x-nspd-proxy-key"] || "").trim();
    if (direct) return direct;
    const auth = String(req.headers.authorization || "");
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : "";
}

function isAuthorized(req) {
    if (!PROXY_KEY) return true;
    return extractProxyKey(req) === PROXY_KEY;
}

function fetchUpstream(base, reqPath, method, headers, body, siteHeaders) {
    return new Promise((resolve, reject) => {
        const u = new URL(base + reqPath);
        const lib = u.protocol === "https:" ? https : http;
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            req.destroy();
            reject(new Error(`timeout ${u.hostname}`));
        }, TIMEOUT_MS);

        const req = lib.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === "https:" ? 443 : 80),
                path: u.pathname + u.search,
                method,
                headers: {
                    ...headers,
                    host: u.hostname,
                    ...siteHeaders
                },
                agent: u.protocol === "https:" ? insecureAgent : undefined
            },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on("end", () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve({
                        status: res.statusCode || 502,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                        host: u.hostname
                    });
                });
            }
        );
        req.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
        if (body?.length) req.write(body);
        req.end();
    });
}

const NSPD_SITE = {
    Referer: "https://nspd.gov.ru/map?thematic=PKK",
    Origin: "https://nspd.gov.ru"
};
const DOMRF_SITE = {
    Referer: `${DOMRF_UPSTREAM}/`,
    Origin: DOMRF_UPSTREAM
};

function looksLikeNspdJson(buf) {
    const s = buf.toString("utf8", 0, Math.min(buf.length, 200)).trim();
    if (!s || s === "OK") return false;
    return s.startsWith("{") || s.startsWith("[");
}

async function proxyRequest(reqPath, method, headers, body) {
    const errors = [];
    for (const base of UPSTREAMS) {
        try {
            const out = await fetchUpstream(base, reqPath, method, headers, body, NSPD_SITE);
            // пустой 200/"OK" — битый хост, пробуем следующий
            if (out.status === 200 && !looksLikeNspdJson(out.body)) {
                errors.push(`${out.host}: empty/OK body`);
                continue;
            }
            if (out.status >= 200 && out.status < 500) return out;
            errors.push(`${out.host}: HTTP ${out.status}`);
        } catch (e) {
            errors.push(`${base}: ${e.message || e}`);
        }
    }
    throw new Error(errors.join("; ") || "no upstream");
}

async function proxyDomrf(reqPath, method, headers, body) {
    const out = await fetchUpstream(DOMRF_UPSTREAM, reqPath, method, headers, body, DOMRF_SITE);
    if (out.status >= 500) throw new Error(`${out.host}: HTTP ${out.status}`);
    return out;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

const AUTORU_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function cookieFromSetCookie(setCookieList) {
    const parts = [];
    let csrf = null;
    for (const raw of setCookieList || []) {
        const nv = String(raw).split(";")[0]?.trim();
        if (!nv || !nv.includes("=")) continue;
        parts.push(nv);
        const m = nv.match(/^_csrf_token=(.*)$/);
        if (m) csrf = m[1];
    }
    return { cookie: parts.join("; "), csrf };
}

/** Бесплатное превью отчёта Авто.ру (тот же ajax, что в vin_checker/autoru.py). */
async function autoruVinReport(query) {
    const warm = await fetch("https://auto.ru/history/", {
        headers: {
            "User-Agent": AUTORU_UA,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "ru-RU,ru;q=0.9"
        },
        redirect: "follow"
    });
    const setCookies =
        typeof warm.headers.getSetCookie === "function"
            ? warm.headers.getSetCookie()
            : warm.headers.get("set-cookie")
              ? [warm.headers.get("set-cookie")]
              : [];
    const { cookie, csrf } = cookieFromSetCookie(setCookies);
    if (!csrf) {
        throw new Error("Не удалось получить CSRF auto.ru на edge");
    }
    await warm.arrayBuffer().catch(() => null);

    const resp = await fetch("https://auto.ru/-/ajax/desktop/getRichVinReport/", {
        method: "POST",
        headers: {
            "User-Agent": AUTORU_UA,
            "Content-Type": "application/json;charset=UTF-8",
            Accept: "*/*",
            Origin: "https://auto.ru",
            Referer: "https://auto.ru/history/",
            "x-csrf-token": csrf,
            Cookie: cookie
        },
        body: JSON.stringify({ vin_or_license_plate: query })
    });
    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`Авто.ру HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (!isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Unauthorized: invalid or missing NSPD proxy key" }));
        return;
    }

    if (req.url === "/health" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
            JSON.stringify({
                ok: true,
                role: "nspd-edge-proxy",
                upstreams: UPSTREAMS,
                domrf: DOMRF_UPSTREAM,
                routes: ["/api/*", "/domrf/*", "POST /autoru/vin-report"]
            })
        );
        return;
    }

    // ponytail: тот же туннель, что для НСПД — Render иначе без CSRF auto.ru
    if (req.method === "POST" && req.url?.startsWith("/autoru/vin-report")) {
        try {
            const raw = await readBody(req);
            const body = JSON.parse(raw.toString("utf8") || "{}");
            const query = String(body.vin_or_license_plate || body.plate || "").trim();
            if (!query) {
                res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: "Укажите vin_or_license_plate" }));
                return;
            }
            const payload = await autoruVinReport(query);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(payload));
        } catch (e) {
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: e.message || String(e) }));
        }
        return;
    }

    // ponytail: never forward client UA (curl/bot → дом.рф 403)
    const fwdHeadersBase = () => ({
        Accept: req.headers.accept || "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; sber-pomoshnik-nspd-edge/1.0)",
        "Accept-Language": "ru-RU,ru;q=0.9"
    });

    const writeProxy = (out) => {
        const skip = new Set(["transfer-encoding", "connection", "keep-alive", "content-encoding"]);
        const headers = {};
        for (const [k, v] of Object.entries(out.headers || {})) {
            if (!skip.has(k.toLowerCase()) && v != null) headers[k] = v;
        }
        headers["X-NSPD-Upstream"] = out.host;
        res.writeHead(out.status, headers);
        res.end(out.body);
    };

    // наш.дом.рф: GET/HEAD /domrf/<path> → DOMRF_UPSTREAM/<path>
    const domrfPath = domrfUpstreamPath(req.url?.split("#")[0] || "");
    if (domrfPath != null) {
        try {
            const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : null;
            const fwdHeaders = fwdHeadersBase();
            if (body?.length) {
                fwdHeaders["Content-Type"] = req.headers["content-type"] || "application/json";
                fwdHeaders["Content-Length"] = String(body.length);
            }
            writeProxy(await proxyDomrf(domrfPath, req.method || "GET", fwdHeaders, body));
        } catch (e) {
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: e.message || String(e) }));
        }
        return;
    }

    if (!req.url?.startsWith("/api/")) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Only /api/* (НСПД), /domrf/* (дом.рф), POST /autoru/vin-report");
        return;
    }

    try {
        const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : null;
        const fwdHeaders = fwdHeadersBase();
        if (body?.length) {
            fwdHeaders["Content-Type"] = req.headers["content-type"] || "application/json";
            fwdHeaders["Content-Length"] = String(body.length);
        }

        writeProxy(await proxyRequest(req.url, req.method || "GET", fwdHeaders, body));
    } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: e.message || String(e) }));
    }
});

const isMain =
    Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
    server.listen(PORT, HOST, () => {
        console.log(`NSPD edge proxy: http://${HOST}:${PORT}`);
        console.log(`Upstreams: ${UPSTREAMS.join(", ")}`);
        console.log(`дом.рф: ${DOMRF_UPSTREAM} via /domrf/*`);
        if (PROXY_KEY) {
            console.log(
                "Auth: NSPD_PROXY_KEY задан — клиенты шлют X-NSPD-Proxy-Key или Authorization: Bearer"
            );
        } else {
            console.warn(
                "ВНИМАНИЕ: NSPD_PROXY_KEY не задан — прокси открыт (задайте ключ перед туннелем)"
            );
        }
        console.log("Прод: deploy/ru-edge (systemd + Cloudflare named tunnel)");
        console.log("На Render: NSPD_BASES=<HTTPS edge>, NSPD_PROXY_KEY=<тот же ключ>");
    });
}
