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

function setServerStatus(message, kind) {
  if (!serverStatusEl) return;
  serverStatusEl.className = `alert py-2 px-3 small mb-3 alert-${kind || "secondary"}`;
  serverStatusEl.innerHTML = message;
}

function updateConvertButtonState() {
  if (!btnConvert) return;
  const hasFiles = pdfUpload?.files?.[0] && xlsxUpload?.files?.[0];
  btnConvert.disabled = !serverReady || !hasFiles;
}

function setStatus(message, kind) {
  statusEl.hidden = false;
  statusEl.className = `status ${kind || ""}`;
  statusEl.textContent = message;
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
  reportFrame.style.height = "0px";
  const height = Math.max(
    doc.documentElement.scrollHeight,
    doc.documentElement.offsetHeight,
    doc.body.scrollHeight,
    doc.body.offsetHeight,
    320,
  ) + 32;
  reportFrame.style.height = `${height}px`;
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

  try {
    const payload = await ZalogApiClient.postZalogConvert(API_BASE, pdfFile, xlsxFile, {
      onProgress(attempt, max, a, b, phase) {
        if (phase === "wake" && a && b) {
          setStatus(`Сервер просыпается… ${a}/${b} (попытка ${attempt}/${max})`, "loading");
        } else if (phase === "upload") {
          setStatus("Загружаем PDF и XLSX на сервер…", "loading");
        } else if (phase === "processing" && a && b) {
          setStatus(`Конвертация… ${a}/${b}`, "loading");
        } else if (phase === "processing") {
          setStatus("Конвертация на сервере…", "loading");
        }
      },
      onRetry(attempt, max) {
        setStatus(`Повтор после 503… ${attempt}/${max}`, "loading");
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
    setStatus(error.message || String(error), "error");
  } finally {
    btnConvert.disabled = false;
  }
}

btnConvert.addEventListener("click", () => {
  const pdfFile = pdfUpload.files?.[0];
  const xlsxFile = xlsxUpload.files?.[0];
  if (!pdfFile || !xlsxFile) {
    setStatus("Загрузите оба файла: PDF заключение и XLSX перечень залога", "error");
    return;
  }
  if (!serverReady) {
    setStatus("Сервер ещё не готов. Подождите, пока индикатор станет зелёным.", "error");
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

async function initServerConnection() {
  if (typeof ZalogApiClient === "undefined") {
    setServerStatus('<i class="fas fa-circle-xmark me-1 text-danger" aria-hidden="true"></i>Не загружен клиент API. Обновите страницу (Ctrl+Shift+R).', "danger");
    return;
  }
  ZalogApiClient.startKeepAlive(API_BASE, () => {});
  setServerStatus('<i class="fas fa-spinner fa-spin me-1" aria-hidden="true"></i>Сервер просыпается (Render)… подождите до 2 мин', "warning");
  btnConvert.disabled = true;
  try {
    await ZalogApiClient.wakeZalogServer(API_BASE, {
      maxAttempts: 50,
      delayMs: 2000,
      onProgress(attempt, max) {
        setServerStatus(
          `<i class="fas fa-spinner fa-spin me-1" aria-hidden="true"></i>Сервер просыпается… ${attempt}/${max}`,
          "warning",
        );
      },
    });
    serverReady = true;
    setServerStatus('<i class="fas fa-circle-check me-1 text-success" aria-hidden="true"></i>Сервер готов. Можно конвертировать.', "success");
  } catch (e) {
    serverReady = false;
    setServerStatus(
      `<i class="fas fa-circle-xmark me-1 text-danger" aria-hidden="true"></i>${e.message || "Сервер недоступен"}`,
      "danger",
    );
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
  const doc = reportFrame.contentDocument;
  if (!doc?.body || !lastHtml) return;
  if (typeof html2pdf === "undefined") {
    setStatus("Не удалось загрузить библиотеку PDF. Проверьте интернет и обновите страницу.", "error");
    return;
  }

  const target = doc.querySelector(".report-page") || doc.body;
  const hadStatus = !statusEl.hidden;
  btnDownload.disabled = true;
  setStatus("Формируем PDF…", "loading");

  const savedFrame = {
    width: reportFrame.style.width,
    maxWidth: reportFrame.style.maxWidth,
    overflow: reportFrame.style.overflow,
  };
  let exportStyle = null;

  try {
    if (doc.fonts?.ready) {
      await doc.fonts.ready;
    }
    target.classList.add("pdf-export");
    await new Promise((resolve) => window.setTimeout(resolve, 350));

    const captureWidth = Math.max(target.scrollWidth, target.offsetWidth, 1280);
    exportStyle = doc.createElement("style");
    exportStyle.id = "pdf-export-viewport";
    exportStyle.textContent =
      `html, body { width: ${captureWidth}px !important; min-width: ${captureWidth}px !important; overflow: visible !important; }`;
    doc.head.appendChild(exportStyle);

    reportFrame.style.width = `${captureWidth + 32}px`;
    reportFrame.style.maxWidth = "none";
    reportFrame.style.overflow = "visible";
    await new Promise((resolve) => window.setTimeout(resolve, 80));

    await html2pdf()
      .set({
        margin: [6, 6, 6, 6],
        filename: pdfFilename(),
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 1.6,
          useCORS: true,
          letterRendering: true,
          scrollX: 0,
          scrollY: 0,
          width: captureWidth,
          windowWidth: captureWidth,
        },
        pagebreak: { mode: ["css", "legacy"] },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
      })
      .from(target)
      .save();
    if (!hadStatus) clearStatus();
  } catch (error) {
    setStatus(error.message || "Не удалось сохранить PDF", "error");
  } finally {
    target.classList.remove("pdf-export");
    exportStyle?.remove();
    reportFrame.style.width = savedFrame.width;
    reportFrame.style.maxWidth = savedFrame.maxWidth;
    reportFrame.style.overflow = savedFrame.overflow;
    scheduleReportFrameFit();
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
