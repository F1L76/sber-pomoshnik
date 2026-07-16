#!/usr/bin/env node
/**
 * Edge-прокси НСПД для запуска в РФ (домашний Mac / VPS).
 *
 * Зачем: Render и другие зарубежные IP часто не достучаться до nspd.gov.ru.
 * Схема (бесплатно, если ПК уже в РФ):
 *   1) на машине в РФ:  node scripts/nspd-edge-proxy.mjs
 *   2) туннель:         npx cloudflared tunnel --url http://127.0.0.1:8791
 *   3) на Render в env:  NSPD_BASES=https://xxxx.trycloudflare.com
 *                      NSPD_PROXY_KEY=<тот же ключ, что на edge-прокси>
 *
 * Публичные «бесплатные прокси из интернета» для .gov.ru обычно не работают.
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
const TIMEOUT_MS = Number(process.env.NSPD_EDGE_TIMEOUT_MS) || 12_000;
const PROXY_KEY = String(process.env.NSPD_PROXY_KEY || "").trim();

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

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

function fetchUpstream(base, reqPath, method, headers, body) {
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
                    Referer: "https://nspd.gov.ru/map?thematic=PKK",
                    Origin: "https://nspd.gov.ru"
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

function looksLikeNspdJson(buf) {
    const s = buf.toString("utf8", 0, Math.min(buf.length, 200)).trim();
    if (!s || s === "OK") return false;
    return s.startsWith("{") || s.startsWith("[");
}

async function proxyRequest(reqPath, method, headers, body) {
    const errors = [];
    for (const base of UPSTREAMS) {
        try {
            const out = await fetchUpstream(base, reqPath, method, headers, body);
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

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
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
        res.end(JSON.stringify({ ok: true, role: "nspd-edge-proxy", upstreams: UPSTREAMS }));
        return;
    }

    if (!req.url?.startsWith("/api/")) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Only /api/* is proxied to НСПД");
        return;
    }

    try {
        const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : null;
        const fwdHeaders = {
            Accept: req.headers.accept || "application/json, text/plain, */*",
            "User-Agent":
                req.headers["user-agent"] ||
                "Mozilla/5.0 (compatible; sber-pomoshnik-nspd-edge/1.0)",
            "Accept-Language": "ru-RU,ru;q=0.9"
        };
        if (body?.length) {
            fwdHeaders["Content-Type"] = req.headers["content-type"] || "application/json";
            fwdHeaders["Content-Length"] = String(body.length);
        }

        const out = await proxyRequest(req.url, req.method || "GET", fwdHeaders, body);
        const skip = new Set(["transfer-encoding", "connection", "keep-alive", "content-encoding"]);
        const headers = {};
        for (const [k, v] of Object.entries(out.headers || {})) {
            if (!skip.has(k.toLowerCase()) && v != null) headers[k] = v;
        }
        headers["X-NSPD-Upstream"] = out.host;
        res.writeHead(out.status, headers);
        res.end(out.body);
    } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: e.message || String(e) }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`NSPD edge proxy: http://${HOST}:${PORT}`);
    console.log(`Upstreams: ${UPSTREAMS.join(", ")}`);
    if (PROXY_KEY) {
        console.log("Auth: NSPD_PROXY_KEY задан — клиенты шлют X-NSPD-Proxy-Key или Authorization: Bearer");
    } else {
        console.warn("ВНИМАНИЕ: NSPD_PROXY_KEY не задан — прокси открыт (задайте ключ перед туннелем)");
    }
    console.log("Дальше (бесплатный туннель): npx cloudflared tunnel --url http://127.0.0.1:" + PORT);
    console.log("На Render: NSPD_BASES=<url из cloudflared>, NSPD_PROXY_KEY=<тот же ключ>");
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    // server already started
}
