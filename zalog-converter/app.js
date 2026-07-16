const API_BASE = (() => {
  try {
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
  } catch (_) { /* ignore */ }
  return "http://localhost:8787";
})();

const pdfUpload = document.getElementById("pdfUpload");
const xlsxUpload = document.getElementById("xlsxUpload");
const btnConvert = document.getElementById("btnConvert");
const btnClear = document.getElementById("btnClear");
const btnDownload = document.getElementById("btnDownload");
const btnPrint = document.getElementById("btnPrint");
const statusEl = document.getElementById("status");
const emptyState = document.getElementById("emptyState");
const reportFrame = document.getElementById("reportFrame");
const resultsToolbar = document.getElementById("resultsToolbar");
const resultsMeta = document.getElementById("resultsMeta");
const appLayout = document.getElementById("appLayout");
const uploadClip = document.getElementById("uploadClip");
const uploadPanelShell = document.getElementById("uploadPanelShell");
const resultsSection = document.getElementById("resultsSection");
const btnRevealUpload = document.getElementById("btnRevealUpload");
const siteNav = document.getElementById("siteNav");
const serverStatusEl = document.getElementById("serverStatus");

const ANIM_MS = 520;

let lastHtml = "";
let expandCooldown = false;
let serverReady = false;

function setServerStatus(phase, options) {
  if (!serverStatusEl) return;
  if (typeof ConverterStatusUI !== "undefined") {
    ConverterStatusUI.setElement(serverStatusEl, phase, options || {});
  } else {
    serverStatusEl.textContent = options?.text || phase;
  }
  requestAnimationFrame(() => {
    measureLayout();
    window.setTimeout(measureLayout, 80);
  });
}

function setStatus(phase, options) {
  statusEl.hidden = false;
  if (typeof ConverterStatusUI !== "undefined") {
    ConverterStatusUI.setElement(statusEl, phase, options || {});
    return;
  }
  statusEl.className = `status ${options?.kind || ""}`;
  statusEl.textContent = options?.text || phase;
}

function updateConvertButtonState() {
  if (!btnConvert) return;
  const hasFiles = pdfUpload?.files?.[0] && xlsxUpload?.files?.[0];
  btnConvert.disabled = !serverReady || !hasFiles;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
}

function getNavBottom() {
  return siteNav ? siteNav.getBoundingClientRect().bottom : 0;
}

function measureLayout() {
  if (siteNav) {
    document.documentElement.style.setProperty("--nav-offset", `${siteNav.offsetHeight}px`);
  }
  if (uploadPanelShell) {
    document.documentElement.style.setProperty("--upload-panel-h", `${uploadPanelShell.offsetHeight}px`);
    const rect = uploadPanelShell.getBoundingClientRect();
    const hideDistance = Math.max(uploadPanelShell.offsetHeight, rect.bottom - getNavBottom() + 12);
    document.documentElement.style.setProperty("--upload-hide-distance", `${hideDistance}px`);
  }
}

function fitReportFrame() {
  const doc = reportFrame.contentDocument;
  if (!doc?.body) return;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const height = Math.max(
    doc.documentElement.scrollHeight,
    doc.documentElement.offsetHeight,
    doc.body.scrollHeight,
    doc.body.offsetHeight,
    320,
  ) + 32;
  reportFrame.style.height = `${height}px`;
  window.scrollTo(scrollX, scrollY);
}

function scheduleReportFrameFit() {
  fitReportFrame();
  [80, 200, 500, 1000, 1800].forEach((delay) => window.setTimeout(fitReportFrame, delay));
}

function collapseUploadPanel() {
  if (!appLayout.classList.contains("has-results") || expandCooldown) return;
  measureLayout();
  uploadClip.classList.add("is-collapsed");
  appLayout.classList.add("upload-collapsed");
  btnRevealUpload.hidden = false;
}

function expandUploadPanel() {
  expandCooldown = true;
  uploadClip.classList.remove("is-collapsed");
  appLayout.classList.remove("upload-collapsed");
  btnRevealUpload.hidden = true;
  measureLayout();

  const navBottom = getNavBottom();
  const targetTop = uploadPanelShell.getBoundingClientRect().top + window.scrollY - navBottom - 10;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });

  window.setTimeout(() => {
    expandCooldown = false;
    measureLayout();
  }, ANIM_MS + 200);
}

function exitResultsFocus() {
  uploadClip?.classList.remove("is-collapsed");
  appLayout.classList.remove("has-results", "upload-collapsed");
  document.body.classList.remove("has-results-focus");
  btnRevealUpload.hidden = true;
  measureLayout();
}

function scrollToResults() {
  const top = resultsSection.getBoundingClientRect().top + window.scrollY - getNavBottom() - 8;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function enterResultsFocus(metaText) {
  document.body.classList.add("has-results-focus");
  appLayout.classList.add("has-results");
  measureLayout();
  requestAnimationFrame(() => {
    collapseUploadPanel();
    window.setTimeout(() => {
      scrollToResults();
      scheduleReportFrameFit();
    }, ANIM_MS);
  });
}

function showReport(html, metaText) {
  lastHtml = html;
  clearStatus();
  emptyState.hidden = true;
  reportFrame.hidden = false;
  resultsToolbar.hidden = false;
  resultsMeta.textContent = metaText || "";
  reportFrame.onload = () => {
    scheduleReportFrameFit();
    const doc = reportFrame.contentDocument;
    if (doc && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => fitReportFrame());
      ro.observe(doc.body);
    }
  };
  reportFrame.srcdoc = html;
  enterResultsFocus(metaText || "Отчёт готов");
}

function resetView() {
  lastHtml = "";
  emptyState.hidden = false;
  reportFrame.hidden = true;
  reportFrame.srcdoc = "";
  reportFrame.style.height = "320px";
  resultsToolbar.hidden = true;
  resultsMeta.textContent = "";
  exitResultsFocus();
}

async function convertFiles(pdfFile, xlsxFile) {
  emptyState.hidden = true;
  reportFrame.hidden = true;
  resultsToolbar.hidden = false;
  document.body.classList.add("has-results-focus");
  appLayout.classList.add("has-results");
  measureLayout();
  collapseUploadPanel();
  scrollToResults();
  btnConvert.disabled = true;
  setStatus("start", { kind: "loading" });

  try {
    const payload = await ZalogApiClient.postZalogConvert(API_BASE, pdfFile, xlsxFile, {
      onProgress(attempt, max, a, b, phase) {
        if (phase === "retry") {
          setStatus("retry", { kind: "loading" });
        } else if (phase) {
          const p = ConverterStatusUI?.phaseFromProgress(phase) || "processing";
          setStatus(p, { kind: "loading" });
        }
      },
      onRetry() {
        setStatus("retry", { kind: "loading" });
      },
    });

    const conclusion = payload.data?.conclusion || {};
    const objectCount = payload.data?.object_count || 0;
    const meta = [
      conclusion.conclusion_number ? `№ ${conclusion.conclusion_number}` : null,
      conclusion.conclusion_date ? `от ${conclusion.conclusion_date}` : null,
      `${objectCount} объект(ов)`,
    ]
      .filter(Boolean)
      .join(" · ");

    showReport(payload.html, meta);
  } catch (error) {
    resetView();
    const msg = typeof ConverterStatusUI !== "undefined"
      ? ConverterStatusUI.friendlyError(error?.message)
      : (error.message || String(error));
    setStatus("error", { kind: "error", text: msg });
  } finally {
    btnConvert.disabled = false;
  }
}

btnConvert.addEventListener("click", () => {
  const pdfFile = pdfUpload.files?.[0];
  const xlsxFile = xlsxUpload.files?.[0];
  if (!pdfFile || !xlsxFile) {
    setStatus("error", { kind: "error", text: "Загрузите оба файла: PDF заключение и XLSX перечень залога" });
    return;
  }
  if (!serverReady) {
    setStatus("error", { kind: "error", text: "Подождите — платформа ещё готовится к работе" });
    return;
  }
  convertFiles(pdfFile, xlsxFile);
});

pdfUpload?.addEventListener("change", updateConvertButtonState);
xlsxUpload?.addEventListener("change", updateConvertButtonState);

btnRevealUpload.addEventListener("click", expandUploadPanel);

window.addEventListener("resize", () => {
  measureLayout();
  fitReportFrame();
});
measureLayout();
updateConvertButtonState();

if (uploadPanelShell && typeof ResizeObserver !== "undefined") {
  const uploadPanelObserver = new ResizeObserver(() => measureLayout());
  uploadPanelObserver.observe(uploadPanelShell);
}

async function initServerConnection() {
  if (typeof ZalogApiClient === "undefined") {
    setServerStatus("error", {
      kind: "error",
      text: "Не удалось загрузить конвертер. Обновите страницу (Ctrl+Shift+R)."
    });
    return;
  }
  ZalogApiClient.startKeepAlive(API_BASE, () => {});
  setServerStatus("waiting", { kind: "loading" });
  btnConvert.disabled = true;
  try {
    await ZalogApiClient.wakeZalogServer(API_BASE, {
      maxAttempts: 50,
      delayMs: 2000,
      onProgress() {
        setServerStatus("wake", { kind: "loading" });
      },
    });
    serverReady = true;
    const readyText = typeof ConverterStatusUI !== "undefined"
      ? ConverterStatusUI.pickPhrase("ready")
      : "Сервер готов — можно загружать файлы";
    setServerStatus("ready", { kind: "success", text: readyText });
  } catch (e) {
    serverReady = false;
    const msg = typeof ConverterStatusUI !== "undefined"
      ? ConverterStatusUI.friendlyError(e?.message)
      : (e.message || "Сервер недоступен");
    setServerStatus("error", { kind: "error", text: msg });
  }
  updateConvertButtonState();
}

initServerConnection();

btnClear.addEventListener("click", () => {
  pdfUpload.value = "";
  xlsxUpload.value = "";
  resetView();
  clearStatus();
});

function pdfFilename() {
  const meta = resultsMeta.textContent || "";
  const match = meta.match(/№\s*([^\s·]+)/);
  if (match) {
    const safe = match[1].replace(/[^\w.-]+/g, "_");
    return `zalog_${safe}.pdf`;
  }
  return "zalog_report.pdf";
}

async function downloadReportPdf() {
  if (!lastHtml) return;
  if (typeof ZalogPdfExport === "undefined") {
    setStatus("error", { kind: "error", text: "Не удалось загрузить модуль PDF. Обновите страницу." });
    return;
  }

  const hadStatus = !statusEl.hidden;
  btnDownload.disabled = true;
  setStatus("processing", { kind: "loading", text: "Формируем PDF для скачивания…" });

  try {
    await ZalogPdfExport.exportReportHtmlToPdf(lastHtml, pdfFilename());
    if (!hadStatus) clearStatus();
  } catch (error) {
    setStatus("error", { kind: "error", text: error.message || "Не удалось сохранить PDF" });
  } finally {
    btnDownload.disabled = false;
  }
}

btnDownload.addEventListener("click", () => {
  downloadReportPdf();
});

btnPrint.addEventListener("click", () => {
  if (!reportFrame.contentWindow) return;
  reportFrame.contentWindow.focus();
  reportFrame.contentWindow.print();
});
