/**
 * Поиск по базе ГЛ (TF-IDF) из data/gl_rag/chunks.jsonl.
 *
 * ponytail: индекс в памяти; топ-1 по скору (тема важнее длинного текста).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GL_RAG_CHUNKS_PATH = path.join(__dirname, "..", "data", "gl_rag", "chunks.jsonl");
/** @deprecated путь старого FTS; оставлен для совместимости info/ошибок */
export const CONCLUSION_QA_DB_PATH = GL_RAG_CHUNKS_PATH;

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
    "арбитраж", "осмотр", "заявк", "отзыв", "заключен", "срок"
];

/** @type {{ docs: object[], vocab: Map<string, number>, idf: Float32Array, rows: Map<number, number>[], norms: Float32Array, topicToks: Set<string>[] } | null} */
let index = null;

export function tokenize(text) {
    const words = String(text || "").toLowerCase().replace(/ё/g, "е").match(WORD) || [];
    return words.map((w) => (w.length > 6 ? w.slice(0, 6) : w));
}

function queryToks(text) {
    return tokenize(text).filter((t) => !STOP.has(t));
}

/**
 * В ответах UI не светим номера ASZ/SD: буквы оставляем, цифры → точки.
 */
export function maskConclusionRefs(text) {
    return String(text ?? "").replace(
        /\b((?:ASZ|SD)[\s\-_/]*)(\d[\d\s\-_/]*)/gi,
        (_, prefix, digits) => prefix + digits.replace(/\d/g, ".")
    );
}

function splitQa(doc) {
    const nl = String(doc.text || "").indexOf("\n");
    let answer = nl >= 0 ? doc.text.slice(nl + 1) : doc.text;
    let question = doc.topic || "";
    // ponytail: в Excel иногда &quot; вместо кавычек
    question = question.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    answer = answer.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const sheet = doc.collection === "template" ? (doc.source || "Шаблоны") : "ГЛ";
    return { question, answer: answer || "", sheet };
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
    return { docs, vocab, idf, rows, norms, topicToks };
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

function topicOverlap(qToks, topicSet) {
    if (!qToks.length || !topicSet.size) return 0;
    let hit = 0;
    for (const t of qToks) {
        if (topicSet.has(t)) hit += 1;
    }
    return hit / qToks.length;
}

function retrieve(query, idx, k = 5) {
    const { docs, vocab, idf, rows, norms, topicToks } = idx;
    const qToks = queryToks(query);
    const qv = vectorize(qToks.join(" "), vocab, idf);
    const ql = query.toLowerCase().replace(/ё/g, "е");
    const qKeys = KEYWORDS.filter((kw) => ql.includes(kw));

    // без значимых токенов — пусто (оффтоп вроде «какая погода»)
    if (!qToks.length && !qKeys.length) return [];

    const scored = new Array(docs.length);
    for (let i = 0; i < docs.length; i++) {
        let dot = 0;
        const row = rows[i];
        for (let t = 0; t < qv.cols.length; t++) {
            const w = row.get(qv.cols[t]);
            if (w != null) dot += w * qv.data[t];
        }
        let score = 0.28 * (dot / (norms[i] * qv.norm));

        const topic = String(docs[i].topic || "").toLowerCase().replace(/ё/g, "е");
        const overlap = topicOverlap(qToks, topicToks[i]);
        score += 0.75 * overlap;
        // все значимые слова запроса в короткой теме — сильный сигнал playbook
        if (qToks.length >= 2 && overlap >= 0.99) score += 0.45;
        else if (qToks.length >= 2 && overlap >= 0.66) score += 0.2;
        if (docs[i].collection === "template" && overlap >= 0.5) score += 0.15;
        if (topic.length > 0 && topic.length < 80 && overlap > 0) score += 0.1;

        const keysInTopic = qKeys.filter((key) => topic.includes(key)).length;
        if (keysInTopic >= 2) score += 0.45;
        else if (keysInTopic === 1) score += 0.12;

        let kw = 0;
        for (const key of qKeys) {
            if (topic.includes(key)) continue;
            if (String(docs[i].text || "").toLowerCase().includes(key)) kw += 0.04;
        }
        score += Math.min(kw, 0.12);

        scored[i] = { i, score };
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ i, score }) => ({ doc: docs[i], score }));
}

export function isConclusionQaReady() {
    return fs.existsSync(GL_RAG_CHUNKS_PATH);
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
    if (!isConclusionQaReady()) {
        return {
            ok: false,
            count: 0,
            hits: [],
            offTopic: false,
            error: "База data/gl_rag/chunks.jsonl не найдена. Запустите: npm run conclusion-qa:build"
        };
    }

    // ponytail: sync API для proxy; индекс прогреваем лениво через sync read если ещё нет
    if (!index) {
        try {
            const raw = fs.readFileSync(GL_RAG_CHUNKS_PATH, "utf8");
            const docs = raw
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => JSON.parse(l));
            index = buildIndex(docs);
        } catch (e) {
            return { ok: false, count: 0, hits: [], offTopic: false, error: e.message || String(e) };
        }
    }

    const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 20);
    const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.32;
    const hitsRaw = retrieve(q, index, Math.max(limit, 3))
        .filter(({ score }) => score >= minScore)
        .slice(0, limit);

    // отказ, если в топе нет пересечения значимых токенов / доменных ключей
    if (hitsRaw.length) {
        const qToks = queryToks(q);
        const ql = q.toLowerCase().replace(/ё/g, "е");
        const qKeys = KEYWORDS.filter((kw) => ql.includes(kw));
        const top = hitsRaw[0].doc;
        const topic = String(top.topic || "").toLowerCase().replace(/ё/g, "е");
        const hay = new Set(tokenize(top.topic || ""));
        let overlap = 0;
        for (const t of qToks) {
            if (hay.has(t)) overlap += 1;
        }
        const keyHit = qKeys.some((kw) => topic.includes(kw) || String(top.text || "").toLowerCase().includes(kw));
        if (overlap === 0 && !keyHit) {
            return { ok: true, count: 0, hits: [], offTopic: true };
        }
    }

    return {
        ok: true,
        count: hitsRaw.length,
        offTopic: hitsRaw.length === 0,
        hits: hitsRaw.map(({ doc, score }) => {
            const { question: qq, answer, sheet } = splitQa(doc);
            return {
                id: doc.id,
                sheet,
                question: maskConclusionRefs(qq),
                answer: maskConclusionRefs(answer),
                refId: null,
                score: Number(score)
            };
        })
    };
}

export function getConclusionQaInfo() {
    if (!isConclusionQaReady()) {
        return { ready: false, path: GL_RAG_CHUNKS_PATH, total: 0 };
    }
    if (!index) {
        try {
            const buf = fs.readFileSync(GL_RAG_CHUNKS_PATH, "utf8");
            const total = buf.split("\n").filter((l) => l.trim()).length;
            return { ready: true, path: GL_RAG_CHUNKS_PATH, total };
        } catch {
            return { ready: false, path: GL_RAG_CHUNKS_PATH, total: 0 };
        }
    }
    return { ready: true, path: GL_RAG_CHUNKS_PATH, total: index.docs.length };
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
        ["QEL-VUD/ASZ0004435607, приоритет", "QEL-VUD/ASZ.........., приоритет"],
        ["Укажите номер обращения SD0272254334", "Укажите номер обращения SD.........."],
        ["через сд-ответ без номера", "через сд-ответ без номера"]
    ];
    for (const [inp, want] of cases) {
        const got = maskConclusionRefs(inp);
        if (got !== want) throw new Error(`mask: ${JSON.stringify(inp)} -> ${JSON.stringify(got)}`);
    }
    if (!isConclusionQaReady()) throw new Error("chunks missing");

    const expect = [
        ["приоритет по заявке", /приоритет/i],
        ["после автооценки можно ли арбитраж", /автооцен/i],
        ["выписка егрн", /егрн/i],
        ["срок действия сзз", /сзз/i],
        ["смс самоосмотр", /смс|самоосмотр/i]
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
