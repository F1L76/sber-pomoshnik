/**
 * Экспорт HTML-отчёта в PDF формата A4 (альбом).
 * Ширина всегда вписывается в лист: canvas → изображение на всю usable width.
 */
(function (global) {
    const PAGE_WIDTH_MM = 297;
    const PAGE_HEIGHT_MM = 210;
    const MARGIN_MM = 5;
    const LAYOUT_PX = Math.floor((PAGE_WIDTH_MM - MARGIN_MM * 2) * (96 / 25.4));

    function getJsPdf() {
        if (global.jspdf?.jsPDF) return global.jspdf.jsPDF;
        if (typeof global.jsPDF === "function") return global.jsPDF;
        // html2pdf.bundle иногда кладёт конструктор сюда
        if (global.html2pdf?.jsPDF) return global.html2pdf.jsPDF;
        if (typeof global.html2pdf?.Worker?.jspdf === "function") return global.html2pdf.Worker.jspdf;
        return null;
    }

    function getHtml2Canvas() {
        return global.html2canvas || null;
    }

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
            `width:${LAYOUT_PX}px`,
            "background:#fff",
            "z-index:2147483000",
            "overflow:hidden",
            "pointer-events:none",
            "box-sizing:border-box"
        ].join(";");

        doc.querySelectorAll("style").forEach((styleEl) => {
            mount.appendChild(document.importNode(styleEl, true));
        });

        const fitCss = document.createElement("style");
        fitCss.textContent = `
          #zalog-pdf-mount, #zalog-pdf-mount * { box-sizing: border-box !important; }
          #zalog-pdf-mount .report-page {
            width: ${LAYOUT_PX}px !important;
            max-width: ${LAYOUT_PX}px !important;
            margin: 0 !important;
            padding: 6px 8px 10px !important;
          }
          #zalog-pdf-mount table {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            table-layout: fixed !important;
          }
          #zalog-pdf-mount col,
          #zalog-pdf-mount th,
          #zalog-pdf-mount td {
            min-width: 0 !important;
            max-width: none !important;
          }
          #zalog-pdf-mount .table-responsive-custom,
          #zalog-pdf-mount .objects-table-scroll {
            overflow: visible !important;
            max-height: none !important;
            width: 100% !important;
          }
          #zalog-pdf-mount .btn-clear-risk,
          #zalog-pdf-mount .risk-clear-modal,
          #zalog-pdf-mount .risk-action-col,
          #zalog-pdf-mount .filter-row,
          #zalog-pdf-mount .th-copy-btn,
          #zalog-pdf-mount .objects-copy-toast { display: none !important; }
        `;
        mount.appendChild(fitCss);

        const target = document.importNode(page, true);
        target.classList.add("pdf-export");
        target
            .querySelectorAll(
                ".btn-clear-risk, .risk-clear-modal, .risk-action-col, .objects-table .filter-row, .th-copy-btn, .objects-copy-toast"
            )
            .forEach((el) => el.remove());
        target.querySelectorAll("th.risk-action-col, td.risk-action-col").forEach((el) => el.remove());

        mount.appendChild(target);
        document.body.appendChild(mount);

        const overflow = Math.max(target.scrollWidth, mount.scrollWidth) - LAYOUT_PX;
        if (overflow > 2) {
            const zoom = LAYOUT_PX / Math.max(target.scrollWidth, mount.scrollWidth);
            mount.style.zoom = String(Math.max(0.45, Math.min(1, zoom)));
        }

        return { mount, target };
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "zalog_report.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function canvasToPdfBlob(canvas) {
        const JsPDF = getJsPdf();
        if (!JsPDF) return null;

        const pdf = new JsPDF({
            orientation: "landscape",
            unit: "mm",
            format: "a4",
            compress: true
        });

        const usableW = PAGE_WIDTH_MM - MARGIN_MM * 2;
        const usableH = PAGE_HEIGHT_MM - MARGIN_MM * 2;
        const imgW = usableW;
        const imgH = (canvas.height * imgW) / canvas.width;
        const imgData = canvas.toDataURL("image/jpeg", 0.93);

        let heightLeft = imgH;
        let offsetY = MARGIN_MM;
        pdf.addImage(imgData, "JPEG", MARGIN_MM, offsetY, imgW, imgH, undefined, "FAST");
        heightLeft -= usableH;

        while (heightLeft > 1) {
            offsetY = MARGIN_MM - (imgH - heightLeft);
            pdf.addPage();
            pdf.addImage(imgData, "JPEG", MARGIN_MM, offsetY, imgW, imgH, undefined, "FAST");
            heightLeft -= usableH;
        }

        return pdf.output("blob");
    }

    async function exportViaHtml2Pdf(target, filename) {
        if (typeof html2pdf === "undefined") {
            throw new Error("Не удалось загрузить библиотеку PDF. Обновите страницу.");
        }
        await html2pdf()
            .set({
                margin: MARGIN_MM,
                filename: filename || "zalog_report.pdf",
                image: { type: "jpeg", quality: 0.93 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    letterRendering: false,
                    backgroundColor: "#ffffff",
                    scrollX: 0,
                    scrollY: 0,
                    width: LAYOUT_PX,
                    windowWidth: LAYOUT_PX,
                    logging: false
                },
                pagebreak: { mode: ["css", "legacy"] },
                jsPDF: { unit: "mm", format: "a4", orientation: "landscape" }
            })
            .from(target)
            .save();
    }

    async function exportReportHtmlToPdf(html, filename) {
        if (!html) throw new Error("Нет HTML отчёта для PDF");
        if (typeof html2pdf === "undefined" && !getHtml2Canvas()) {
            throw new Error("Не удалось загрузить библиотеку PDF. Обновите страницу.");
        }

        const overlay = document.createElement("div");
        overlay.style.cssText =
            "position:fixed;inset:0;z-index:2147483001;background:rgba(30,42,58,.45);display:flex;align-items:center;justify-content:center;color:#fff;font:600 1rem/1.4 system-ui,sans-serif;";
        overlay.textContent = "Формируем PDF…";
        document.body.appendChild(overlay);

        // ponytail: PDF всегда светлый — временно снимаем тёмную тему с html, иначе селекторы html[data-theme=dark] красят mount
        const prevTheme = document.documentElement.getAttribute("data-theme");
        document.documentElement.removeAttribute("data-theme");

        const { mount, target } = mountReport(html);
        try {
            if (document.fonts?.ready) await document.fonts.ready;
            await new Promise((r) => setTimeout(r, 350));

            const h2c = getHtml2Canvas();
            if (h2c && getJsPdf()) {
                const canvas = await h2c(target, {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    letterRendering: false,
                    backgroundColor: "#ffffff",
                    scrollX: 0,
                    scrollY: 0,
                    width: LAYOUT_PX,
                    windowWidth: LAYOUT_PX,
                    logging: false
                });
                if (!canvas || canvas.width < 10 || canvas.height < 10) {
                    throw new Error("Не удалось отрисовать отчёт для PDF");
                }
                const blob = canvasToPdfBlob(canvas);
                if (!blob || blob.size < 1500) {
                    throw new Error("PDF получился пустым. Попробуйте ещё раз.");
                }
                downloadBlob(blob, filename);
                return;
            }

            // запасной путь: только html2pdf.bundle (jsPDF внутри внутри)
            await exportViaHtml2Pdf(target, filename);
        } finally {
            mount.remove();
            overlay.remove();
            if (prevTheme) document.documentElement.setAttribute("data-theme", prevTheme);
            else document.documentElement.removeAttribute("data-theme");
        }
    }

    global.ZalogPdfExport = {
        exportReportHtmlToPdf
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
