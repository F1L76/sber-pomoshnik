/**
 * Экспорт HTML-отчёта конвертера в PDF.
 * Не через iframe: html2canvas из iframe часто отдаёт пустой файл.
 */
(function (global) {
    // A4 landscape usable width ≈ 297mm − margins; 96dpi → px
    const PAGE_WIDTH_MM = 297;
    const MARGIN_MM = 6;
    const PX_PER_MM = 96 / 25.4;
    const PAGE_CONTENT_PX = Math.floor((PAGE_WIDTH_MM - MARGIN_MM * 2) * PX_PER_MM);

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
            `width:${PAGE_CONTENT_PX}px`,
            "background:#fff",
            "z-index:2147483000",
            "overflow:visible",
            "pointer-events:none",
            "box-sizing:border-box"
        ].join(";");

        doc.querySelectorAll("style").forEach((styleEl) => {
            mount.appendChild(document.importNode(styleEl, true));
        });

        const target = document.importNode(page, true);
        target.classList.add("pdf-export");
        target.style.width = "100%";
        target.style.maxWidth = "100%";
        target.style.boxSizing = "border-box";

        target
            .querySelectorAll(
                ".btn-clear-risk, .risk-clear-modal, .risk-action-col, .objects-table .filter-row, .th-copy-btn, .objects-copy-toast"
            )
            .forEach((el) => el.remove());
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
            await new Promise((r) => setTimeout(r, 300));

            // если после вёрстки шире страницы — слегка уменьшаем масштаб захвата
            const naturalWidth = Math.max(target.scrollWidth, target.offsetWidth, 1);
            const fitScale = Math.min(1, PAGE_CONTENT_PX / naturalWidth);
            const captureWidth = Math.round(PAGE_CONTENT_PX);
            mount.style.width = `${captureWidth}px`;
            if (fitScale < 0.999) {
                target.style.transform = `scale(${fitScale})`;
                target.style.transformOrigin = "top left";
                target.style.width = `${Math.round(captureWidth / fitScale)}px`;
            }

            const worker = html2pdf()
                .set({
                    margin: MARGIN_MM,
                    filename: filename || "zalog_report.pdf",
                    image: { type: "jpeg", quality: 0.92 },
                    html2canvas: {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        // letterRendering ломает кириллицу (Ба��ка)
                        letterRendering: false,
                        backgroundColor: "#ffffff",
                        scrollX: 0,
                        scrollY: 0,
                        width: captureWidth,
                        windowWidth: captureWidth,
                        logging: false
                    },
                    pagebreak: { mode: ["css", "legacy"] },
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
