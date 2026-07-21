/**
 * Дружелюбный UI статуса конвертера (без технических деталей).
 */
(function (global) {
    const CAT_GIF = "/assets/loading-dancing-cat.gif";
    const CAT_GIF_FALLBACK = "https://media1.tenor.com/m/2YJ8ecS0GBkAAAAC/cat-cats.gif";

    const PHRASES = {
        wake: [
            "Разбудим цифрового помощника — он обожает свежие заключения",
            "Готовим рабочее место для вашего сводного отчёта",
            "Платформа встречает документы — скоро начнём магию",
            "Собираемся с мыслями перед разбором заключения"
        ],
        upload: [
            "Читаем заключение и перечень залога, как внимательный эксперт",
            "Сопоставляем PDF с таблицей объектов обеспечения",
            "Аккуратно переносим данные в обработку",
            "Сверяем цифры и формулировки из двух файлов"
        ],
        processing: [
            "Собираем риски, объекты и пересказ в единый отчёт",
            "Находим риски и подбираем формулировки минимизации",
            "Почти готово — выверяем сводную форму заключения",
            "Складываем пазл из PDF и перечня залога",
            "Формируем понятный отчёт для сопровождения сделки"
        ],
        retry: [
            "Минутку — пробуем снова, котик верит в успех",
            "Небольшая пауза, и продолжим собирать отчёт",
            "Ещё одна попытка — хорошие заключения того стоят"
        ],
        start: [
            "Запускаем преобразование заключения",
            "Начинаем собирать сводный отчёт"
        ],
        success: [
            "Готово! Заключение собрано в аккуратный отчёт",
            "Сводный отчёт готов — можно изучать детали"
        ],
        ready: [
            "Сервер готов — можно загружать файлы",
            "Всё на месте, ждём PDF и перечень залога"
        ],
        waiting: [
            "Подключаемся к платформе…",
            "Готовим конвертер к работе"
        ],
        inn: [
            "Смотрю заявки клиента в Залоговой службе…",
            "Сверяю этапы экспертизы и даты по карточке…",
            "Ищу свежие заключения и материалы по ИНН…",
            "Проверяю, на каком шаге сейчас обеспечение…",
            "Собираю понятную картину по клиенту…"
        ]
    };

    const counters = {};

    function pickPhrase(phase) {
        const list = PHRASES[phase] || PHRASES.processing;
        const i = (counters[phase] || 0) % list.length;
        counters[phase] = i + 1;
        return list[i];
    }

    function renderBusy(phase, options) {
        const opts = options || {};
        const text = opts.text || pickPhrase(phase);
        const kind = opts.kind || "loading";
        // ponytail: idle-статусы без 1 МБ GIF — иначе главная тормозит
        const light = phase === "waiting" || phase === "ready" || phase === "wake";
        if (light && !opts.forceCat) {
            const icon =
                kind === "success"
                    ? "fa-circle-check text-success"
                    : "fa-spinner fa-spin text-success";
            return (
                `<div class="converter-busy converter-busy--${kind}" role="status" aria-live="polite">` +
                `<i class="fas ${icon} converter-busy-icon" aria-hidden="true"></i>` +
                `<div class="converter-busy-phrase"><p class="converter-busy-text mb-0">${text}</p></div></div>`
            );
        }
        return (
            `<div class="converter-busy converter-busy--${kind}" role="status" aria-live="polite">` +
            `<img class="converter-busy-cat" src="${CAT_GIF}" alt="" width="140" height="140" decoding="async" loading="eager" fetchpriority="high" onerror="this.onerror=null;this.src='${CAT_GIF_FALLBACK}'">` +
            `<div class="converter-busy-phrase"><p class="converter-busy-text mb-0">${text}</p></div>` +
            `</div>`
        );
    }

    function renderSimple(message, kind) {
        const k = kind || "loading";
        if (k === "loading" || k === "warning") {
            return renderBusy("processing", { text: message, kind: k });
        }
        if (k === "success") {
            return (
                `<div class="converter-busy converter-busy--success" role="status">` +
                `<i class="fas fa-circle-check converter-busy-icon text-success" aria-hidden="true"></i>` +
                `<div class="converter-busy-phrase"><p class="converter-busy-text mb-0">${message}</p></div></div>`
            );
        }
        if (k === "error" || k === "danger") {
            return (
                `<div class="converter-busy converter-busy--error" role="alert">` +
                `<i class="fas fa-circle-xmark converter-busy-icon text-danger" aria-hidden="true"></i>` +
                `<div class="converter-busy-phrase"><p class="converter-busy-text mb-0">${message}</p></div></div>`
            );
        }
        return `<div class="converter-busy converter-busy--${k}"><div class="converter-busy-phrase"><p class="converter-busy-text mb-0">${message}</p></div></div>`;
    }

    function setElement(el, phase, options) {
        if (!el) return;
        const opts = options || {};
        if (opts.kind === "success" || opts.kind === "error" || opts.kind === "danger") {
            el.innerHTML = renderSimple(opts.text || pickPhrase(phase), opts.kind);
            return;
        }
        const mapPhase =
            phase === "wake" ? "wake"
            : phase === "upload" || phase === "upload-json" ? "upload"
            : phase === "retry" ? "retry"
            : phase === "start" ? "start"
            : phase === "ready" ? "ready"
            : phase === "waiting" ? "waiting"
            : "processing";
        el.innerHTML = renderBusy(mapPhase, { text: opts.text, kind: opts.kind || "loading" });
    }

    function phaseFromProgress(phase) {
        if (phase === "wake") return "wake";
        if (phase === "upload" || phase === "upload-json") return "upload";
        if (phase === "processing") return "processing";
        return "processing";
    }

    function friendlyError(message) {
        const msg = String(message || "").trim();
        if (!msg) return "Не удалось собрать отчёт. Попробуйте ещё раз через минуту.";
        if (/503|502|504|проснулся|Render|таймаут|aborted/i.test(msg)) {
            return "Платформа ещё не готова — подождите минуту и повторите";
        }
        if (/I\/O read operation failed|NotReadable|could not be read/i.test(msg)) {
            return (
                "Браузер не смог прочитать файл. Закройте его в Excel, убедитесь что файл на диске " +
                "(не только в облаке) и выберите оба файла заново."
            );
        }
        // не прячем полезный текст про файлы / Python
        return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
    }

    global.ConverterStatusUI = {
        CAT_GIF,
        pickPhrase,
        renderBusy,
        renderSimple,
        setElement,
        phaseFromProgress,
        friendlyError
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
