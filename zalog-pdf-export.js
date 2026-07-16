/**
 * Экспорт HTML-отчёта конвертера в PDF.
 * Не через iframe: html2canvas из iframe часто отдаёт пустой файл.
 */
(function (global) {
    function parseReport(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(String(html || ""), "text/html");
        const page = doc.querySelector(".report-page");
        if (!page) throw new Error("В отчёте нет блока .report-page");
        return { doc, page };
    }

    function mountReport(html) {
        const { doc, page } = parseReport(html);
        const mount = document.createElement("div");
        mount.id = "zalog-pdf-mount";
        mount.setAttribute("aria-hidden", "true");
        mount.style.cssText = [
            "position:fixed",
            "left:0",
            "top:0",
            "width:1280px",
            "max-width:100vw",
            "background:#fff",
            "z-index:2147483000",
            "overflow:visible",
            "pointer-events:none"
        ].join(";");

        doc.querySelectorAll("style").forEach((styleEl) => {
            mount.appendChild(document.importNode(styleEl, true));
        });

        const target = document.importNode(page, true);
        target.classList.add("pdf-export");
        // в PDF не нужны кнопки и модалки
        target.querySelectorAll(".btn-clear-risk, .risk-clear-modal, .risk-action-col, .objects-table .filter-row").forEach((el) => {
            if (el.classList?.contains("risk-action-col") || el.matches?.("th.risk-action-col, td.risk-action-col")) {
                el.remove();
            } else if (el.classList?.contains("filter-row") || el.classList?.contains("risk-clear-modal")) {
                el.remove();
            } else {
                el.remove();
            }
        });
        target.querySelectorAll("th.risk-action-col, td.risk-action-col").forEach((el) => el.remove());
        mount.appendChild(target);
        document.body.appendChild(mount);
        return { mount, target };
    }

    async function exportReportHtmlToPdf(html, filename) {
        if (typeof html2pdf === "undefined") {
            throw new Error("Не удалось загрузить библиотеку PDF. Обновите страницу.");
        }
        if (!html) throw new Error("Нет HTML отчёта для PDF");

        const overlay = document.createElement("div");
        overlay.style.cssText =
            "position:fixed;inset:0;z-index:2147483001;background:rgba(30,42,58,.45);display:flex;align-items:center;justify-content:center;color:#fff;font:600 1rem/1.4 system-ui,sans-serif;";
        overlay.textContent = "Формируем PDF…";
        document.body.appendChild(overlay);

        const { mount, target } = mountReport(html);
        try {
            if (document.fonts?.ready) await document.fonts.ready;
            await new Promise((r) => setTimeout(r, 250));

            const captureWidth = Math.max(target.scrollWidth, target.offsetWidth, 1100);
            mount.style.width = `${captureWidth}px`;

            const worker = html2pdf()
                .set({
                    margin: [8, 8, 8, 8],
                    filename: filename || "zalog_report.pdf",
                    image: { type: "jpeg", quality: 0.92 },
                    html2canvas: {
                        scale: 1.5,
                        useCORS: true,
                        allowTaint: true,
                        letterRendering: true,
                        backgroundColor: "#ffffff",
                        scrollX: 0,
                        scrollY: 0,
                        windowWidth: captureWidth,
                        logging: false
                    },
                    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
                    jsPDF: { unit: "mm", format: "a4", orientation: "landscape" }
                })
                .from(target);

            const blob = await worker.outputPdf("blob");
            if (!blob || blob.size < 1500) {
                throw new Error("PDF получился пустым. Попробуйте ещё раз или откройте «Подробнее» и скачайте снова.");
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename || "zalog_report.pdf";
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } finally {
            mount.remove();
            overlay.remove();
        }
    }

    global.ZalogPdfExport = {
        exportReportHtmlToPdf
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
