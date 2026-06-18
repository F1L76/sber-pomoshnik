/**
 * Клиент API конвертера: «пробуждение» Render free tier и повтор при HTTP 503.
 */
(function (global) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function wakeZalogServer(apiBase, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 25;
        const delayMs = opts.delayMs ?? 3000;
        const onProgress = opts.onProgress;

        let lastStatus = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const res = await fetch(`${apiBase}/api/zalog/health`, { cache: "no-store" });
                lastStatus = res.status;
                if (res.ok) {
                    const data = await res.json();
                    if (data.pythonDepsOk === false) {
                        throw new Error(
                            data.pythonDepsError ||
                                "На сервере не установлены Python-модули конвертера. Подождите 1–2 минуты после деплоя."
                        );
                    }
                    if (data.ok) return data;
                }
            } catch (e) {
                if (attempt === maxAttempts && !/просыпается|503/i.test(String(e.message))) {
                    throw e;
                }
            }
            if (onProgress) onProgress(attempt, maxAttempts, lastStatus);
            if (attempt < maxAttempts) await sleep(delayMs);
        }
        throw new Error(
            "Сервер на Render не ответил вовремя (бесплатный тариф «засыпает»). Подождите 30–60 секунд и нажмите «Конвертировать» снова."
        );
    }

    async function postZalogConvert(apiBase, pdfFile, xlsxFile, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 4;
        const retryDelayMs = opts.retryDelayMs ?? 15000;
        const onRetry = opts.onRetry;

        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                if (onRetry) onRetry(attempt, maxAttempts);
                await sleep(retryDelayMs);
                await wakeZalogServer(apiBase, { maxAttempts: 10, delayMs: 3000 });
            }

            const formData = new FormData();
            formData.append("pdf", pdfFile);
            formData.append("xlsx", xlsxFile);

            try {
                const res = await fetch(`${apiBase}/api/zalog/convert`, { method: "POST", body: formData });
                const raw = await res.text();
                let payload = {};
                try {
                    payload = raw ? JSON.parse(raw) : {};
                } catch {
                    if (res.status === 503) {
                        lastErr = new Error("Сервер просыпается (Render HTTP 503)…");
                        continue;
                    }
                    throw new Error(
                        res.status === 502 || res.status === 504
                            ? "Таймаут сервера при конвертации. Попробуйте файлы меньшего размера или повторите позже."
                            : `Ошибка конвертера (HTTP ${res.status})`
                    );
                }
                if (!res.ok) {
                    if (res.status === 503 && attempt < maxAttempts) {
                        lastErr = new Error(payload.error || "Сервис временно недоступен (HTTP 503)");
                        continue;
                    }
                    throw new Error(payload.error || `Ошибка конвертера (HTTP ${res.status})`);
                }
                return payload;
            } catch (e) {
                lastErr = e;
                if (attempt < maxAttempts && /503|просыпается|недоступен|Service Unavailable/i.test(String(e.message))) {
                    continue;
                }
                throw e;
            }
        }
        throw lastErr || new Error("Не удалось выполнить конвертацию после нескольких попыток");
    }

    global.ZalogApiClient = { wakeZalogServer, postZalogConvert, sleep };
})(typeof globalThis !== "undefined" ? globalThis : window);
