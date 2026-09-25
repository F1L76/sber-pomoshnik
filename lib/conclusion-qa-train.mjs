/**
 * Тренажёр RAG: очередь по карте тем → правка → faq-seeds + eval-gold.
 * ponytail: themes.json задаёт приоритет дыр; индекс сбрасываем после save.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    searchConclusionQa,
    chooseAskMode,
    formatVerbatimAnswer,
    reloadConclusionQaIndex
} from "./conclusion-qa.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLD_PATH = path.join(__dirname, "..", "data", "gl_rag", "eval-gold.json");
const FAQ_PATH = path.join(__dirname, "..", "data", "gl_rag", "faq-seeds.jsonl");
const THEMES_PATH = path.join(__dirname, "..", "data", "gl_rag", "themes.json");

const STOP = new Set([
    "как", "что", "где", "когда", "какой", "какая", "какие", "можно", "нужно", "надо",
    "ли", "для", "или", "про", "при", "это", "эта", "этот", "эти", "есть", "будет",
    "было", "после", "перед", "также", "только", "если", "то", "не", "на", "по",
    "из", "от", "до", "со", "об", "за", "вы", "мы", "они", "он", "она", "его", "её"
]);

/** Fallback, если themes.json ещё не собран. */
const FALLBACK_RULES = [
    ["prio", "Приоритет", /приоритет/i],
    ["ekd", "Отсутствие документов в ЭКД", /экд|егрн|размещ/i],
    ["arb", "Арбитраж", /арбитраж|пересмотр.{0,25}стоим|не согласен/i],
    ["kk", "Категория качества", /кк|категор|комфорт|бланк/i],
    ["tech", "Технические вопросы (новый/ВТИ/переоценка)", /\bвти\b|тех.?изменен|переоценк/i],
    ["insp_aspect", "Аспект / СМС / пароль", /аспект|смс|пароль|самоосмотр|осмотр/i],
    ["szz", "СЗЗ / КЗЗ / форма заключения", /сзз|бессрочн|\bбсз\b/i],
    ["status", "Статус заявки", /статус заяв|срок выпуска/i],
    ["disc", "Дисконт", /дисконт|ликвидацион/i],
    ["auto", "Автооценка", /автооцен/i]
];

function loadThemes() {
    try {
        return JSON.parse(fs.readFileSync(THEMES_PATH, "utf8"));
    } catch {
        return { priority_order: [], themes: [], classifier_rules: [] };
    }
}

function themeRules(themesDoc) {
    const rules = themesDoc.classifier_rules || [];
    if (!rules.length) return FALLBACK_RULES;
    return rules.map((r) => [r.id, r.name, new RegExp(r.pattern, "i")]);
}

function loadGold() {
    return JSON.parse(fs.readFileSync(GOLD_PATH, "utf8"));
}

function saveGold(gold) {
    fs.writeFileSync(GOLD_PATH, JSON.stringify(gold, null, 2) + "\n", "utf8");
}

function loadFaqLines() {
    if (!fs.existsSync(FAQ_PATH)) return [];
    return fs
        .readFileSync(FAQ_PATH, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
}

function nextFaqId(lines) {
    let max = 0;
    for (const line of lines) {
        try {
            const id = JSON.parse(line).id || "";
            const m = String(id).match(/faq-(\d+)/i);
            if (m) max = Math.max(max, Number(m[1]));
        } catch {
            /* skip */
        }
    }
    return `faq-${String(max + 1).padStart(4, "0")}`;
}

function normKey(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

export function classifyTheme(question, themesDoc) {
    const q = String(question || "");
    const doc = themesDoc || loadThemes();
    for (const [id, name, re] of themeRules(doc)) {
        if (re.test(q)) return { theme_id: id, theme_name: name };
    }
    return { theme_id: "other", theme_name: "Прочее" };
}

function themeMeta(themesDoc, themeId) {
    const list = themesDoc.themes || [];
    const base = String(themeId || "").replace(/_\d+$/, "");
    const t = list.find((x) => x.id === themeId) || list.find((x) => x.id === base);
    const priority = themesDoc.priority_order || [];
    let rank = priority.indexOf(themeId);
    if (rank < 0) rank = priority.indexOf(base);
    if (rank < 0) {
        rank = 100 + (t?.gap === "high" ? 0 : t?.gap === "medium" ? 1 : 2);
    }
    const nameFromRules = themeRules(themesDoc).find((r) => r[0] === base)?.[1];
    return {
        theme_id: themeId,
        theme_name: t?.name || nameFromRules || "Прочее",
        theme_group: t?.group || null,
        theme_gap: t?.gap || (themeId === "other" ? "high" : "low"),
        theme_rank: rank,
        theme_share: t?.share_in_group ?? null,
        theme_faq: t?.faq ?? null
    };
}

function previewForQuestion(q) {
    const search = searchConclusionQa(q, { limit: 5 });
    if (!search.ok) {
        return {
            ok: false,
            error: search.error || "поиск недоступен",
            mode: "empty",
            answer: "",
            hits: []
        };
    }
    const decided = chooseAskMode(search.hits || []);
    const hits = decided.hits || search.hits || [];
    let answer = "";
    if (hits[0]) answer = formatVerbatimAnswer(hits[0].answer);
    return {
        ok: true,
        mode: decided.mode || "empty",
        reason: decided.reason || null,
        answer,
        hits: hits.map((h) => ({
            id: h.id,
            collection: h.collection,
            score: h.score,
            question: h.question,
            answer: String(h.answer || "").slice(0, 500)
        }))
    };
}

/** Маркеры для eval: 2–4 значимых токена из ответа. */
export function markersFromAnswer(answer, question = "") {
    const blob = `${question}\n${answer}`.toLowerCase().replace(/ё/g, "е");
    const toks = (blob.match(/[а-яa-z0-9]{4,}/g) || [])
        .filter((t) => !STOP.has(t))
        .map((t) => (t.length > 8 ? t.slice(0, 8) : t));
    const uniq = [...new Set(toks)];
    const must = uniq.slice(0, 4);
    return { must, must_any: [] };
}

function buildQueue(gold, themesDoc) {
    const seenQ = new Set();
    const items = gold.items || [];
    const queue = [];

    for (const it of items) {
        const cls = classifyTheme(it.q, themesDoc);
        const meta = themeMeta(themesDoc, cls.theme_id);
        meta.theme_name = cls.theme_name;
        const row = {
            id: it.id,
            q: it.q,
            has_correction: !!it.has_correction,
            reference: it.reference || "",
            note: it.note || "",
            needs_work: !it.has_correction,
            mode: it.has_correction ? "corrected" : "pending",
            seed: false,
            ...meta
        };
        queue.push(row);
        seenQ.add(normKey(it.q));
    }

    // семена: до 2 официальных примеров / essence на приоритетную дыру
    const priority = themesDoc.priority_order || [];
    for (const tid of priority) {
        const t = (themesDoc.themes || []).find((x) => x.id === tid);
        if (!t || t.gap === "low") continue;
        const goldInTheme = queue.filter((x) => {
            const base = String(x.theme_id || "").replace(/_\d+$/, "");
            return (x.theme_id === tid || base === tid.replace(/_\d+$/, "")) && !x.seed;
        }).length;
        if (goldInTheme >= 3) continue;
        const seeds = [];
        if (t.essence) seeds.push(t.essence);
        for (const ex of t.examples || []) seeds.push(ex);
        let added = 0;
        for (const ex of seeds) {
            if (added >= 2) break;
            const key = normKey(ex);
            if (!key || seenQ.has(key) || key.length < 16) continue;
            seenQ.add(key);
            // формулировка для тренажёра: имя темы + суть
            const q = /[?]/.test(ex) ? ex : `${t.name}: ${ex}`;
            const meta = themeMeta(themesDoc, tid);
            meta.theme_name = t.name;
            queue.push({
                id: null,
                seed_key: `seed:${tid}:${added}`,
                q: q.slice(0, 220),
                has_correction: false,
                reference: "",
                note: "семя из официальной карты тем",
                needs_work: true,
                mode: "seed",
                seed: true,
                ...meta
            });
            added += 1;
        }
    }

    queue.sort((a, b) => {
        const aw = a.needs_work ? 0 : 1;
        const bw = b.needs_work ? 0 : 1;
        if (aw !== bw) return aw - bw;
        if (a.theme_rank !== b.theme_rank) return a.theme_rank - b.theme_rank;
        // семена после «живых» эталонов той же темы
        if (!!a.seed !== !!b.seed) return a.seed ? 1 : -1;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    return queue;
}

export function getTrainStatus() {
    const gold = loadGold();
    const themesDoc = loadThemes();
    const queue = buildQueue(gold, themesDoc);
    const need = queue.filter((x) => x.needs_work);
    const byTheme = {};
    for (const row of need) {
        const id = row.theme_id || "other";
        if (!byTheme[id]) {
            byTheme[id] = {
                id,
                name: row.theme_name,
                gap: row.theme_gap,
                need: 0,
                seeds: 0
            };
        }
        byTheme[id].need += 1;
        if (row.seed) byTheme[id].seeds += 1;
    }
    return {
        ok: true,
        total: queue.length,
        need_work: need.length,
        corrected: queue.filter((x) => x.has_correction).length,
        priority_order: themesDoc.priority_order || [],
        themes: (themesDoc.themes || []).map((t) => ({
            id: t.id,
            name: t.name,
            group: t.group,
            group_name: t.group_name,
            gap: t.gap,
            share_in_group: t.share_in_group,
            faq: t.faq,
            need: byTheme[t.id]?.need || 0
        })),
        queue
    };
}

export function getTrainItem(id) {
    const gold = loadGold();
    const it = (gold.items || []).find((x) => Number(x.id) === Number(id));
    if (!it) return { ok: false, error: `нет вопроса #${id}` };
    const preview = previewForQuestion(it.q);
    const themesDoc = loadThemes();
    const cls = classifyTheme(it.q, themesDoc);
    const meta = themeMeta(themesDoc, cls.theme_id);
    return {
        ok: true,
        item: {
            id: it.id,
            q: it.q,
            has_correction: !!it.has_correction,
            reference: it.reference || "",
            note: it.note || "",
            must: it.must || [],
            must_any: it.must_any || [],
            ...meta,
            theme_name: cls.theme_name
        },
        preview
    };
}

export function previewTrainQuestion(question) {
    const q = String(question || "").trim();
    if (!q) return { ok: false, error: "question обязателен" };
    const themesDoc = loadThemes();
    const cls = classifyTheme(q, themesDoc);
    const meta = themeMeta(themesDoc, cls.theme_id);
    return {
        ok: true,
        q,
        theme: { ...meta, theme_name: cls.theme_name },
        preview: previewForQuestion(q)
    };
}

/**
 * @param {{ id?: number, question?: string, answer: string, note?: string }} body
 */
export function saveTrainCorrection(body) {
    const answer = String(body.answer || "").trim();
    if (!answer) return { ok: false, error: "answer обязателен" };

    const gold = loadGold();
    const items = gold.items || [];
    let it = null;
    let question = String(body.question || "").trim();

    if (body.id != null && body.id !== "") {
        it = items.find((x) => Number(x.id) === Number(body.id));
        if (!it) return { ok: false, error: `нет вопроса #${body.id}` };
        question = it.q;
    }
    if (!question) return { ok: false, error: "question обязателен" };

    const cls = classifyTheme(question, loadThemes());
    const note =
        String(body.note || "").trim() ||
        `корректировка из тренажёра · тема ${cls.theme_id}`;
    const { must, must_any } = markersFromAnswer(answer, question);

    if (it) {
        it.has_correction = true;
        it.reference = answer;
        it.must = must;
        it.must_any = must_any;
        it.note = note;
        it.theme_id = cls.theme_id;
    } else {
        const nextId = items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
        it = {
            id: nextId,
            q: question,
            has_correction: true,
            reference: answer,
            must,
            must_any,
            note,
            theme_id: cls.theme_id
        };
        items.push(it);
        gold.items = items;
    }

    const faqLines = loadFaqLines();
    const topicKey = normKey(question);
    let faqId = null;
    const updatedLines = [];
    let replaced = false;
    for (const line of faqLines) {
        try {
            const row = JSON.parse(line);
            const rowKey = normKey(row.topic);
            if (!replaced && rowKey === topicKey) {
                faqId = row.id || nextFaqId(faqLines);
                updatedLines.push(
                    JSON.stringify({
                        ...row,
                        id: faqId,
                        collection: "faq",
                        source: "Тренажёр",
                        topic: question,
                        text: `${question}\n${answer}`,
                        theme_id: cls.theme_id
                    })
                );
                replaced = true;
                continue;
            }
        } catch {
            /* keep */
        }
        updatedLines.push(line);
    }
    if (!replaced) {
        faqId = nextFaqId(faqLines);
        updatedLines.push(
            JSON.stringify({
                id: faqId,
                collection: "faq",
                source: "Тренажёр",
                topic: question,
                text: `${question}\n${answer}`,
                theme_id: cls.theme_id
            })
        );
    }
    fs.writeFileSync(FAQ_PATH, updatedLines.join("\n") + "\n", "utf8");
    saveGold(gold);
    reloadConclusionQaIndex();

    const check = previewForQuestion(question);
    return {
        ok: true,
        item_id: it.id,
        faq_id: faqId,
        theme_id: cls.theme_id,
        must,
        preview: check
    };
}

function _selfcheck() {
    const m = markersFromAnswer(
        "Обращение в АС Друг, приоритет согласуйте с руководителем",
        "Как приоритет?"
    );
    if (!m.must.includes("приоритет") && !m.must.some((x) => x.startsWith("приор"))) {
        throw new Error("markersFromAnswer weak");
    }
    const cls = classifyTheme("Где выписка ЕГРН в ЭКД?");
    if (cls.theme_id !== "ekd") throw new Error(`theme ekd got ${cls.theme_id}`);
    const st = getTrainStatus();
    if (!st.ok || !st.queue.length) throw new Error("train status empty");
    if (!(st.priority_order || []).length) throw new Error("no priority_order");
    const firstNeed = st.queue.find((x) => x.needs_work);
    if (!firstNeed?.theme_id) throw new Error("queue item without theme");
    console.log(
        "conclusion-qa-train self-check ok",
        `need=${st.need_work}`,
        `first=${firstNeed.theme_id}`,
        `src=${(loadThemes().source || "").slice(0, 40)}`
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    _selfcheck();
}
