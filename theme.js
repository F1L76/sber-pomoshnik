/**
 * Переключатель светлой/тёмной темы (общий для всех страниц).
 */
(function (global) {
    const KEY = "sber-pomoshnik:theme";

    function getTheme() {
        try {
            return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
        } catch (_) {
            return "light";
        }
    }

    function applyTheme(theme) {
        const next = theme === "dark" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
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

    global.SberTheme = { getTheme, applyTheme, KEY };
})(typeof globalThis !== "undefined" ? globalThis : window);
