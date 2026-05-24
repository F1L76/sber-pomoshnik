/**
 * Локальный прокси GigaChat для «СберБизнес Помощник».
 * Запуск: скопируйте .env.example → .env, укажите GIGACHAT_CREDENTIALS, затем node gigachat-proxy.mjs
 *
 * Важно по токенам (как в инструкции Сбера, POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth ):
 * — GIGACHAT_CREDENTIALS (Authorization Key / Basic) хранится в .env долго — это не «токен на 30 минут».
 * — Краткоживущий access_token (~30 мин) выдаётся OAuth и нужен только для запросов к API чата.
 * — Прокси сам запрашивает новый access_token до истечения срока (кеш + минута запаса) и при ошибке 401 у чата.
 */
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0";
const OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i === -1) continue;
        const key = t.slice(0, i).trim();
        let val = t.slice(i + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

loadEnvFile();

/** Кеш access_token (Bearer), не путать с GIGACHAT_CREDENTIALS в .env */
let tokenCache = { access_token: null, expires_at: 0 };

function invalidateTokenCache() {
    tokenCache = { access_token: null, expires_at: 0 };
}

function requestJson(url, options, body) {
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
                agent: u.protocol === "https:" ? httpsAgent : undefined
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    try {
                        resolve({ status: res.statusCode, json: JSON.parse(data || "{}"), raw: data });
                    } catch {
                        resolve({ status: res.statusCode, json: {}, raw: data });
                    }
                });
            }
        );
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getAccessToken() {
    const credentials = process.env.GIGACHAT_CREDENTIALS;
    if (!credentials) {
        throw new Error("Не задан GIGACHAT_CREDENTIALS в файле .env");
    }
    if (tokenCache.access_token && Date.now() < tokenCache.expires_at - 60_000) {
        return tokenCache.access_token;
    }
    const scope = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";
    const body = new URLSearchParams({ scope }).toString();
    const { status, json } = await requestJson(OAUTH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Basic ${credentials}`,
            RqUID: crypto.randomUUID()
        }
    }, body);

    if (status !== 200 || !json.access_token) {
        throw new Error(json.message || json.error_description || `OAuth ошибка HTTP ${status}`);
    }
    // Ответ может содержать expires_at (unix s) или expires_in (секунды ответа от OAuth)
    let expiresMs;
    if (json.expires_at != null && !isNaN(Number(json.expires_at))) {
        expiresMs = Number(json.expires_at) * 1000 - Date.now();
    }
    if (expiresMs == null || expiresMs <= 0) {
        expiresMs = (json.expires_in != null && !isNaN(Number(json.expires_in)) ? Number(json.expires_in) : 1800) * 1000;
    }
    tokenCache = {
        access_token: json.access_token,
        expires_at: Date.now() + expiresMs
    };
    return tokenCache.access_token;
}

async function chatCompletion(messages, opts, alreadyRetried) {
    opts = opts || {};
    const token = await getAccessToken();
    const model = process.env.GIGACHAT_MODEL || "GigaChat";
    const payload = JSON.stringify({
        model,
        messages,
        temperature: opts.temperature != null ? Number(opts.temperature) : 0.35,
        max_tokens: opts.max_tokens != null ? Number(opts.max_tokens) : 4096
    });
    const { status, json, raw } = await requestJson(CHAT_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`
        }
    }, payload);

    // Токен мог истечь раньше кеша — один раз пробуем свежий OAuth
    if (status === 401 && !alreadyRetried) {
        invalidateTokenCache();
        return chatCompletion(messages, opts, true);
    }

    if (status !== 200) {
        throw new Error(json.message || json.error?.message || raw || `Chat HTTP ${status}`);
    }
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Пустой ответ GigaChat");
    return content;
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf"
};

function serveStatic(req, res, filePath) {
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end();
        return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/api/gigachat/health") {
        const hasCreds = Boolean(process.env.GIGACHAT_CREDENTIALS);
        let ok = false;
        let error = null;
        if (hasCreds) {
            try {
                await getAccessToken();
                ok = true;
            } catch (e) {
                error = e.message;
            }
        } else {
            error = "Нет GIGACHAT_CREDENTIALS в .env";
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok, hasCreds, error, model: process.env.GIGACHAT_MODEL || "GigaChat" }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/gigachat/chat") {
        try {
            const raw = await readBody(req);
            const body = JSON.parse(raw || "{}");
            const systemPrompt = body.systemPrompt || "Ты AI-ассистент СберБизнес Помощник по сопровождению залогов и экспертизы. Отвечай кратко и по делу на русском языке.";
            const userPrompt = body.userPrompt || body.prompt;
            if (!userPrompt) {
                res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ error: "userPrompt обязателен" }));
                return;
            }
            const content = await chatCompletion(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                {
                    temperature: body.temperature,
                    max_tokens: body.max_tokens
                }
            );
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ content }));
        } catch (e) {
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: e.message || String(e) }));
        }
        return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
        const index = path.join(__dirname, "С распознаванием.html");
        serveStatic(req, res, index);
        return;
    }

    if (req.method === "GET") {
        const safe = path.normalize(path.join(__dirname, decodeURIComponent(url.pathname)));
        serveStatic(req, res, safe);
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, HOST, () => {
    console.log(`GigaChat proxy: http://${HOST}:${PORT}`);
    console.log(`Откройте: http://localhost:${PORT}/ (локально) или URL вашего сервера`);
    if (!process.env.GIGACHAT_CREDENTIALS) {
        console.warn("⚠ Создайте .env из .env.example и укажите GIGACHAT_CREDENTIALS");
    }
});
