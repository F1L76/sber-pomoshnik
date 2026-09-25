(() => {
  const KEY = "upgrade-theme";

  function current() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function apply(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(KEY, next);
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      const label = next === "light" ? "Включить тёмную тему" : "Включить светлую тему";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
    });
  }

  function boot() {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") {
      apply(stored);
      return;
    }
    apply(window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }

  boot();

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    apply(current() === "light" ? "dark" : "light");
  });
})();
