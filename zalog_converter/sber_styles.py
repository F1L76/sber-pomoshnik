"""Стили в духе прототипа «Сопровождение 2.0» (СберБизнес Помощник)."""

from __future__ import annotations

SBER_REPORT_HEAD_LINKS = """
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" />
  <link href="https://fonts.cdnfonts.com/css/sb-sans-interface" rel="stylesheet" />
"""

SBER_REPORT_CSS = """
    :root {
      --sber-green: #21A038;
      --sber-green-dark: #1B8A32;
      --sber-blue: #0098F8;
      --sber-gradient: linear-gradient(135deg, #21A038 0%, #0098F8 100%);
      --sber-bg: #F0F4F8;
      --sber-card-bg: #FFFFFF;
      --sber-text-dark: #1E2A3A;
      --sber-text-muted: #617188;
      --sber-border: #E2EAF2;
      --sber-shadow: 0 4px 24px rgba(30, 42, 58, 0.06);
      --radius-xl: 28px;
    }
    body {
      margin: 0;
      background: var(--sber-bg);
      font-family: 'SB Sans Interface', 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: var(--sber-text-dark);
      letter-spacing: -0.015em;
      line-height: 1.5;
      overflow-x: hidden;
    }
    .report-page {
      max-width: none;
      width: 100%;
      margin: 0 auto;
      padding: 0.65rem 0.75rem 1.25rem;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .report-hero {
      background: linear-gradient(180deg, #1E2A3A 0%, #162030 100%);
      border-bottom: 3px solid var(--sber-green);
      border-radius: var(--radius-xl);
      color: #fff;
      padding: 1.35rem 1.5rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .report-hero h1 {
      margin: 0 0 0.35rem;
      font-size: clamp(1.15rem, 2.5vw, 1.55rem);
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .report-hero p {
      margin: 0;
      color: rgba(255, 255, 255, 0.72);
      font-size: 0.9rem;
    }
    .info-card {
      background: var(--sber-card-bg);
      border-radius: var(--radius-xl);
      border: 1px solid var(--sber-border);
      box-shadow: var(--sber-shadow);
      padding: 1.15rem 1.25rem;
      margin-bottom: 1rem;
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 700;
      margin: 0 0 0.85rem;
      color: var(--sber-text-dark);
    }
    .text-success { color: var(--sber-green) !important; }
    .text-warning { color: #c98708 !important; }
    .mock-ai {
      background: #f7faf8;
      border-left: 4px solid var(--sber-green);
      padding: 1.1rem 1.25rem;
      border-radius: 16px;
      font-size: 0.95rem;
      line-height: 1.55;
      margin-bottom: 0;
      overflow: visible;
    }
    .reference-plain,
    .reference-notes li,
    .mock-ai p {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .reference-plain {
      white-space: pre-wrap;
      line-height: 1.55;
      font-size: 0.9rem;
      color: var(--sber-text-dark);
    }
    .report-block dt {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--sber-text-muted);
      margin-bottom: 0.15rem;
    }
    .report-block dd {
      margin: 0 0 0.5rem;
      font-weight: 600;
    }
    .hint, .muted {
      color: var(--sber-text-muted);
      font-size: 0.8125rem;
      margin: 0.5rem 0 0;
    }
    .table-responsive-custom {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid var(--sber-border);
    }
    .table-details {
      margin-bottom: 0;
    }
    .table-details th {
      background: #EEF4F9;
      font-weight: 600;
      font-size: 0.8rem;
      border-color: var(--sber-border);
    }
    .table-details td {
      font-size: 0.85rem;
      vertical-align: middle;
      border-color: var(--sber-border);
    }
    .objects-table th,
    .objects-table td,
    .risks-table th,
    .risks-table td {
      text-align: left;
    }
    .objects-table th.text-end,
    .objects-table td.text-end {
      text-align: right;
    }
    .objects-block .info-card,
    .objects-block .table-responsive-custom {
      width: 100%;
      max-width: 100%;
    }
    .objects-block .table-responsive-custom {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .objects-table {
      width: 100%;
      min-width: 1080px;
      table-layout: auto;
    }
    .objects-table th,
    .objects-table td {
      font-size: 0.72rem;
      padding: 0.4rem 0.45rem;
      line-height: 1.35;
      vertical-align: top;
      white-space: normal;
      overflow-wrap: break-word;
      word-break: normal;
      hyphens: auto;
    }
    .objects-table thead th {
      font-size: 0.68rem;
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      vertical-align: bottom;
      padding: 0.5rem 0.35rem;
    }
    .objects-table thead th.text-end {
      text-align: right;
    }
    .objects-table .th-lines {
      display: inline-block;
      max-width: 100%;
      text-align: center;
    }
    .objects-table thead th.text-end .th-lines {
      text-align: right;
    }
    .objects-table .filter-row th {
      background: #f8fafc;
      font-weight: normal;
      padding: 0.35rem 0.3rem;
      vertical-align: middle;
    }
    .objects-table .filter-row .form-select,
    .objects-table .filter-row .form-control {
      font-size: 0.65rem;
      padding: 0.2rem 0.3rem;
      min-width: 0;
      width: 100%;
    }
    .objects-table .filter-row .filter-hint {
      display: block;
      font-size: 0.58rem;
      color: var(--sber-text-muted);
      margin-top: 0.12rem;
      line-height: 1.1;
    }
    .objects-table .filter-reset-btn {
      font-size: 0.65rem;
      padding: 0.2rem 0.35rem;
      line-height: 1.2;
    }
    .objects-table .col-code { min-width: 4.5rem; width: 5%; }
    .objects-table .col-classifier { min-width: 5.5rem; width: 8%; }
    .objects-table .col-name {
      min-width: 14rem;
      width: 28%;
      white-space: pre-wrap;
      line-height: 1.4;
      font-size: 0.7rem;
    }
    .objects-table .col-id { min-width: 6rem; width: 9%; }
    .objects-table .col-quality { min-width: 4.5rem; width: 7%; }
    .objects-table .col-valtype { min-width: 4.5rem; width: 7%; }
    .objects-table .col-num {
      min-width: 5.5rem;
      width: 9%;
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: normal;
      hyphens: none;
    }
    .objects-table .col-pct {
      min-width: 3.5rem;
      width: 5%;
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      hyphens: none;
    }
    .objects-table .col-liq {
      min-width: 4rem;
      width: 6%;
      text-align: right;
      hyphens: none;
    }
    .objects-table .col-tight {
      white-space: normal;
    }
    .objects-table .col-text {
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
      min-width: 0;
      max-width: none;
    }
    .report-page.pdf-export {
      max-width: none;
      width: 1280px;
      margin: 0;
      padding: 1rem 1.25rem 2rem;
    }
    .report-page.pdf-export .info-card,
    .report-page.pdf-export .table-responsive-custom {
      width: 100%;
      overflow: visible;
    }
    .report-page.pdf-export .objects-table {
      width: max-content;
      min-width: 100%;
    }
    .report-page.pdf-export .objects-table .col-tight {
      white-space: normal;
    }
    .report-page.pdf-export .objects-table th,
    .report-page.pdf-export .objects-table td {
      font-size: 0.62rem;
      padding: 0.25rem 0.2rem;
      line-height: 1.2;
    }
    .report-page.pdf-export .objects-table th {
      font-size: 0.58rem;
      font-weight: 600;
    }
    .totals-row td {
      background: #F7FAFC;
      font-weight: 600;
    }
    .badge-sber {
      background: rgba(33, 160, 56, 0.14);
      color: #156B28;
      padding: 0.35rem 0.85rem;
      border-radius: 999px;
      font-weight: 600;
      font-size: 0.75rem;
    }
    @media print {
      body { background: #fff; }
      .report-page { padding: 0; max-width: none; }
      .info-card { box-shadow: none; break-inside: avoid; }
      .objects-table .filter-row { display: none; }
    }
"""

SBER_OBJECTS_TABLE_FILTER_SCRIPT = """
(function () {
  const table = document.querySelector(".objects-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const tfoot = table.querySelector("tfoot");
  const countEl = document.getElementById("objectsVisibleCount");
  const filters = table.querySelectorAll("[data-obj-filter]");

  function cellText(tr, index) {
    return (tr.cells[index]?.textContent || "").trim();
  }

  function parseNum(text) {
    const s = String(text || "").replace(/\\s/g, "").replace(",", ".").replace(/[^\\d.-]/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function preserveScroll(run) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const saved = [];
    try {
      if (window.parent && window.parent !== window) {
        const p = window.parent;
        saved.push({ el: p, left: p.scrollX, top: p.scrollY, isWin: true });
        const modalBody = p.document?.querySelector(".modal.show .modal-body");
        if (modalBody) {
          saved.push({ el: modalBody, left: modalBody.scrollLeft, top: modalBody.scrollTop, isWin: false });
        }
      }
    } catch (_e) {}
    run();
    window.scrollTo(scrollX, scrollY);
    saved.forEach(({ el, left, top, isWin }) => {
      try {
        if (isWin) el.scrollTo(left, top);
        else { el.scrollLeft = left; el.scrollTop = top; }
      } catch (_e) {}
    });
  }

  function applyFilters() {
    preserveScroll(() => {
    const f = {};
    filters.forEach((el) => { f[el.dataset.objFilter] = el.value.trim(); });
    const fLower = {};
    ["code", "name", "identifier"].forEach((k) => {
      fLower[k] = (f[k] || "").toLowerCase();
    });

    let visible = 0;
    let sumEst = 0;
    let sumColl = 0;

    tbody.querySelectorAll("tr").forEach((tr) => {
      let show = true;
      if (show && fLower.code && !cellText(tr, 0).toLowerCase().includes(fLower.code)) show = false;
      if (show && f.classifier && cellText(tr, 1) !== f.classifier) show = false;
      if (show && fLower.name && !cellText(tr, 2).toLowerCase().includes(fLower.name)) show = false;
      if (show && fLower.identifier && !cellText(tr, 3).toLowerCase().includes(fLower.identifier)) show = false;
      if (show && f.quality && cellText(tr, 4) !== f.quality) show = false;
      if (show && f.valtype && cellText(tr, 5) !== f.valtype) show = false;
      if (show && f.liquidity && cellText(tr, 9) !== f.liquidity) show = false;

      const est = parseNum(cellText(tr, 6));
      const coll = parseNum(cellText(tr, 7));
      if (show && f.costMin) {
        const min = parseNum(f.costMin);
        if (min != null && (est == null || est < min)) show = false;
      }
      if (show && f.costMax) {
        const max = parseNum(f.costMax);
        if (max != null && (est == null || est > max)) show = false;
      }

      tr.style.display = show ? "" : "none";
      if (show) {
        visible += 1;
        if (est != null) sumEst += est;
        if (coll != null) sumColl += coll;
      }
    });

    if (tfoot) {
      const estCell = tfoot.querySelector("[data-total-est]");
      const collCell = tfoot.querySelector("[data-total-coll]");
      if (estCell) estCell.textContent = sumEst.toLocaleString("ru-RU") + " ₽";
      if (collCell) collCell.textContent = sumColl.toLocaleString("ru-RU") + " ₽";
    }
    if (countEl) countEl.textContent = String(visible);
    });
  }

  filters.forEach((el) => {
    const key = el.dataset.objFilter;
    if (el.tagName === "SELECT") {
      el.addEventListener("change", applyFilters);
      return;
    }
    if (key === "code" || key === "costMin" || key === "costMax") {
      el.addEventListener("input", applyFilters);
      return;
    }
    if (key === "name" || key === "identifier") {
      let timer;
      el.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(applyFilters, 350);
      });
      return;
    }
  });

  document.getElementById("objectsFilterReset")?.addEventListener("click", () => {
    filters.forEach((el) => { el.value = ""; });
    applyFilters();
  });

  applyFilters();
})();
"""
