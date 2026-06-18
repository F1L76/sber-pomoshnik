/**
 * Клиент API конвертера: keep-alive, пробуждение Render, async + JSON fallback.
 */
(function (global) {
    const VERSION = 4;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let keepAliveWs = null;
    let keepAliveTimer = null;
    let serverReady = false;

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

    function wsUrl(apiBase) {
        const u = new URL(apiBase || location.origin);
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
        u.pathname = "/api/zalog/ws";
        u.search = "";
        return u.toString();
    }

    function startKeepAlive(apiBase, onStatus) {
        const base = apiBase || location.origin;
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
            fetchNoCache(`${base}/api/zalog/ping`, { timeoutMs: 30_000 }).catch(() => {});
        }, 4 * 60 * 1000);

        if (typeof WebSocket === "undefined") return;
        try {
            if (keepAliveWs) keepAliveWs.close();
        } catch {
            /* ignore */
        }
        keepAliveWs = new WebSocket(wsUrl(base));
        keepAliveWs.onopen = () => onStatus?.("ws-open");
        keepAliveWs.onclose = () => {
            onStatus?.("ws-closed");
            setTimeout(() => startKeepAlive(base, onStatus), 5000);
        };
        keepAliveWs.onerror = () => onStatus?.("ws-error");
        setInterval(() => {
            if (keepAliveWs?.readyState === 1) keepAliveWs.send("ping");
        }, 4 * 60 * 1000);
    }

    async function pingZalogServer(apiBase) {
        const res = await fetchNoCache(`${apiBase}/api/zalog/ping`, { timeoutMs: 60_000 });
        return res.ok;
    }

    async function wakeZalogServer(apiBase, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 50;
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
                                "Python-модули конвертера не установлены на сервере."
                        );
                    }
                    if (data.ok) {
                        serverReady = true;
                        return data;
                    }
                } else if (!isRetryableHttp(res.status) && res.status >= 400) {
                    throw new Error(`Сервер ответил HTTP ${res.status}`);
                }
            } catch (e) {
                if (attempt === maxAttempts && !isRetryableHttp(lastStatus)) throw e;
            }
            if (onProgress) onProgress(attempt, maxAttempts, lastStatus);
            if (attempt < maxAttempts) await sleep(delayMs);
        }
        serverReady = false;
        throw new Error(
            "Сервер Render не проснулся. Обновите страницу (Ctrl+Shift+R) и подождите 1–2 минуты."
        );
    }

    async function fileToBase64(file) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
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
        throw new Error("Конвертация заняла слишком много времени.");
    }

    async function submitConvertJob(apiBase, pdfFile, xlsxFile, useJson) {
        if (useJson) {
            const res = await fetchNoCache(`${apiBase}/api/zalog/convert/json`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pdfBase64: await fileToBase64(pdfFile),
                    xlsxBase64: await fileToBase64(xlsxFile)
                }),
                timeoutMs: 300_000
            });
            return res;
        }
        const formData = new FormData();
        formData.append("pdf", pdfFile);
        formData.append("xlsx", xlsxFile);
        return fetchNoCache(`${apiBase}/api/zalog/convert`, {
            method: "POST",
            body: formData,
            timeoutMs: 300_000
        });
    }

    async function parseConvertResponse(res) {
        const raw = await res.text();
        let payload = {};
        try {
            payload = raw ? JSON.parse(raw) : {};
        } catch {
            if (isRetryableHttp(res.status)) {
                return { retry: true, error: new Error(`HTTP ${res.status}`) };
            }
            throw new Error(`Ошибка сервера (HTTP ${res.status})`);
        }
        if (!res.ok) {
            if (isRetryableHttp(res.status)) {
                return { retry: true, error: new Error(payload.error || `HTTP ${res.status}`) };
            }
            throw new Error(payload.error || `Ошибка конвертера (HTTP ${res.status})`);
        }
        return { retry: false, payload };
    }

    async function postZalogConvert(apiBase, pdfFile, xlsxFile, options) {
        const opts = options || {};
        const maxAttempts = opts.maxAttempts ?? 8;
        const retryDelayMs = opts.retryDelayMs ?? 8000;
        const onRetry = opts.onRetry;
        const onProgress = opts.onProgress;

        let lastErr;
        let useJson = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                if (onRetry) onRetry(attempt, maxAttempts, useJson ? "json" : "multipart");
                await sleep(retryDelayMs);
            }

            try {
                if (onProgress) onProgress(attempt, maxAttempts, null, null, "wake");
                await wakeZalogServer(apiBase, {
                    maxAttempts: 50,
                    delayMs: 2000,
                    onProgress(wakeTry, wakeMax, status) {
                        if (onProgress) onProgress(attempt, maxAttempts, wakeTry, wakeMax, "wake", status);
                    }
                });
                await sleep(800);

                if (onProgress) onProgress(attempt, maxAttempts, null, null, useJson ? "upload-json" : "upload");
                const res = await submitConvertJob(apiBase, pdfFile, xlsxFile, useJson);
                const parsed = await parseConvertResponse(res);

                if (parsed.retry) {
                    lastErr = parsed.error;
                    if (!useJson && isRetryableHttp(res.status)) {
                        useJson = true;
                        if (onProgress) onProgress(attempt, maxAttempts, null, null, "retry-json");
                    }
                    if (attempt < maxAttempts) continue;
                    throw lastErr;
                }

                const payload = parsed.payload;
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
                    /503|502|504|проснулся|Render|network|fetch|HTTP 5/i.test(msg);
                if (!useJson && retryable) useJson = true;
                if (attempt < maxAttempts && retryable) continue;
                throw e;
            }
        }
        throw lastErr || new Error("Не удалось выполнить конвертацию");
    }

    function isServerReady() {
        return serverReady;
    }

    global.ZalogApiClient = {
        VERSION,
        wakeZalogServer,
        postZalogConvert,
        pingZalogServer,
        pollZalogJob,
        startKeepAlive,
        isServerReady,
        sleep
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
