/**
 * Клиент API конвертера: keep-alive, пробуждение Render, async + JSON fallback.
 */
(function (global) {
    const VERSION = 9;
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
        const isFormData =
            typeof FormData !== "undefined" && opts.body instanceof FormData;
        try {
            // FormData: не задаём Content-Type/Cache-Control вручную — иначе boundary ломается
            // и сервер получает пустое тело («нет полей»).
            const init = {
                method: opts.method || "GET",
                body: opts.body,
                cache: "no-store",
                signal: controller?.signal
            };
            if (!isFormData) {
                init.headers = {
                    "Cache-Control": "no-cache, no-store",
                    Pragma: "no-cache",
                    ...(opts.headers || {})
                };
            } else if (opts.headers) {
                const headers = { ...opts.headers };
                delete headers["Content-Type"];
                delete headers["content-type"];
                if (Object.keys(headers).length) init.headers = headers;
            }
            return await fetch(withCacheBust(url), init);
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
            // localhost: не долбить reconnect каждые 5 с
            const local =
                /^(localhost|127\.0\.0\.1)$/i.test(location.hostname) ||
                String(base).includes("localhost") ||
                String(base).includes("127.0.0.1");
            if (local) return;
            setTimeout(() => startKeepAlive(base, onStatus), 15_000);
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
        // FileReader надёжнее ручного btoa на части PDF/кириллических именах в Safari/Chrome
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const s = String(reader.result || "");
                const comma = s.indexOf(",");
                resolve(comma >= 0 ? s.slice(comma + 1) : s);
            };
            reader.onerror = () =>
                reject(reader.error || new Error(`Не удалось прочитать файл «${file?.name || "?"}»`));
            reader.readAsDataURL(file);
        });
    }

    async function assertZalogFiles(pdfFile, xlsxFile) {
        if (!pdfFile || !xlsxFile) {
            throw new Error("Загрузите оба файла: PDF заключение и XLSX перечень залога");
        }
        const xname = String(xlsxFile.name || "");
        const pname = String(pdfFile.name || "");
        if (xname.startsWith("~$") || pname.startsWith("~$")) {
            throw new Error(
                "Выбран временный файл Excel (~$). Закройте книгу в Excel и укажите обычный .xlsx"
            );
        }
        if (!pdfFile.size) throw new Error(`PDF пустой: «${pname || "без имени"}»`);
        if (!xlsxFile.size) throw new Error(`XLSX пустой: «${xname || "без имени"}»`);
        if (xlsxFile.size < 512) {
            throw new Error(
                `XLSX слишком маленький (${xlsxFile.size} байт). Возможно выбран не тот файл (например ~$…)`
            );
        }
        const pdfHead = new Uint8Array(await pdfFile.slice(0, 5).arrayBuffer());
        const pdfSig = String.fromCharCode(pdfHead[0], pdfHead[1], pdfHead[2], pdfHead[3], pdfHead[4]);
        if (pdfSig !== "%PDF-") {
            throw new Error(`«${pname}» не похож на PDF (сигнатура: ${JSON.stringify(pdfSig)})`);
        }
        const xHead = new Uint8Array(await xlsxFile.slice(0, 2).arrayBuffer());
        if (xHead[0] !== 0x50 || xHead[1] !== 0x4b) {
            throw new Error(
                `«${xname}» не похож на .xlsx (нужен Excel 2007+, не старый .xls и не временный ~$)`
            );
        }
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
                const errMsg = job.error || `HTTP ${res.status}`;
                // Render перезапустил процесс — задача из памяти/диска пропала
                if (res.status === 404 || /не найдена|истекла/i.test(errMsg)) {
                    const lost = new Error(errMsg);
                    lost.code = "JOB_LOST";
                    throw lost;
                }
                throw new Error(errMsg);
            }
            if (job.status === "done" && job.result) return job.result;
            if (job.status === "error") {
                const errMsg = job.error || "Ошибка конвертации";
                if (/прервалась|перезапуск/i.test(errMsg)) {
                    const lost = new Error(errMsg);
                    lost.code = "JOB_LOST";
                    throw lost;
                }
                throw new Error(errMsg);
            }            if (onProgress) onProgress(attempt, maxAttempts, job.status);
        }
        throw new Error("Конвертация заняла слишком много времени.");
    }

    async function submitConvertJob(apiBase, pdfFile, xlsxFile, useJson) {
        await assertZalogFiles(pdfFile, xlsxFile);
        if (useJson) {
            const res = await fetchNoCache(`${apiBase}/api/zalog/convert/json`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pdfBase64: await fileToBase64(pdfFile),
                    xlsxBase64: await fileToBase64(xlsxFile),
                    pdfName: pdfFile.name || "conclusion.pdf",
                    xlsxName: xlsxFile.name || "objects.xlsx",
                    clientVersion: VERSION
                }),
                timeoutMs: 300_000
            });
            return res;
        }
        const formData = new FormData();
        formData.append("pdf", pdfFile, pdfFile.name || "conclusion.pdf");
        formData.append("xlsx", xlsxFile, xlsxFile.name || "objects.xlsx");
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
        // ponytail: JSON/base64 по умолчанию — multipart из браузера иногда уходит с пустым телом
        let useJson = opts.useJson !== false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                if (onRetry) onRetry(attempt, maxAttempts, useJson ? "json" : "multipart");
                await sleep(retryDelayMs);
            }

            try {
                if (onProgress) onProgress(attempt, maxAttempts, null, null, "wake");
                await wakeZalogServer(apiBase, {
                    maxAttempts:
                        /localhost|127\.0\.0\.1/i.test(String(apiBase)) ||
                        /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
                            ? 2
                            : 50,
                    delayMs:
                        /localhost|127\.0\.0\.1/i.test(String(apiBase)) ||
                        /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
                            ? 400
                            : 2000,
                    onProgress(wakeTry, wakeMax, status) {
                        if (onProgress) onProgress(attempt, maxAttempts, wakeTry, wakeMax, "wake", status);
                    }
                });
                await sleep(300);

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
                const emptyMultipart = /нет полей|multipart|оба файла/i.test(msg);
                const retryable =
                    e.name === "AbortError" ||
                    e.code === "JOB_LOST" ||
                    emptyMultipart ||
                    /503|502|504|проснулся|Render|network|fetch|HTTP 5|не найдена|истекла|прервалась|перезапуск/i.test(
                        msg
                    );
                if (!useJson && (retryable || emptyMultipart)) useJson = true;
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
