import https from "https";
import http from "http";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"
};

function requestText(url, options = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === "https:" ? https : http;
        const timeoutMs = Number(options.timeoutMs) || 0;
        const req = lib.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === "https:" ? 443 : 80),
                path: u.pathname + u.search,
                method: options.method || "GET",
                headers: options.headers || {},
                agent: u.protocol === "https:" ? insecureAgent : undefined
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        headers: res.headers,
                        url,
                        text: async () => data,
                        json: async () => JSON.parse(data || "{}")
                    });
                });
            }
        );
        req.on("error", reject);
        if (timeoutMs > 0) {
            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`Таймаут ${timeoutMs}мс: ${u.hostname}`));
            });
        }
        if (options.body) req.write(options.body);
        req.end();
    });
}

/**
 * fetch-подобный запрос с поддержкой нестандартных SSL (НСПД).
 */
export async function httpsFetch(url, options = {}) {
    const u = new URL(url);
    if (u.protocol === "https:") {
        return requestText(url, options);
    }
    return fetch(url, options);
}

function absorbSetCookie(headers, cookieJar) {
    if (!cookieJar || !headers?.["set-cookie"]) return;
    const list = Array.isArray(headers["set-cookie"]) ? headers["set-cookie"] : [headers["set-cookie"]];
    for (const line of list) {
        const part = String(line).split(";")[0];
        const eq = part.indexOf("=");
        if (eq > 0) {
            cookieJar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
        }
    }
}

function cookieHeader(cookieJar) {
    if (!cookieJar?.size) return "";
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * HTTPS-запрос с редиректами и cookie-jar (для kadbase.ru и подобных).
 */
/**
 * Бинарная загрузка (изображения и т.п.).
 */
export function httpsFetchBuffer(url, options = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === "https:" ? https : http;
        const req = lib.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === "https:" ? 443 : 80),
                path: u.pathname + u.search,
                method: options.method || "GET",
                headers: options.headers || {},
                agent: u.protocol === "https:" ? insecureAgent : undefined
            },
            (res) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        headers: res.headers,
                        buffer: Buffer.concat(chunks)
                    });
                });
            }
        );
        req.on("error", reject);
        req.end();
    });
}

export async function httpsFetchFollow(url, options = {}) {
    const maxRedirects = options.maxRedirects ?? 5;
    const cookieJar = options.cookieJar ?? null;
    let currentUrl = url;
    let method = options.method || "GET";
    let body = options.body;

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const headers = { ...(options.headers || {}) };
        const cookies = cookieHeader(cookieJar);
        if (cookies) headers.Cookie = cookies;
        if (body != null && headers["Content-Length"] == null) {
            headers["Content-Length"] = String(Buffer.byteLength(body));
        }

        const res = await requestText(currentUrl, { method, headers, body });
        absorbSetCookie(res.headers, cookieJar);

        const isRedirect = res.status >= 300 && res.status < 400 && res.headers?.location;
        if (isRedirect && hop < maxRedirects) {
            currentUrl = new URL(res.headers.location, currentUrl).href;
            if (method === "POST" && (res.status === 302 || res.status === 303)) {
                method = "GET";
                body = undefined;
            }
            continue;
        }

        return { ...res, finalUrl: currentUrl };
    }

    throw new Error("Слишком много редиректов");
}
