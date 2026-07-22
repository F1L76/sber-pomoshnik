/**
 * Переключатель светлой/тёмной темы (общий для всех страниц).
 */
(function (global) {
    const KEY = "sber-pomoshnik:theme";
    const THEME_CSS_HREF = "/theme.css?v=11";

    function getTheme() {
        try {
            return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
        } catch (_) {
            return "light";
        }
    }

    function setDocTheme(doc, theme) {
        if (!doc?.documentElement) return;
        if (theme === "dark") doc.documentElement.setAttribute("data-theme", "dark");
        else doc.documentElement.removeAttribute("data-theme");
    }

    function syncIframes(theme) {
        document.querySelectorAll("iframe").forEach((frame) => {
            try {
                setDocTheme(frame.contentDocument, theme);
            } catch (_) { /* cross-origin */ }
        });
    }

    /**
     * Готовит HTML сводного отчёта для srcdoc: тема + theme.css (для старых отчётов).
     * options.modalScroll — отключить внутренний sticky/scroll перечня в модалке.
     */
    function prepareReportHtml(html, options) {
        const theme = getTheme();
        let out = String(html || "");
        if (!out) return out;

        out = out.replace(/<html\b([^>]*)>/i, (_, attrs) => {
            const cleaned = String(attrs || "").replace(/\sdata-theme\s*=\s*(["'])[\s\S]*?\1/i, "");
            return theme === "dark"
                ? `<html${cleaned} data-theme="dark">`
                : `<html${cleaned}>`;
        });

        if (!/\/theme\.css(\?|"|')/i.test(out)) {
            const link = `<link rel="stylesheet" href="${THEME_CSS_HREF}" />\n`;
            if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${link}</head>`);
            else out = link + out;
        }

        if (options?.modalScroll) {
            // ponytail: в модалке перечень скроллится со страницей, не во внутреннем окне
            out = out.replace(
                /<\/style>/i,
                `.objects-table thead tr.objects-header-row th,` +
                    `.objects-table thead tr.filter-row th{position:static!important;top:auto!important;z-index:auto!important}` +
                    `.objects-block .table-responsive-custom,` +
                    `.objects-block .objects-table-scroll{` +
                    `max-height:none!important;height:auto!important;` +
                    `overflow-y:visible!important;overflow-x:auto!important}` +
                    `html,body{overflow:visible!important;height:auto!important}` +
                    `</style>`
            );
        }

        return out;
    }

    function applyTheme(theme) {
        const next = theme === "dark" ? "dark" : "light";
        setDocTheme(document, next);
        try {
            localStorage.setItem(KEY, next);
        } catch (_) { /* private mode */ }

        document.querySelectorAll("#themeToggle, [data-theme-toggle]").forEach((el) => {
            if (el instanceof HTMLInputElement && el.type === "checkbox") {
                el.checked = next === "dark";
            }
        });

        document.querySelectorAll("[data-theme-icon]").forEach((icon) => {
            icon.classList.toggle("fa-moon", next !== "dark");
            icon.classList.toggle("fa-sun", next === "dark");
        });

        document.querySelectorAll("[data-theme-label]").forEach((label) => {
            label.textContent = next === "dark" ? "Тёмная" : "Светлая";
        });

        syncIframes(next);
    }

    function initThemeToggle() {
        applyTheme(getTheme());
        document.addEventListener("change", (e) => {
            const t = e.target;
            if (!(t instanceof HTMLInputElement)) return;
            if (t.id !== "themeToggle" && !t.hasAttribute("data-theme-toggle")) return;
            applyTheme(t.checked ? "dark" : "light");
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initThemeToggle);
    } else {
        initThemeToggle();
    }

    global.SberTheme = { getTheme, applyTheme, prepareReportHtml, syncIframes, KEY };
})(typeof globalThis !== "undefined" ? globalThis : window);
