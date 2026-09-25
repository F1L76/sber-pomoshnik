(() => {
  const root = document.querySelector(".ideas-page");
  if (!root) return;

  const user = root.dataset.user || "Аноним";
  const board = document.getElementById("ideasBoard") || root;
  const VIEW_KEY = "upgrade.ideasView";

  function normalizeView(mode) {
    if (mode === "list" || mode === "expanded") return "list";
    return "tiles"; // tiles | compact | anything else
  }

  function setView(mode) {
    const next = normalizeView(mode);
    root.classList.toggle("ideas-view--tiles", next === "tiles");
    root.classList.toggle("ideas-view--list", next === "list");
    root.classList.remove("ideas-view--compact", "ideas-view--expanded");
    root.dataset.view = next;
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch (_) {
      /* ignore */
    }

    document.querySelectorAll("[data-view-switch] [data-view]").forEach((btn) => {
      const on = btn.dataset.view === next;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // Both views start collapsed; details open via «Подробнее»
    document.querySelectorAll(".idea-card").forEach((card) => closeCard(card));
  }

  function setProgressRings() {
    document.querySelectorAll(".progress-ring").forEach((ring) => {
      const value = Number(ring.dataset.progress || 0);
      const circle = ring.querySelector(".progress-ring__value");
      if (!circle) return;
      const radius = 18;
      const circumference = 2 * Math.PI * radius;
      circle.style.strokeDasharray = `${circumference}`;
      circle.style.strokeDashoffset = `${circumference * (1 - Math.min(Math.max(value, 0), 100) / 100)}`;
    });
  }

  function activateStage(card, step) {
    const panel = card.querySelector(".stage-panel");
    if (!panel || !step) return;

    const details = card.querySelector(".idea-card__details");
    if (details && details.hasAttribute("hidden")) {
      openCard(card);
    }

    card.querySelectorAll(".pipeline__step").forEach((el) => {
      el.classList.remove("is-active");
      el.setAttribute("aria-selected", "false");
    });
    const name = step.dataset.stageName || "";
    card.querySelectorAll(`.pipeline__step[data-stage-name="${CSS.escape(name)}"]`).forEach((el) => {
      el.classList.add("is-active");
      el.setAttribute("aria-selected", "true");
    });

    panel.classList.remove("is-flash");
    void panel.offsetWidth;
    panel.classList.add("is-flash");

    const owner = (step.dataset.stageOwner || "").trim();
    const isEval = name === "Оценка";
    const isTest = name === "Пилот";
    const isProtoDev = name === "Разработка прототипа";

    panel.querySelector(".stage-panel__name").textContent = name;
    panel.querySelector(".stage-panel__status").textContent = step.dataset.stageStatus || "";
    panel.querySelector(".stage-panel__desc").textContent = step.dataset.stageDesc || "";

    const drawer = card.querySelector("[data-stage-drawer]");
    if (drawer) {
      drawer.open = true;
      const preview = drawer.querySelector(".stage-drawer__preview");
      if (preview) {
        preview.textContent = `${name}${step.dataset.stageStatus ? " · " + step.dataset.stageStatus : ""}`;
      }
    }

    const ownerEl = panel.querySelector(".stage-panel__owner");
    const ownerPill = panel.querySelector(".stage-panel__owner-pill");
    if (ownerEl) ownerEl.textContent = owner || "—";
    if (ownerPill) ownerPill.classList.toggle("is-hidden", !owner);

    const bundle = panel.querySelector("[data-eval-bundle]");
    const testWrap = panel.querySelector("[data-test-wrap]");
    const protoUpload = panel.querySelector("[data-proto-upload]");
    const actionsRate = panel.querySelector("[data-actions-rate]");
    if (bundle) bundle.classList.toggle("is-hidden", !isEval);
    if (testWrap) testWrap.classList.toggle("is-hidden", !isTest);
    if (protoUpload) protoUpload.classList.toggle("is-hidden", !isProtoDev && !isTest);
    if (actionsRate) actionsRate.classList.toggle("is-hidden", isEval || isTest);

    panel.setAttribute("aria-labelledby", step.id || "");
  }

  function openCard(card) {
    const details = card.querySelector(".idea-card__details");
    const btn = card.querySelector("[data-toggle-card]");
    if (!details) return;
    details.removeAttribute("hidden");
    card.classList.add("is-open");
    if (btn) {
      btn.textContent = "Свернуть";
      btn.setAttribute("aria-expanded", "true");
    }
    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function closeCard(card) {
    const details = card.querySelector(".idea-card__details");
    const btn = card.querySelector("[data-toggle-card]");
    if (!details) return;
    details.setAttribute("hidden", "");
    card.classList.remove("is-open");
    if (btn) {
      btn.textContent = "Подробнее";
      btn.setAttribute("aria-expanded", "false");
    }
  }

  board?.addEventListener("click", async (event) => {
    const step = event.target.closest(".pipeline__step");
    if (
      step &&
      !event.target.closest(
        ".star-btn, .fav-btn, a, button.btn, .test-bundle, input, textarea, select, label, button.text-toggle"
      )
    ) {
      activateStage(step.closest(".idea-card"), step);
      return;
    }

    const toggleCard = event.target.closest("[data-toggle-card]");
    if (toggleCard) {
      const card = toggleCard.closest(".idea-card");
      if (card.classList.contains("is-open")) closeCard(card);
      else {
        document.querySelectorAll(".idea-card.is-open").forEach((other) => {
          if (other !== card) closeCard(other);
        });
        openCard(card);
      }
      return;
    }

    const toggle = event.target.closest("[data-toggle-extras]");
    if (toggle) {
      const card = toggle.closest(".idea-card");
      const extras = card.querySelector(".idea-card__extras");
      if (!extras) return;
      const open = extras.hasAttribute("hidden");
      if (open) extras.removeAttribute("hidden");
      else extras.setAttribute("hidden", "");
      card.classList.toggle("is-expanded", open);
      toggle.textContent = open ? "Свернуть" : "Подробнее об идее";
      return;
    }

    const star = event.target.closest(".star-btn");
    if (star) {
      const box = star.closest("[data-rate-box]");
      const ideaId = box.dataset.ideaId;
      const score = star.dataset.score;
      const row = star.parentElement;
      row.querySelectorAll(".star-btn").forEach((btn) => {
        btn.classList.toggle("is-on", Number(btn.dataset.score) <= Number(score));
      });
      try {
        const res = await fetch(`/api/ideas/${ideaId}/rate?user=${encodeURIComponent(user)}&score=${score}`, {
          method: "POST",
        });
        const data = await res.json();
        const label = box.querySelector(".star-rate__value");
        if (label && data.avgRating != null) {
          const text = `★ ${data.avgRating}`;
          box.querySelectorAll(".star-rate__value").forEach((el) => {
            el.textContent = text;
            el.classList.add("is-pop");
            setTimeout(() => el.classList.remove("is-pop"), 400);
          });
        }
      } catch (_) {
        /* ignore */
      }
      return;
    }

    const statusBtn = event.target.closest("[data-toggle-issue-status]");
    if (statusBtn) {
      const issueId = statusBtn.dataset.issueId;
      const next = statusBtn.dataset.nextStatus;
      try {
        const res = await fetch(`/api/test-issues/${issueId}/status?status=${encodeURIComponent(next)}`, {
          method: "POST",
        });
        const data = await res.json();
        const item = statusBtn.closest(".test-item");
        item.classList.toggle("test-item--fixed", data.status === "FIXED");
        const badge = item.querySelector(".badge");
        if (badge) badge.textContent = data.statusLabel;
        statusBtn.dataset.nextStatus = data.status === "OPEN" ? "FIXED" : "OPEN";
        statusBtn.textContent = data.status === "OPEN" ? "Отметить исправленным" : "Вернуть в открытые";
      } catch (_) {
        /* ignore */
      }
      return;
    }

    const fav = event.target.closest(".fav-btn");
    if (fav) {
      const ideaId = fav.dataset.ideaId;
      try {
        const res = await fetch(`/api/ideas/${ideaId}/favorite?user=${encodeURIComponent(user)}`, {
          method: "POST",
        });
        const data = await res.json();
        fav.classList.toggle("is-on", !!data.favorite);
        fav.setAttribute("aria-pressed", data.favorite ? "true" : "false");
        if (fav.classList.contains("btn--sm") || fav.textContent.trim().length <= 2) {
          fav.textContent = data.favorite ? "★" : "☆";
          fav.title = data.favorite ? "В избранном" : "В избранное";
        } else {
          fav.textContent = data.favorite ? "В избранном" : "В избранное";
        }
      } catch (_) {
        /* ignore */
      }
    }
  });

  board?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-test-form]");
    if (!form) return;
    event.preventDefault();
    const bundle = form.closest("[data-test-bundle]");
    const ideaId = bundle.dataset.ideaId;
    const hint = form.querySelector("[data-test-hint]");
    const fd = new FormData(form);
    try {
      const res = await fetch(`/api/ideas/${ideaId}/test-issues`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (hint) hint.textContent = err.message || "Не удалось отправить";
        return;
      }
      const data = await res.json();
      const feed = bundle.querySelector("[data-test-feed]");
      const empty = feed.querySelector("[data-test-empty]");
      if (empty) empty.remove();
      feed.insertAdjacentHTML("afterbegin", renderIssue(data));
      form.reset();
      const authorInput = form.querySelector('[name="author"]');
      if (authorInput) authorInput.value = user;
      if (hint) hint.textContent = "Сохранено";
      setTimeout(() => {
        if (hint) hint.textContent = "";
      }, 1600);
    } catch (_) {
      if (hint) hint.textContent = "Ошибка сети";
    }
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderIssue(data) {
    const fixed = data.status === "FIXED";
    let attach = "";
    if (data.hasAttachment && data.attachmentUrl) {
      if (data.image) {
        attach = `<div class="test-item__attach"><img src="${escapeHtml(data.attachmentUrl)}" alt="${escapeHtml(data.attachmentName || "")}"></div>`;
      } else if (data.video) {
        attach = `<div class="test-item__attach"><video controls src="${escapeHtml(data.attachmentUrl)}"></video></div>`;
      } else {
        attach = `<div class="test-item__attach"><a class="text-link" href="${escapeHtml(data.attachmentUrl)}" target="_blank" rel="noopener">${escapeHtml(data.attachmentName || "файл")}</a></div>`;
      }
    }
    return `<article class="test-item${fixed ? " test-item--fixed" : ""}" data-issue-id="${data.id}">
      <header class="test-item__head">
        <div>
          <strong>${escapeHtml(data.author)}</strong>
          <span class="tag">${escapeHtml(data.role)}</span>
        </div>
        <div class="test-item__meta">
          <span class="badge">${escapeHtml(data.statusLabel)}</span>
          <button type="button" class="text-toggle" data-toggle-issue-status data-issue-id="${data.id}" data-next-status="${fixed ? "OPEN" : "FIXED"}">
            ${fixed ? "Вернуть в открытые" : "Отметить исправленным"}
          </button>
        </div>
      </header>
      <p class="test-item__message">${escapeHtml(data.message)}</p>
      ${attach}
    </article>`;
  }

  board?.addEventListener("keydown", (event) => {
    const step = event.target.closest(".pipeline__step");
    if (!step) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateStage(step.closest(".idea-card"), step);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const steps = [...step.parentElement.querySelectorAll(".pipeline__step")];
      const idx = steps.indexOf(step);
      const next = event.key === "ArrowRight" ? steps[idx + 1] : steps[idx - 1];
      if (next) {
        next.focus();
        activateStage(step.closest(".idea-card"), next);
      }
    }
  });

  function normalizeStageName(name) {
    const value = (name || "").trim();
    if (value === "Внедрение") return "Внедрено";
    return value;
  }

  function cardStage(card) {
    const fromAttr = normalizeStageName(card.getAttribute("data-current-stage"));
    if (fromAttr) return fromAttr;
    const badge = card.querySelector(".idea-tile__stage");
    return normalizeStageName(badge ? badge.textContent : "");
  }

  function applyBoardFilter() {
    const stages = activeStageFilters();
    const q = (document.getElementById("ideasSearch")?.value || "").trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll("#ideasBoard .idea-card").forEach((card) => {
      const current = cardStage(card);
      const stageOk = stages.length === 0 || stages.includes("all") || stages.includes(current);
      const textOk = !q || card.textContent.toLowerCase().includes(q);
      const show = stageOk && textOk;
      card.hidden = !show;
      card.classList.toggle("is-stage-hidden", !show);
      if (show) visible += 1;
    });
    const empty = document.getElementById("chipEmpty");
    if (empty) empty.hidden = visible > 0;
  }

  function setChipOn(chip, on) {
    chip.classList.toggle("chip--on", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function activeStageFilters() {
    return [...document.querySelectorAll(".stage-chips [data-stage-filter].chip--on")]
      .map((chip) => normalizeStageName(chip.getAttribute("data-stage-filter")))
      .filter(Boolean);
  }

  document.querySelector(".stage-chips")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-stage-filter]");
    if (!chip) return;
    event.preventDefault();
    const value = chip.getAttribute("data-stage-filter");
    const chips = [...document.querySelectorAll(".stage-chips [data-stage-filter]")];
    const allChip = chips.find((c) => c.getAttribute("data-stage-filter") === "all");
    const stageChips = chips.filter((c) => c.getAttribute("data-stage-filter") !== "all");

    if (value === "all") {
      chips.forEach((c) => setChipOn(c, c === allChip));
    } else {
      setChipOn(chip, !chip.classList.contains("chip--on"));
      const selected = stageChips.filter((c) => c.classList.contains("chip--on"));
      if (selected.length === 0) {
        if (allChip) setChipOn(allChip, true);
      } else {
        if (allChip) setChipOn(allChip, false);
      }
    }
    applyBoardFilter();
  });

  applyBoardFilter();

  const search = document.getElementById("ideasSearch");
  let searchTimer;
  search?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyBoardFilter, 160);
  });

  document.querySelector("[data-view-switch]")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-view]");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  let savedView = "tiles";
  try {
    savedView = localStorage.getItem(VIEW_KEY) || "tiles";
  } catch (_) {
    /* ignore */
  }
  setView(savedView);

  setProgressRings();

  const descTip = document.createElement("div");
  descTip.className = "idea-tile__desc-tip";
  descTip.setAttribute("role", "tooltip");
  document.body.appendChild(descTip);
  let tipHideTimer = null;

  function placeDescTip(anchor) {
    const rect = anchor.getBoundingClientRect();
    const tipWidth = Math.min(360, window.innerWidth - 24);
    let left = rect.left;
    if (left + tipWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - tipWidth - 12);
    }
    descTip.style.width = tipWidth + "px";
    descTip.style.left = left + "px";
    descTip.style.top = "0px";
    descTip.classList.add("is-on");
    const tipH = descTip.offsetHeight;
    let top = rect.bottom + 8;
    if (top + tipH > window.innerHeight - 12) {
      top = Math.max(12, rect.top - tipH - 8);
    }
    descTip.style.top = top + "px";
  }

  function showDescTip(anchor) {
    clearTimeout(tipHideTimer);
    const text = (anchor.getAttribute("data-full-desc") || "").trim();
    if (!text) return;
    descTip.textContent = text;
    placeDescTip(anchor);
  }

  function hideDescTip() {
    tipHideTimer = setTimeout(() => {
      descTip.classList.remove("is-on");
      descTip.textContent = "";
    }, 80);
  }

  document.addEventListener("mouseover", (event) => {
    const wrap = event.target.closest(".idea-tile__desc-wrap");
    if (!wrap || !root.contains(wrap)) return;
    showDescTip(wrap);
  });
  document.addEventListener("mouseout", (event) => {
    const wrap = event.target.closest(".idea-tile__desc-wrap");
    if (!wrap || !root.contains(wrap)) return;
    const to = event.relatedTarget;
    if (to && (wrap.contains(to) || descTip.contains(to))) return;
    hideDescTip();
  });
  descTip.addEventListener("mouseenter", () => clearTimeout(tipHideTimer));
  descTip.addEventListener("mouseleave", hideDescTip);
  window.addEventListener("scroll", () => {
    if (descTip.classList.contains("is-on")) hideDescTip();
  }, true);
})();
