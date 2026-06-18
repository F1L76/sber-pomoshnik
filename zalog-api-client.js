/**
 * Клиент API конвертера: пробуждение Render free tier и повтор при HTTP 503.
 */
(function (global) {
    const VERSION = 2;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function withCacheBust(url) {
        const sep = url.includes("?") ? "&" : "?";
        return `${url}${sep}_=${Date.now()}`;
    }

    async function fetchNoCache(url, options) {
        const opts = options || {};
        const timeoutMs = opts.timeoutMs ?? 120_000;
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        let timer;
        if (controller && timeoutMs > 0) {
            timer = setTimeout(() => controller.abort(), timeoutMs);
        }
        try {
            return await fetch(withCacheBust(url), {
                method: opts.method || "GET",
                body: opts.body,
                cache: "no-store",
                signal: controller?.signal,
                headers: {
                    "Cache-Control": "no-cache, no-store",
                    Pragma: "no-cache",
                    ...(opts.headers || {})
                }
            });
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function isRetryableHttp(status) {
        return status === 502 || status === 503 || status === 504;
    }

    /** Быстрый ping — будит Render без проверки Python. */
    async function pingZalogServer(apiBase) {
        const res = await fetchNoCache(`${apiBase}/api/zalog/ping`, { timeoutMs: 45_000 });
        return res.ok;
    }

    async function wakeZalogServer(apiBase, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 40;
        const delayMs = opts.delayMs ?? 3000;
        const onProgress = opts.onProgress;

        let lastStatus = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await pingZalogServer(apiBase).catch(() => false);
                const res = await fetchNoCache(`${apiBase}/api/zalog/health`, { timeoutMs: 45_000 });
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
                } else if (!isRetryableHttp(res.status) && res.status >= 400) {
                    throw new Error(`Сервер ответил HTTP ${res.status}`);
                }
            } catch (e) {
                if (attempt === maxAttempts && !isRetryableHttp(lastStatus)) {
                    throw e;
                }
            }
            if (onProgress) onProgress(attempt, maxAttempts, lastStatus);
            if (attempt < maxAttempts) await sleep(delayMs);
        }
        throw new Error(
            "Сервер на Render не успел проснуться за 2 минуты. Подождите минуту и нажмите «Конвертировать» ещё раз."
        );
    }

    async function postZalogConvert(apiBase, pdfFile, xlsxFile, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 8;
        const retryDelayMs = opts.retryDelayMs ?? 12_000;
        const onRetry = opts.onRetry;
        const onProgress = opts.onProgress;

        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (onProgress) onProgress(attempt, maxAttempts);
            if (attempt > 1 && onRetry) onRetry(attempt, maxAttempts);

            if (attempt > 1) await sleep(retryDelayMs);

            try {
                await wakeZalogServer(apiBase, {
                    maxAttempts: attempt === 1 ? 40 : 20,
                    delayMs: 3000,
                    onProgress(tryNum, max, status) {
                        if (onProgress) onProgress(attempt, maxAttempts, tryNum, max, status);
                    }
                });
                await sleep(1500);

                const formData = new FormData();
                formData.append("pdf", pdfFile);
                formData.append("xlsx", xlsxFile);

                const res = await fetchNoCache(`${apiBase}/api/zalog/convert`, {
                    method: "POST",
                    body: formData,
                    timeoutMs: 180_000
                });
                const raw = await res.text();
                let payload = {};
                try {
                    payload = raw ? JSON.parse(raw) : {};
                } catch {
                    if (isRetryableHttp(res.status) && attempt < maxAttempts) {
                        lastErr = new Error(`Сервер Render ещё не готов (HTTP ${res.status})`);
                        continue;
                    }
                    throw new Error(
                        isRetryableHttp(res.status)
                            ? "Сервер Render не ответил вовремя. Подождите минуту и повторите."
                            : `Ошибка конвертера (HTTP ${res.status})`
                    );
                }
                if (!res.ok) {
                    if (isRetryableHttp(res.status) && attempt < maxAttempts) {
                        lastErr = new Error(payload.error || `Сервис временно недоступен (HTTP ${res.status})`);
                        continue;
                    }
                    throw new Error(payload.error || `Ошибка конвертера (HTTP ${res.status})`);
                }
                return payload;
            } catch (e) {
                lastErr = e;
                const msg = String(e.message || e);
                const aborted = e.name === "AbortError";
                const retryable =
                    aborted ||
                    isRetryableHttp(lastErr.status) ||
                    /503|502|504|просыпается|недоступен|Render|aborted|network/i.test(msg);
                if (attempt < maxAttempts && retryable) continue;
                throw e;
            }
        }
        throw (
            lastErr ||
            new Error("Не удалось выполнить конвертацию. Подождите минуту и повторите.")
        );
    }

    global.ZalogApiClient = { VERSION, wakeZalogServer, postZalogConvert, pingZalogServer, sleep };
})(typeof globalThis !== "undefined" ? globalThis : window);
