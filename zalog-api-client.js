/**
 * Клиент API конвертера: пробуждение Render и асинхронная конвертация (202 + poll).
 */
(function (global) {
    const VERSION = 3;
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

    async function pingZalogServer(apiBase) {
        const res = await fetchNoCache(`${apiBase}/api/zalog/ping`, { timeoutMs: 60_000 });
        return res.ok;
    }

    async function wakeZalogServer(apiBase, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 45;
        const delayMs = opts.delayMs ?? 2000;
        const onProgress = opts.onProgress;

        let lastStatus = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await pingZalogServer(apiBase).catch(() => false);
                const res = await fetchNoCache(`${apiBase}/api/zalog/health`, { timeoutMs: 60_000 });
                lastStatus = res.status;
                if (res.ok) {
                    const data = await res.json();
                    if (data.pythonDepsOk === false) {
                        throw new Error(
                            data.pythonDepsError ||
                                "Python-модули конвертера не установлены на сервере. Подождите 1–2 минуты после деплоя."
                        );
                    }
                    if (data.ok) return data;
                } else if (!isRetryableHttp(res.status) && res.status >= 400) {
                    throw new Error(`Сервер ответил HTTP ${res.status}`);
                }
            } catch (e) {
                if (attempt === maxAttempts && !isRetryableHttp(lastStatus)) throw e;
            }
            if (onProgress) onProgress(attempt, maxAttempts, lastStatus);
            if (attempt < maxAttempts) await sleep(delayMs);
        }
        throw new Error(
            "Сервер Render не проснулся за 90 секунд. Обновите страницу (Ctrl+Shift+R) и повторите через минуту."
        );
    }

    async function pollZalogJob(apiBase, jobId, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 90;
        const delayMs = opts.delayMs ?? 2000;
        const onProgress = opts.onProgress;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await sleep(attempt === 1 ? 500 : delayMs);
            const res = await fetchNoCache(
                `${apiBase}/api/zalog/convert/status/${encodeURIComponent(jobId)}`,
                { timeoutMs: 45_000 }
            );
            const raw = await res.text();
            let job = {};
            try {
                job = raw ? JSON.parse(raw) : {};
            } catch {
                if (isRetryableHttp(res.status) && attempt < maxAttempts) continue;
                throw new Error("Сервер вернул неверный ответ при проверке статуса");
            }
            if (!res.ok) {
                if (isRetryableHttp(res.status) && attempt < maxAttempts) continue;
                throw new Error(job.error || `HTTP ${res.status}`);
            }
            if (job.status === "done" && job.result) return job.result;
            if (job.status === "error") throw new Error(job.error || "Ошибка конвертации");
            if (onProgress) onProgress(attempt, maxAttempts, job.status);
        }
        throw new Error("Конвертация заняла слишком много времени. Попробуйте ещё раз.");
    }

    async function postZalogConvert(apiBase, pdfFile, xlsxFile, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 6;
        const retryDelayMs = opts.retryDelayMs ?? 10_000;
        const onRetry = opts.onRetry;
        const onProgress = opts.onProgress;

        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                if (onRetry) onRetry(attempt, maxAttempts);
                await sleep(retryDelayMs);
            }

            try {
                if (onProgress) onProgress(attempt, maxAttempts, null, null, "wake");
                await wakeZalogServer(apiBase, {
                    maxAttempts: attempt === 1 ? 45 : 25,
                    delayMs: 2000,
                    onProgress(wakeTry, wakeMax, status) {
                        if (onProgress) onProgress(attempt, maxAttempts, wakeTry, wakeMax, "wake", status);
                    }
                });
                await sleep(1000);

                const formData = new FormData();
                formData.append("pdf", pdfFile);
                formData.append("xlsx", xlsxFile);

                if (onProgress) onProgress(attempt, maxAttempts, null, null, "upload");
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
                        lastErr = new Error(`Сервер Render не готов (HTTP ${res.status})`);
                        continue;
                    }
                    throw new Error(
                        isRetryableHttp(res.status)
                            ? "Сервер Render не ответил. Подождите минуту и повторите."
                            : `Ошибка загрузки файлов (HTTP ${res.status})`
                    );
                }

                if (!res.ok) {
                    if (isRetryableHttp(res.status) && attempt < maxAttempts) {
                        lastErr = new Error(payload.error || `HTTP ${res.status}`);
                        continue;
                    }
                    throw new Error(payload.error || `Ошибка конвертера (HTTP ${res.status})`);
                }

                if (res.status === 202 || payload.async) {
                    if (!payload.jobId) throw new Error("Сервер не вернул идентификатор задачи");
                    if (onProgress) onProgress(attempt, maxAttempts, null, null, "processing");
                    return await pollZalogJob(apiBase, payload.jobId, {
                        onProgress(pollTry, pollMax) {
                            if (onProgress) onProgress(attempt, maxAttempts, pollTry, pollMax, "processing");
                        }
                    });
                }

                return payload;
            } catch (e) {
                lastErr = e;
                const msg = String(e.message || e);
                const retryable =
                    e.name === "AbortError" ||
                    /503|502|504|проснулся|Render|network|fetch/i.test(msg);
                if (attempt < maxAttempts && retryable) continue;
                throw e;
            }
        }
        throw lastErr || new Error("Не удалось выполнить конвертацию");
    }

    global.ZalogApiClient = { VERSION, wakeZalogServer, postZalogConvert, pingZalogServer, pollZalogJob, sleep };
})(typeof globalThis !== "undefined" ? globalThis : window);
