/**
 * Поиск по базе ГЛ (TF-IDF) из data/gl_rag/chunks.jsonl.
 *
 * ponytail: индекс в памяти; топ-1 по скору (тема важнее длинного текста).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_GL_RAG_CHUNKS = path.join(__dirname, "..", "data", "gl_rag", "chunks.jsonl");
const GLOSSARY_PATH = path.join(__dirname, "..", "data", "gl_rag", "glossary.json");
const FAQ_SEEDS_PATH = path.join(__dirname, "..", "data", "gl_rag", "faq-seeds.jsonl");
/** Локальная папка из «Test Cursor/База Rag», если есть — берём её. */
const EXTERNAL_GL_RAG_CHUNKS = path.join(
    process.env.HOME || "",
    "Documents",
    "Test Cursor",
    "База Rag",
    "chunks.jsonl"
);

function resolveGlRagChunksPath() {
    if (process.env.GL_RAG_CHUNKS) return process.env.GL_RAG_CHUNKS;
    if (fs.existsSync(EXTERNAL_GL_RAG_CHUNKS)) return EXTERNAL_GL_RAG_CHUNKS;
    return BUNDLED_GL_RAG_CHUNKS;
}

export function getGlRagChunksPath() {
    return resolveGlRagChunksPath();
}

/** @deprecated снимок пути на момент импорта; для актуального — getGlRagChunksPath() */
export const GL_RAG_CHUNKS_PATH = resolveGlRagChunksPath();
/** @deprecated путь старого FTS; оставлен для совместимости info/ошибок */
export const CONCLUSION_QA_DB_PATH = GL_RAG_CHUNKS_PATH;

/** @type {{ docs: object[], vocab: Map<string, number>, idf: Float32Array, rows: Map<number, number>[], norms: Float32Array, topicToks: Set<string>[], path: string } | null} */
let index = null;

const WORD = /[а-яёa-z0-9]{3,}/gi;
const STOP = new Set([
    "как", "что", "где", "когда", "какой", "какая", "какие", "каков",
    "можно", "нужно", "надо", "ли", "для", "или", "про", "при", "это",
    "эта", "этот", "эти", "есть", "будет", "было", "после", "перед",
    "пожалуйста", "добрый", "день", "подскаж", "скаж", "хочу", "мне",
    "нам", "вас", "ваш", "наш", "все", "ещё", "еще", "тольк", "также"
]);
const KEYWORDS = [
    "егрн", "вти", "бланк", "сбоф", "аспект", "самоосмотр", "приоритет",
    "экд", "мониторинг", "перепланиров", "кадастров", "ликвидацион",
    "автооценк", "гибдд", "сзз", "мдо", "кпки", "рна", "мчс", "сро",
    "внд", "ммб", "ксб", "контакт", "смс", "жилье", "стоим", "пересмотр",
    "арбитраж", "осмотр", "заявк", "отзыв", "заключен", "срок",
    "комфорт", "бланк", "категор", "дисконт", "отлагательн"
];

export function tokenize(text) {
    const words = String(text || "").toLowerCase().replace(/ё/g, "е").match(WORD) || [];
    return words.map((w) => (w.length > 6 ? w.slice(0, 6) : w));
}

function queryToks(text) {
    return tokenize(text).filter((t) => !STOP.has(t));
}

/**
 * В ответах UI не светим реальные идентификаторы и даты сделок.
 * ASZ/SD: буквы оставляем, цифры → точки. Сделки XXX-YYY → DEAL.... Даты → ДД.ММ.ГГГГ.
 */
/** @type {{ expand: object[], keep_as_is: object[], special: object[] } | null} */
let glossaryCache = null;

export function loadGlossary() {
    if (glossaryCache) return glossaryCache;
    try {
        glossaryCache = JSON.parse(fs.readFileSync(GLOSSARY_PATH, "utf8"));
    } catch {
        glossaryCache = { expand: [], keep_as_is: [], special: [] };
    }
    return glossaryCache;
}

/**
 * Блок для system-промпта ask: что можно пояснять, что оставлять как есть.
 * ponytail: компактный текст; потолок ~4k символов — хватает на текущий Excel.
 */
export function buildGlossaryPromptBlock() {
    const g = loadGlossary();
    const expand = (g.expand || [])
        .map((x) => {
            const note = x.note ? ` (${x.note})` : "";
            return `${x.abbr} — ${x.meaning}${note}`;
        })
        .join("; ");
    const keep = (g.keep_as_is || []).map((x) => x.abbr).join(", ");
    const special = (g.special || [])
        .map((x) => `${x.abbr}: ${x.text}`)
        .join("; ");
    const parts = [
        "Глоссарий внутренних терминов ЗС (понимай по смыслу; в ответе не устраивай словарик без запроса):",
        expand ? `Расшифровки: ${expand}.` : "",
        keep
            ? `Не расшифровывай в ответе (оставляй как принято в тексте): ${keep}.`
            : "",
        special ? `Особые пометки: ${special}.` : ""
    ];
    return parts.filter(Boolean).join("\n");
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Для поиска: узкое расширение — только короткие/особые abbr, чтобы не размывать TF-IDF.
 * ponytail: полный expand-список как query+meaning даёт шум (КК→«категория качества»).
 */
export function expandQueryForSearch(question) {
    const q = String(question || "").trim();
    if (!q) return q;
    const g = loadGlossary();
    const extras = [];

    const allow = new Set(
        [
            "СЗЗ", "ССЗ", "ЗЗ", "БСЗ", "ЭКД", "ВТИ", "ЗНО", "ЗНМ", "ЗМ", "ПМЗ",
            "ПДКП", "ДКП", "ДДУ", "ГПЗУ", "ВРИ", "ОНС", "ОКС", "ЕНК", "ПСН",
            "РНА", "РнА", "МиО", "ЦООП", "АСЗ", "КПКИ", "НЗО", "ОУ", "СО", "ПМ"
        ].map((a) => a.toLowerCase())
    );

    for (const x of g.expand || []) {
        const abbr = String(x.abbr || "").trim();
        if (!abbr || !allow.has(abbr.toLowerCase())) continue;
        const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(abbr)}(?=[^\\p{L}\\p{N}]|$)`, "iu");
        if (!re.test(q)) continue;
        // короткие доп.токены, не длинная фраза — иначе TF-IDF уезжает в «залоговое заключение» без СЗЗ
        const meaning = String(x.meaning || "");
        const short = meaning
            .split(/[\s,;:()]+/)
            .map((w) => w.toLowerCase().replace(/ё/g, "е"))
            .filter((w) => w.length >= 4)
            .slice(0, 3)
            .join(" ");
        extras.push(abbr, short || meaning.slice(0, 40));
    }

    for (const s of g.special || []) {
        const abbr = String(s.abbr || "").trim();
        if (!abbr) continue;
        const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(abbr)}(?=[^\\p{L}\\p{N}]|$)`, "iu");
        if (!re.test(q)) continue;
        if (s.kind === "typo" && /сзз/i.test(s.text || "")) {
            extras.push("СЗЗ", "сводное залоговое заключение");
        } else if (/условно/i.test(s.text || "")) {
            extras.push("условно готовое состояние");
        }
    }

    if (/(?:^|[^\p{L}\p{N}])угс(?=[^\p{L}\p{N}]|$)/iu.test(q) && !extras.some((e) => /условно/i.test(e))) {
        extras.push("условно готовое состояние");
    }

    // Фаза 2: усиление намерения (полярность / типовые формулировки ГЛ)
    for (const rule of INTENT_RULES) {
        if (rule.re.test(q)) extras.push(rule.add);
    }

    if (!extras.length) return q;
    return `${q} ${extras.join(" ")}`.slice(0, 500);
}

/** Правила «что имел в виду» — без нейросети; дополняют TF-IDF. */
const INTENT_RULES = [
    {
        re: /не\s+согласен.{0,50}стоим|оспорить\s+стоим|пересмотр\w*\s+стоим|не\s+согласен.{0,30}оценк/i,
        add: "клиент не согласен с оценкой прошу пересмотреть стоимости арбитраж"
    },
    {
        re: /приоритет.{0,30}не\s+выстав|не\s+выставля\w*.{0,20}приоритет|отказ.{0,20}приоритет/i,
        add: "количество приоритетов для ТБ ограничено ветка приоритета"
    },
    {
        re: /что\s+такое\s+бессрочн|бессрочн\w*\s+(?:сзз|ссз)|бессрочное\s+залогов/i,
        add: "бессрочное сзз срок действия мониторинг"
    },
    {
        re: /мониторинг.{0,40}актуализац|актуализац\w*.{0,40}мониторинг/i,
        add: "актуализация КН задание на мониторинг не нужно"
    }
];

const CHAR_N = 3;

function charGrams(text) {
    const s = String(text || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^а-яa-z0-9]+/g, "");
    if (s.length < CHAR_N) return [];
    const out = [];
    for (let i = 0; i + CHAR_N <= s.length; i++) out.push(s.slice(i, i + CHAR_N));
    return out;
}

export function maskConclusionRefs(text) {
    let s = String(text ?? "");

    // ASZ / SD + цифры
    s = s.replace(
        /\b((?:ASZ|SD)[\s\-_/]*)(\d[\d\s\-_/]*)/gi,
        (_, prefix, digits) => prefix + digits.replace(/\d/g, ".")
    );

    // коды сделок вида QEL-VUD, R1G-J44
    s = s.replace(/\b[A-Z0-9]{2,4}-[A-Z0-9]{2,4}\b/g, "DEAL....");

    // телефоны
    s = s.replace(
        /(?:\+?7|8)[\s\-()]*(?:\d[\s\-()]*){10}|\b\d{3}[\s\-]\d{3}[\s\-]\d{2}[\s\-]\d{2}\b/g,
        "TEL...."
    );

    // даты: 11.11.2025, 11.11.25, 11/11/2025, 2025-11-11, 11-11-2025
    s = s.replace(
        /\b(?:\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g,
        "ДД.ММ.ГГГГ"
    );

    // «от 11 ноября 2025», «до 26 мая 2026»
    s = s.replace(
        /\b(?:от|до|на|с)\s+\d{1,2}\s+(?:январ[яь]|феврал[яь]|март[ае]?|апрел[яь]|ма[йя]|июн[яь]|июл[яь]|август[ае]?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])(?:\s+\d{4})?\b/gi,
        (m) => m.replace(/\d+/g, "…")
    );

    return s;
}

function splitQa(doc) {
    const nl = String(doc.text || "").indexOf("\n");
    let answer = nl >= 0 ? doc.text.slice(nl + 1) : doc.text;
    let question = doc.topic || "";
    // ponytail: в Excel иногда &quot; вместо кавычек
    question = question.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    answer = answer.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const sheet =
        doc.collection === "faq"
            ? "FAQ"
            : doc.collection === "template"
              ? (doc.source || "Шаблоны")
              : "ГЛ";
    return { question, answer: answer || "", sheet };
}

function normDedupKey(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

const STOCK_ANSWER_PREFIXES = [
    "приоритет по заявке выставлен",
    "приоритет по заявку выставлен",
    "приоритет по осмотру выставлен",
    "приоритет по заявке установлен",
    "приоритет обозначен"
];

function questionDedupKey(topic) {
    const t = normDedupKey(topic);
    for (const pref of STOCK_ANSWER_PREFIXES) {
        if (t === pref || t.startsWith(pref)) return pref;
    }
    return t;
}

function answerDedupKey(answer) {
    let t = normDedupKey(answer).replace(/^добрый день[!.]?\s*/, "");
    for (const pref of STOCK_ANSWER_PREFIXES) {
        const idx = t.indexOf(pref);
        if (idx >= 0 && idx <= 100) return pref;
    }
    const firstLine = (t.split("\n")[0] || "").trim();
    let first = firstLine.split(/[.!?]+/)[0].trim();
    if (first.length < 24) first = firstLine.slice(0, 220) || t.slice(0, 220);
    return first.slice(0, 220);
}

/**
 * Один чанк на уникальный вопрос и на уникальный ответ (мягкий ключ по первой фразе).
 * ponytail: при загрузке — даже если Excel/внешний jsonl ещё со старыми дублями.
 */
export function dedupeConclusionDocs(docs) {
    const ranked = [...docs].sort((a, b) => {
        const rank = (d) => (d.collection === "faq" ? 0 : d.collection === "template" ? 1 : 2);
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        const aAns = splitQa(a).answer.length;
        const bAns = splitQa(b).answer.length;
        if (bAns !== aAns) return bAns - aAns;
        return String(b.topic || "").length - String(a.topic || "").length;
    });
    const seenQ = new Set();
    const seenA = new Set();
    const kept = [];
    for (const d of ranked) {
        const { question, answer } = splitQa(d);
        const qk = questionDedupKey(question || d.topic);
        const ak = answerDedupKey(answer);
        if (qk.length < 8 || ak.length < 16) continue;
        if (seenQ.has(qk) || seenA.has(ak)) continue;
        seenQ.add(qk);
        seenA.add(ak);
        kept.push(d);
    }
    return kept;
}

function loadFaqSeeds() {
    try {
        if (!fs.existsSync(FAQ_SEEDS_PATH)) return [];
        return fs
            .readFileSync(FAQ_SEEDS_PATH, "utf8")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => JSON.parse(l));
    } catch {
        return [];
    }
}

function loadConclusionDocs(chunksPath) {
    const raw = fs.readFileSync(chunksPath, "utf8");
    const cases = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    // FAQ-семена первыми: инструкции важнее сырых тикетов
    return dedupeConclusionDocs([...loadFaqSeeds(), ...cases]);
}

function buildIndex(docs) {
    const tokenized = docs.map((d) => tokenize(d.text));
    const topicToks = docs.map((d) => new Set(tokenize(d.topic || "")));
    const df = new Map();
    for (const toks of tokenized) {
        for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    }
    const vocabKeys = [...df.keys()].sort();
    const vocab = new Map(vocabKeys.map((t, i) => [t, i]));
    const nDocs = docs.length;
    const idf = new Float32Array(vocab.size);
    for (const [t, i] of vocab) {
        idf[i] = Math.log((1 + nDocs) / (1 + df.get(t))) + 1;
    }

    /** @type {Map<number, number>[]} */
    const rows = new Array(nDocs);
    const norms = new Float32Array(nDocs);
    for (let di = 0; di < nDocs; di++) {
        const tf = new Map();
        for (const t of tokenized[di]) tf.set(t, (tf.get(t) || 0) + 1);
        const row = new Map();
        let sumSq = 0;
        for (const [t, c] of tf) {
            const j = vocab.get(t);
            if (j == null) continue;
            const w = c * idf[j];
            row.set(j, w);
            sumSq += w * w;
        }
        rows[di] = row;
        norms[di] = Math.max(Math.sqrt(sumSq), 1e-8);
    }

    // ponytail: 2-й канал — char 3-gram по теме (морфология без нейросети)
    const charToks = docs.map((d) => charGrams(d.topic || ""));
    const charDf = new Map();
    for (const grams of charToks) {
        for (const g of new Set(grams)) charDf.set(g, (charDf.get(g) || 0) + 1);
    }
    const charVocab = new Map([...charDf.keys()].sort().map((t, i) => [t, i]));
    const charIdf = new Float32Array(charVocab.size);
    for (const [t, i] of charVocab) {
        charIdf[i] = Math.log((1 + nDocs) / (1 + charDf.get(t))) + 1;
    }
    /** @type {Map<number, number>[]} */
    const charRows = new Array(nDocs);
    const charNorms = new Float32Array(nDocs);
    for (let di = 0; di < nDocs; di++) {
        const tf = new Map();
        for (const g of charToks[di]) tf.set(g, (tf.get(g) || 0) + 1);
        const row = new Map();
        let sumSq = 0;
        for (const [t, c] of tf) {
            const j = charVocab.get(t);
            if (j == null) continue;
            const w = Math.min(c, 4) * charIdf[j];
            row.set(j, w);
            sumSq += w * w;
        }
        charRows[di] = row;
        charNorms[di] = Math.max(Math.sqrt(sumSq), 1e-8);
    }

    return {
        docs, vocab, idf, rows, norms, topicToks,
        charVocab, charIdf, charRows, charNorms,
        path: ""
    };
}

function vectorize(query, vocab, idf) {
    const tf = new Map();
    for (const t of tokenize(query)) tf.set(t, (tf.get(t) || 0) + 1);
    const cols = [];
    const data = [];
    let sumSq = 0;
    for (const [t, c] of tf) {
        const j = vocab.get(t);
        if (j == null) continue;
        const w = c * idf[j];
        cols.push(j);
        data.push(w);
        sumSq += w * w;
    }
    return { cols, data, norm: Math.sqrt(sumSq) || 1e-8 };
}

function vectorizeChars(query, charVocab, charIdf) {
    const tf = new Map();
    for (const g of charGrams(query)) tf.set(g, (tf.get(g) || 0) + 1);
    const cols = [];
    const data = [];
    let sumSq = 0;
    for (const [t, c] of tf) {
        const j = charVocab.get(t);
        if (j == null) continue;
        const w = Math.min(c, 4) * charIdf[j];
        cols.push(j);
        data.push(w);
        sumSq += w * w;
    }
    return { cols, data, norm: Math.sqrt(sumSq) || 1e-8 };
}

function topicOverlap(qToks, topicSet) {
    if (!qToks.length || !topicSet.size) return 0;
    let hit = 0;
    for (const t of qToks) {
        if (topicSet.has(t)) hit += 1;
    }
    return hit / qToks.length;
}

/** Статусные/маршрутные отписки ГЛ — не playbook-ответ. */
export function isRoutingNoise(text) {
    const t = String(text || "").toLowerCase().replace(/ё/g, "е");
    if (!t.trim()) return true;
    if (/предусмотрена только для обращений|обратитесь к исполнителю|выпущено сотрудниками мцк/.test(t)) {
        return true;
    }
    if (/гл залоговая экспертиза mdo|mdo предусмотрен/.test(t)) return true;
    if (/^(добрый день[!.]?\s*)?(приоритет по заявке выставлен|выписки егрн размещен|материалы осмотра размещен)/.test(t)) {
        return true;
    }
    // слишком короткий «статус» без действия
    if (t.length < 60 && /выставлен|размещен|направлено|принято в работу/.test(t)) return true;
    return false;
}

function retrieve(query, idx, k = 5) {
    const {
        docs, vocab, idf, rows, norms, topicToks,
        charVocab, charIdf, charRows, charNorms
    } = idx;
    const qToks = queryToks(query);
    const qv = vectorize(qToks.join(" "), vocab, idf);
    const cq = vectorizeChars(query, charVocab, charIdf);
    const ql = query.toLowerCase().replace(/ё/g, "е");
    const qKeys = KEYWORDS.filter((kw) => ql.includes(kw));

    // без значимых токенов — пусто (оффтоп вроде «какая погода»)
    if (!qToks.length && !qKeys.length && cq.cols.length < 4) return [];

    const scored = new Array(docs.length);
    for (let i = 0; i < docs.length; i++) {
        let dot = 0;
        const row = rows[i];
        for (let t = 0; t < qv.cols.length; t++) {
            const w = row.get(qv.cols[t]);
            if (w != null) dot += w * qv.data[t];
        }
        const wordCos = dot / (norms[i] * qv.norm);

        let cdot = 0;
        const crow = charRows[i];
        for (let t = 0; t < cq.cols.length; t++) {
            const w = crow.get(cq.cols[t]);
            if (w != null) cdot += w * cq.data[t];
        }
        const charCos = cdot / (charNorms[i] * cq.norm);

        // hybrid: слова + символьные n-граммы
        let score = 0.22 * wordCos + 0.12 * charCos;

        const topic = String(docs[i].topic || "").toLowerCase().replace(/ё/g, "е");
        const overlap = topicOverlap(qToks, topicToks[i]);
        score += 0.75 * overlap;
        // все значимые слова запроса в короткой теме — сильный сигнал playbook
        if (qToks.length >= 2 && overlap >= 0.99) score += 0.45;
        else if (qToks.length >= 2 && overlap >= 0.66) score += 0.2;
        if (docs[i].collection === "template" && overlap >= 0.5) score += 0.15;
        // FAQ: буст только при пересечении темы — иначе любой FAQ вылезает поверх тикетов
        if (docs[i].collection === "faq") score += overlap >= 0.35 ? 0.4 + 1.4 * overlap : -0.2;
        if (topic.length > 0 && topic.length < 80 && overlap > 0) score += 0.1;

        const topicHead = topic.slice(0, 110);
        const keysInTopic = qKeys.filter((key) => topicHead.includes(key)).length;
        if (keysInTopic >= 2) score += 0.45;
        else if (keysInTopic === 1) score += 0.12;
        // если в запросе 2+ доменных ключа, а в теме меньше двух — это почти наверняка мимо
        if (qKeys.length >= 2 && keysInTopic < 2) score -= 0.6;
        // длинные темы тикетов проигрывают коротким шаблонам
        if (topic.length > 120) score -= 0.35;
        if (topic.length > 200) score -= 0.25;

        let kw = 0;
        for (const key of qKeys) {
            if (topic.includes(key)) continue;
            if (String(docs[i].text || "").toLowerCase().includes(key)) kw += 0.04;
        }
        score += Math.min(kw, 0.12);

        // how-to вопрос: штрафуем статусные отписки («уже выставлен / размещено»)
        const isHowTo = /^(как|где|что|почему|зачем|можно|нужен|нужно|когда)\b/i.test(ql.trim())
            || /\b(как|где)\s+\S+/i.test(ql);
        const body = String(docs[i].text || "").toLowerCase().replace(/ё/g, "е");
        if (isHowTo && docs[i].collection === "case") {
            if (/^(добрый день[!.]?\s*)?(приоритет по заявке выставлен|выписки егрн размещен|материалы осмотра размещен)/i.test(
                body.replace(/^\s*/, "")
            ) || /^(приоритет по заявке выставлен|выписки егрн размещен|материалы осмотра размещен)/i.test(topic)) {
                score -= 0.9;
            }
        }
        if (docs[i].collection === "case" && isRoutingNoise(body)) score -= 1.4;

        // intent: искать формулировку в теле ответа (тема тикета часто «не про то»)
        if (/приоритет.{0,30}не\s+выстав|не\s+выставля\w*.{0,20}приоритет/i.test(query)) {
            if (body.includes("количество приоритетов") && body.includes("ограничен")) score += 0.85;
            if (/^приоритет по заявке выставлен/.test(topic) && topic.length < 45) score -= 0.55;
        }
        if (/не\s+согласен.{0,50}стоим|не\s+согласен.{0,30}оценк/i.test(query)) {
            if (
                body.includes("не согласен с оценк")
                || topic.includes("не согласен с оценк")
                || topic.includes("не согласен со стоимост")
            ) score += 0.45;
            if (body.includes("арбитраж") && /аргументир/.test(body)) score += 0.35;
            if (docs[i].collection === "faq" && topic.includes("не согласен")) score += 0.4;
        }
        if (/мониторинг.{0,40}актуализац|актуализац\w*.{0,40}мониторинг/i.test(query)) {
            if (topic.includes("актуализация кн") && /мониторинг не нужн/.test(body + " " + topic)) score += 0.4;
        }
        if (/как\s+установ\w*\s+приоритет|установить приоритет/i.test(query)) {
            if (body.includes("ас друг") || body.includes("обращение")) score += 0.7;
            if (/приоритет по заявке выставлен/.test(topic)) score -= 0.8;
        }
        if (/приоритет.{0,20}не\s+выстав|не\s+выставля\w*.{0,20}приоритет/i.test(query)) {
            if (topic.includes("не выставля") || body.includes("ветка приоритета")) score += 0.55;
        }

        scored[i] = { i, score };
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ i, score }) => ({ doc: docs[i], score }));
}

export function isConclusionQaReady() {
    return fs.existsSync(resolveGlRagChunksPath());
}

/** Сброс индекса после правки faq-seeds (тренажёр). */
export function reloadConclusionQaIndex() {
    index = null;
    return { ok: true };
}

/**
 * @param {string} question
 * @param {{ limit?: number, minScore?: number }} [opts]
 */
export function searchConclusionQa(question, opts = {}) {
    const q = String(question || "").trim();
    if (!q) {
        return { ok: false, count: 0, hits: [], offTopic: false, error: "question обязателен" };
    }
    const chunksPath = resolveGlRagChunksPath();
    if (!fs.existsSync(chunksPath)) {
        return {
            ok: false,
            count: 0,
            hits: [],
            offTopic: false,
            error: "База RAG не найдена (Test Cursor/База Rag или data/gl_rag). Запустите: npm run conclusion-qa:build"
        };
    }

    // ponytail: sync API для proxy; индекс прогреваем лениво
    if (!index || index.path !== chunksPath) {
        try {
            const docs = loadConclusionDocs(chunksPath);
            index = { ...buildIndex(docs), path: chunksPath };
        } catch (e) {
            return { ok: false, count: 0, hits: [], offTopic: false, error: e.message || String(e) };
        }
    }

    const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 20);
    const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.32;
    const qSearch = expandQueryForSearch(q);
    // тянем шире, чтобы FAQ не выпал из топа за шумом тикетов
    const pool = retrieve(qSearch, index, Math.max(limit * 4, 20))
        .filter(({ score }) => score >= Math.min(minScore, 0.25));
    const mapped = pool.map(({ doc, score }) => {
        const { question: qq, answer, sheet } = splitQa(doc);
        return {
            id: doc.id,
            sheet,
            collection:
                doc.collection === "faq"
                    ? "faq"
                    : doc.collection === "template"
                      ? "template"
                      : "case",
            question: maskConclusionRefs(qq),
            answer: maskConclusionRefs(answer),
            refId: null,
            score: Number(score)
        };
    });
    const ranked = preferTemplateHit(mapped).slice(0, limit);

    // отказ, если в топе нет пересечения значимых токенов / доменных ключей
    if (ranked.length) {
        const qToks = queryToks(qSearch);
        const ql = qSearch.toLowerCase().replace(/ё/g, "е");
        const qKeys = KEYWORDS.filter((kw) => ql.includes(kw));
        const top = ranked[0];
        const topic = String(top.question || "").toLowerCase().replace(/ё/g, "е");
        const hay = new Set(tokenize(top.question || ""));
        let overlap = 0;
        for (const t of qToks) {
            if (hay.has(t)) overlap += 1;
        }
        const keyHit = qKeys.some(
            (kw) => topic.includes(kw) || String(top.answer || "").toLowerCase().includes(kw)
        );
        if (overlap === 0 && !keyHit && top.collection !== "faq" && top.collection !== "template") {
            return { ok: true, count: 0, hits: [], offTopic: true };
        }
    }

    return {
        ok: true,
        count: ranked.length,
        offTopic: ranked.length === 0,
        hits: ranked
    };
}

/**
 * Если рядом с топом есть FAQ/шаблон — предпочесть его.
 * FAQ важнее сырого тикета даже при заметно меньшем score.
 */
export function preferTemplateHit(hits) {
    if (!hits?.length) return hits || [];
    const usable = hits.filter((h) => !isRoutingNoise(h.answer));
    const pool = usable.length ? usable : hits;

    const faqs = pool
        .filter((h) => h.collection === "faq" && (Number(h.score) || 0) >= 0.7)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    if (faqs.length) {
        const best = faqs[0];
        return [best, ...pool.filter((h) => h !== best)];
    }

    const top = pool[0];
    const topScore = Number(top.score) || 0;
    const preferred = pool.find(
        (h) =>
            (h.collection === "template" || (h.sheet && h.sheet !== "ГЛ"))
            && (Number(h.score) || 0) >= topScore - 0.2
            && (Number(h.score) || 0) >= 0.9
    );
    if (!preferred || preferred === top) return pool;
    return [preferred, ...pool.filter((h) => h !== preferred)];
}

const GENERIC_TOPIC_KEYS = new Set(["заявк", "заключен"]);

/** В вопросе есть предметный ключ, и он есть в карточке. «Что делать с заявкой» — нет. */
function isSpecificPlaybook(question, hit) {
    const ql = String(question || "").toLowerCase().replace(/ё/g, "е");
    const keys = KEYWORDS.filter((kw) => ql.includes(kw) && !GENERIC_TOPIC_KEYS.has(kw));
    if (!keys.length) return false;
    const hay = `${hit?.question || ""}\n${hit?.answer || ""}`.toLowerCase().replace(/ё/g, "е");
    return keys.some((kw) => hay.includes(kw));
}
export function playbookHits(hits) {
    return (hits || []).filter(
        (h) =>
            (h.collection === "faq" || h.collection === "template")
            && String(h.answer || "").trim()
            && !isRoutingNoise(h.answer)
    );
}

/**
 * verbatim — короткий FAQ как есть.
 * voice — шаблон/смесь: произнести языком оператора, без цитаты ВНД.
 * clarify — в топе только тикеты или слабое совпадение: один уточняющий вопрос, процедуру не выдумывать.
 * @param {object[]} hits
 * @param {{ followUp?: boolean, question?: string }} [opts]
 */
export function chooseAskMode(hits, opts = {}) {
    const list = preferTemplateHit(hits);
    const books = playbookHits(list);
    const top = books[0];
    if (!top?.answer?.trim()) {
        return { mode: books.length ? "empty" : "clarify", reason: "case-only", hits: [], hit: null };
    }
    const score = Number(top.score) || 0;
    if (opts.followUp) {
        if (score < 0.45) return { mode: "clarify", reason: "weak-followup", hits: books, hit: top };
        return { mode: "voice", reason: "followup", hits: books, hit: top };
    }
    if (top.collection === "faq" && score >= 0.7) {
        if (!opts.question || isSpecificPlaybook(opts.question, top)) {
            return { mode: "verbatim", reason: "faq", hits: books, hit: top };
        }
        return { mode: "clarify", reason: "vague", hits: [], hit: null };
    }
    if (score < 0.45) {
        return { mode: "clarify", reason: "weak-hit", hits: books, hit: top };
    }
    return { mode: "voice", reason: top.collection === "template" ? "template" : "blend", hits: books, hit: top };
}

/** Короткие / ссылочные реплики диалога («а для ММБ?», «а если КСБ»). */
export function isLikelyFollowUp(question) {
    const q = String(question || "").trim();
    if (!q) return false;
    if (q.length <= 48) return true;
    return /^(а|и|ну|тогда|ещё|еще|тоже|а\s+если|а\s+для|а\s+по|а\s+в|а\s+на|что\s+насчёт|а\s+как)\b/i.test(q)
        || /\?\s*$/.test(q) && q.split(/\s+/).length <= 8;
}

/**
 * История для ask: последние 8 реплик user/assistant, суммарно ~4к символов.
 * @param {unknown} history
 * @returns {{ role: "user"|"assistant", content: string }[]}
 */
export function normalizeAskHistory(history) {
    if (!Array.isArray(history)) return [];
    const out = [];
    for (const row of history) {
        if (!row || typeof row !== "object") continue;
        const role = row.role === "assistant" || row.role === "user" ? row.role : null;
        const content = String(row.content || "").trim();
        if (!role || !content) continue;
        out.push({ role, content: content.slice(0, 1500) });
    }
    let sliced = out.slice(-8);
    let total = sliced.reduce((n, m) => n + m.content.length, 0);
    while (sliced.length > 1 && total > 4000) {
        sliced = sliced.slice(1);
        total = sliced.reduce((n, m) => n + m.content.length, 0);
    }
    return sliced;
}

/** Поисковый запрос: текущий вопрос + хвост предыдущих user (для follow-up). */
export function buildDialogSearchQuery(question, history = []) {
    const q = String(question || "").trim();
    const hist = normalizeAskHistory(history);
    const prevUsers = hist.filter((m) => m.role === "user").map((m) => m.content);
    if (!prevUsers.length || !isLikelyFollowUp(q)) return q.slice(0, 500);
    const tail = prevUsers.slice(-2).join(" ");
    return `${q} ${tail}`.slice(0, 500);
}

/** Укоротить многоходовку тикета до первого ответа ГЛ. */
export function formatVerbatimAnswer(text) {
    let s = maskConclusionRefs(String(text || "").trim());
    s = s.replace(/^\s*добрый\s+день[!.]?\s*/i, "").trim();
    if (s.length > 900) {
        const parts = s.split(/\n(?=Добрый\s+день)/i);
        if (parts.length > 1 && parts[0].trim().length >= 40) {
            s = parts[0].trim();
        }
    }
    return s.slice(0, 2500);
}

/** Ответ оператора: без markdown и без простыни ВНД. */
export function speakPlaybook(text, max = 900) {
    let s = formatVerbatimAnswer(text)
        .replace(/\*\*/g, "")
        .replace(/^#+\s*/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
    return (dot > 180 ? cut.slice(0, dot + 1) : cut).trim();
}

export function getConclusionQaInfo() {
    const chunksPath = resolveGlRagChunksPath();
    const ready = fs.existsSync(chunksPath);
    if (!ready) {
        return { ready: false, path: chunksPath, source: "missing", total: 0 };
    }
    const source = chunksPath === EXTERNAL_GL_RAG_CHUNKS
        ? "Test Cursor/База Rag"
        : (chunksPath === BUNDLED_GL_RAG_CHUNKS ? "data/gl_rag" : "env");
    if (!index || index.path !== chunksPath) {
        try {
            const buf = fs.readFileSync(chunksPath, "utf8");
            const total = buf.split("\n").filter((l) => l.trim()).length;
            return { ready: true, path: chunksPath, source, total };
        } catch {
            return { ready: false, path: chunksPath, source, total: 0 };
        }
    }
    return { ready: true, path: chunksPath, source, total: index.docs.length };
}

const THEME_TO_CAT = {
    prio: "priority",
    arb: "cost",
    kk: "cost",
    cost: "cost",
    disc: "cost",
    cost_drop: "cost",
    auto: "auto",
    reject: "auto",
    insp_contact: "inspect",
    insp_survey: "inspect",
    insp_date: "inspect",
    insp_aspect: "inspect",
    insp_other: "inspect",
    tech: "vti",
    risks: "vti",
    ekd: "docs",
    docs: "docs",
    status: "docs",
    szz: "docs",
    sign: "docs",
    plan: "docs",
    pmz: "docs",
    mon: "docs"
};

const CAT_TAGS = {
    priority: "Приоритет",
    cost: "Стоимость",
    auto: "Автооценка",
    inspect: "Осмотр",
    vti: "ВТИ / риски",
    docs: "Сроки и ЭКД"
};

function topicKey(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[«»"']/g, "")
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function guessThemeFromTopic(topic) {
    const t = topicKey(topic);
    if (/приоритет/.test(t)) return "prio";
    if (/автооцен/.test(t)) return "auto";
    if (/арбитраж|не согласен|стоимост|пересмотр|дкп/.test(t)) return "arb";
    if (/\bкк\b|комфорт|бланк|категор/.test(t)) return "kk";
    if (/аспект|смс|самоосмотр|осмотр|контакт/.test(t)) return "insp_aspect";
    if (/\bвти\b|риск/.test(t)) return "risks";
    if (/егрн|экд|материал|размещ/.test(t)) return "ekd";
    if (/сзз|бессрочн|мониторинг|актуализац|статус|отозв|пакет документ|пмз/.test(t)) return "docs";
    return "docs";
}

/**
 * FAQ для лендинга: все уникальные семена (алиасы схлопываем).
 */
export function listLandingFaq() {
    let rows = [];
    try {
        if (!fs.existsSync(FAQ_SEEDS_PATH)) return { ok: true, total: 0, items: [] };
        rows = fs
            .readFileSync(FAQ_SEEDS_PATH, "utf8")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => JSON.parse(l));
    } catch (e) {
        return { ok: false, total: 0, items: [], error: e.message || String(e) };
    }

    const byKey = new Map();
    for (const row of rows) {
        // алиасы — только для поиска RAG, на лендинг не дублируем
        if (String(row.source || "").toLowerCase().includes("алиас")) continue;
        const topic = String(row.topic || "").trim();
        if (!topic) continue;
        const text = String(row.text || "");
        const nl = text.indexOf("\n");
        const answer = (nl >= 0 ? text.slice(nl + 1) : text).trim();
        if (answer.length < 20) continue;
        const key = topicKey(topic);
        const prev = byKey.get(key);
        // ponytail: длиннее ответ / тренажёр предпочтительнее
        const score = answer.length + (String(row.source || "").includes("ренаж") ? 500 : 0);
        const prevScore = prev ? prev._score : -1;
        if (score >= prevScore) {
            const themeId = row.theme_id || guessThemeFromTopic(topic);
            const baseTheme = String(themeId).replace(/_\d+$/, "");
            const cat = THEME_TO_CAT[baseTheme] || THEME_TO_CAT[themeId] || "docs";
            byKey.set(key, {
                id: row.id,
                topic,
                answer: maskConclusionRefs(answer).slice(0, 4000),
                theme_id: themeId,
                cat,
                tag: CAT_TAGS[cat] || "FAQ",
                keys: `${topic} ${answer}`.toLowerCase().replace(/ё/g, "е").slice(0, 400),
                _score: score
            });
        }
    }

    const items = [...byKey.values()]
        .map(({ _score, ...rest }) => rest)
        .sort((a, b) => {
            const order = ["priority", "cost", "auto", "inspect", "vti", "docs"];
            const ai = order.indexOf(a.cat);
            const bi = order.indexOf(b.cat);
            if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
            return a.topic.localeCompare(b.topic, "ru");
        });

    return { ok: true, total: items.length, items };
}

/** @deprecated FTS-хелпер; оставлен на случай внешних импортов */
export function ftsQueryFromText(text) {
    const words = String(text || "")
        .toLowerCase()
        .match(/[a-zа-яё0-9]{2,}/giu);
    if (!words?.length) return "";
    const uniq = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 12);
    return uniq.map((w) => `"${w}"`).join(" OR ");
}

function _selfcheck() {
    const cases = [
        ["SD0272089744", "SD.........."],
        ["ASZ0004435607", "ASZ.........."],
        ["QEL-VUD/ASZ0004435607, приоритет", "DEAL..../ASZ.........., приоритет"],
        ["Укажите номер обращения SD0272254334", "Укажите номер обращения SD.........."],
        ["через сд-ответ без номера", "через сд-ответ без номера"],
        ["срок до 26.05.2026", "срок до ДД.ММ.ГГГГ"],
        ["заключение от 11.11.25", "заключение от ДД.ММ.ГГГГ"],
        ["сделка R1G-J44 закрыта", "сделка DEAL.... закрыта"]
    ];
    for (const [inp, want] of cases) {
        const got = maskConclusionRefs(inp);
        if (got !== want) throw new Error(`mask: ${JSON.stringify(inp)} -> ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
    if (!isConclusionQaReady()) throw new Error("chunks missing");

    const g = loadGlossary();
    if (!(g.expand?.length > 50) || !(g.keep_as_is?.length > 40)) {
        throw new Error(`glossary thin: expand=${g.expand?.length} keep=${g.keep_as_is?.length}`);
    }
    const block = buildGlossaryPromptBlock();
    if (!block.includes("ЗС — Залоговая служба") || !block.includes("Не расшифровывай")) {
        throw new Error("glossary prompt block broken");
    }
    if (!block.includes("СБОФ") || !block.includes("УГС")) {
        throw new Error("glossary missing special keep terms");
    }
    const exp = expandQueryForSearch("Срок действия СЗЗ и цена в УГС");
    if (!/сзз/i.test(exp) || !/условно/i.test(exp)) {
        throw new Error(`expandQueryForSearch failed: ${exp}`);
    }
    const intent = expandQueryForSearch("Не согласен со стоимостью, что делать?");
    if (!/пересмотр|арбитраж|не согласен с оценк/i.test(intent)) {
        throw new Error(`intent expand failed: ${intent}`);
    }
    const modeTpl = chooseAskMode([
        { sheet: "Для ГЛ", collection: "template", score: 1.1, answer: "Добрый день! Ответ шаблона." }
    ]);
    if (modeTpl.mode !== "voice") throw new Error("chooseAskMode template");
    const modeSynth = chooseAskMode([
        { sheet: "ГЛ", collection: "case", score: 0.5, answer: "длинный спорный кейс ".repeat(20) }
    ]);
    if (modeSynth.mode !== "clarify" || modeSynth.hits.length) {
        throw new Error("chooseAskMode case-only");
    }
    const modeFu = chooseAskMode(
        [{ sheet: "FAQ", collection: "faq", score: 1.2, answer: "длинный faq ответ про экд" }],
        { followUp: true }
    );
    if (modeFu.mode !== "voice") throw new Error("chooseAskMode followUp");
    const spoken = speakPlaybook("**Шаг.** " + "абзац. ".repeat(200));
    if (spoken.includes("**") || spoken.length > 900) throw new Error("speakPlaybook");
    const vague = chooseAskMode(
        [{ collection: "faq", score: 1.6, question: "Пересмотр стоимости", answer: "только рыночная" }],
        { question: "что делать с заявкой?" }
    );
    if (vague.mode !== "clarify") throw new Error("chooseAskMode vague");
    const specific = chooseAskMode(
        [{ collection: "faq", score: 4, question: "Как установить приоритет", answer: "АС Друг" }],
        { question: "Как установить приоритет по заявке?" }
    );
    if (specific.mode !== "verbatim") throw new Error("chooseAskMode specific faq");
    if (!isLikelyFollowUp("а для ММБ?")) throw new Error("isLikelyFollowUp");
    const hist = normalizeAskHistory([
        { role: "user", content: "нет ЕГРН в ЭКД" },
        { role: "assistant", content: "проверьте путь…" },
        { role: "bogus", content: "x" }
    ]);
    if (hist.length !== 2) throw new Error("normalizeAskHistory");
    const dq = buildDialogSearchQuery("а для ММБ?", hist);
    if (!/егрн|экд/i.test(dq) || !/ммб/i.test(dq)) throw new Error(`buildDialogSearchQuery: ${dq}`);

    const expect = [
        ["приоритет по заявке", /приоритет/i],
        ["после автооценки можно ли арбитраж", /автооцен/i],
        ["выписка егрн", /егрн/i],
        ["срок действия сзз", /сзз|срок|последзалог/i],
        ["смс самоосмотр", /смс|самоосмотр/i],
        ["самоосмотр смс не пришло", /смс|самоосмотр/i]
    ];
    for (const [q, re] of expect) {
        const r = searchConclusionQa(q, { limit: 1 });
        if (!r.ok || !r.hits[0]) throw new Error(`empty: ${q}`);
        const blob = `${r.hits[0].question}\n${r.hits[0].answer}`;
        if (!re.test(blob)) throw new Error(`mismatch ${q}: ${r.hits[0].question.slice(0, 80)}`);
    }
    for (const bad of ["рецепт борща", "какая погода", "что ты умеешь"]) {
        const off = searchConclusionQa(bad, { limit: 1 });
        if (!off.offTopic || off.count !== 0) throw new Error(`off-topic leak: ${bad}`);
    }
    console.log("conclusion-qa self-check ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    _selfcheck();
}
