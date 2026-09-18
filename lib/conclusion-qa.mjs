/**
 * Поиск по базе ГЛ (TF-IDF + бонус шаблонам) из data/gl_rag/chunks.jsonl.
 *
 * ponytail: порт retrieve из scripts/build_gl_rag.py; без pickle/scipy —
 * индекс собирается в памяти при первом запросе (~10k чанков).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GL_RAG_CHUNKS_PATH = path.join(__dirname, "..", "data", "gl_rag", "chunks.jsonl");
/** @deprecated путь старого FTS; оставлен для совместимости info/ошибок */
export const CONCLUSION_QA_DB_PATH = GL_RAG_CHUNKS_PATH;

const WORD = /[а-яёa-z0-9]{3,}/gi;
const KEYWORDS = [
    "егрн", "вти", "бланк", "сбоф", "аспект", "самоосмотр", "приоритет",
    "экд", "мониторинг", "перепланиров", "кадастров", "ликвидацион",
    "автооценк", "гибдд", "сзз", "мдо", "кпки", "рна", "мчс", "сро",
    "внд", "ммб", "ксб", "контакт", "смс", "жилье", "стоим", "пересмотр"
];

/** @type {{ docs: object[], vocab: Map<string, number>, idf: Float32Array, rows: Map<number, number>[], norms: Float32Array } | null} */
let index = null;

export function tokenize(text) {
    const words = String(text || "").toLowerCase().match(WORD) || [];
    return words.map((w) => (w.length > 6 ? w.slice(0, 6) : w));
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
    const answer = nl >= 0 ? doc.text.slice(nl + 1) : doc.text;
    const sheet = doc.collection === "template" ? (doc.source || "Шаблоны") : "ГЛ";
    return { question: doc.topic || "", answer: answer || "", sheet };
}

function buildIndex(docs) {
    const tokenized = docs.map((d) => tokenize(d.text));
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
    return { docs, vocab, idf, rows, norms };
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

function retrieve(query, idx, k = 5) {
    const { docs, vocab, idf, rows, norms } = idx;
    const qv = vectorize(query, vocab, idf);
    const scores = new Float32Array(docs.length);
    for (let i = 0; i < docs.length; i++) {
        let dot = 0;
        const row = rows[i];
        for (let t = 0; t < qv.cols.length; t++) {
            const w = row.get(qv.cols[t]);
            if (w != null) dot += w * qv.data[t];
        }
        scores[i] = dot / (norms[i] * qv.norm);
    }

    const ql = query.toLowerCase();
    const qKeys = KEYWORDS.filter((kw) => ql.includes(kw));
    for (let i = 0; i < docs.length; i++) {
        const tl = String(docs[i].text || "").toLowerCase();
        let bonus = 0;
        for (const kw of qKeys) {
            if (tl.includes(kw)) bonus += 0.12;
        }
        bonus = Math.min(bonus, 0.36);
        if (docs[i].collection === "template") bonus += 0.28;
        scores[i] += bonus;
    }

    const tpl = [];
    const caseIdx = [];
    for (let i = 0; i < docs.length; i++) {
        (docs[i].collection === "template" ? tpl : caseIdx).push(i);
    }
    tpl.sort((a, b) => scores[b] - scores[a]);
    caseIdx.sort((a, b) => scores[b] - scores[a]);

    const picked = [];
    for (const i of tpl) {
        if (scores[i] < 0.08) break;
        picked.push(i);
        if (picked.length >= Math.max(1, k - 1)) break;
    }
    for (const i of caseIdx) {
        if (picked.length >= k) break;
        picked.push(i);
    }
    for (const i of tpl) {
        if (picked.length >= k) break;
        if (!picked.includes(i)) picked.push(i);
    }
    return picked.slice(0, k).map((i) => ({ doc: docs[i], score: scores[i] }));
}

export function isConclusionQaReady() {
    return fs.existsSync(GL_RAG_CHUNKS_PATH);
}

/**
 * @param {string} question
 * @param {{ limit?: number }} [opts]
 */
export function searchConclusionQa(question, opts = {}) {
    const q = String(question || "").trim();
    if (!q) {
        return { ok: false, count: 0, hits: [], error: "question обязателен" };
    }
    if (!isConclusionQaReady()) {
        return {
            ok: false,
            count: 0,
            hits: [],
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
            return { ok: false, count: 0, hits: [], error: e.message || String(e) };
        }
    }

    const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 20);
    // ponytail: бонус шаблонам даёт ~0.28 даже оффтопу; ниже порога — «не по теме»
    const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.48;
    const hitsRaw = retrieve(q, index, limit).filter(({ score }) => score >= minScore);
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
            // быстрый count без полного индекса
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
    const r = searchConclusionQa("приоритет по заявке", { limit: 1 });
    if (!r.ok || r.count < 1) throw new Error("retrieve empty");
    if (!String(r.hits[0].question).toLowerCase().includes("приоритет")) {
        throw new Error(`unexpected top: ${r.hits[0].question}`);
    }
    const off = searchConclusionQa("рецепт борща", { limit: 1 });
    if (!off.offTopic || off.count !== 0) throw new Error("off-topic should be empty");
    console.log("conclusion-qa self-check ok", r.hits.map((h) => `${h.score.toFixed(3)} ${h.sheet} ${h.question.slice(0, 50)}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    _selfcheck();
}
