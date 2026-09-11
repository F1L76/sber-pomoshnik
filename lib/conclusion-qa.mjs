/**
 * Поиск ответов по «Вопросам по заключению» (SQLite FTS5).
 *
 * ponytail: Forpes предлагает LangChain+Chroma+Ollama — здесь уже node:sqlite (как deals);
 * keyword FTS5 по нормализованному Q&A из Excel. GigaChat synthesis — опционально в UI.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONCLUSION_QA_DB_PATH = path.join(__dirname, "..", "data", "conclusion_qa.sqlite");

/** @type {typeof import("node:sqlite").DatabaseSync | null} */
let DatabaseSync = null;
try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
} catch {
    DatabaseSync = null;
}

let readDb = null;

export function isConclusionQaReady() {
    return DatabaseSync != null && fs.existsSync(CONCLUSION_QA_DB_PATH);
}

function getDb() {
    if (!isConclusionQaReady()) return null;
    if (!readDb) {
        readDb = new DatabaseSync(CONCLUSION_QA_DB_PATH, { readOnly: true });
    }
    return readDb;
}

/** Слова для FTS5 MATCH; спецсимволы FTS выкидываем. */
export function ftsQueryFromText(text) {
    const words = String(text || "")
        .toLowerCase()
        .match(/[a-zа-яё0-9]{2,}/giu);
    if (!words?.length) return "";
    const uniq = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 12);
    return uniq.map((w) => `"${w}"`).join(" OR ");
}

/**
 * В ответах UI/GigaChat не светим номера ASZ/SD: буквы оставляем, цифры → точки.
 * ponytail: только отображение; в sqlite сырые ID остаются для отладки импорта.
 */
export function maskConclusionRefs(text) {
    return String(text ?? "").replace(
        /\b((?:ASZ|SD)[\s\-_/]*)(\d[\d\s\-_/]*)/gi,
        (_, prefix, digits) => prefix + digits.replace(/\d/g, ".")
    );
}

/**
 * @param {string} question
 * @param {{ limit?: number }} [opts]
 * @returns {{ ok: boolean, count: number, hits: Array<{id:number,sheet:string,question:string,answer:string,refId:string|null,score:number|null}>, error?: string }}
 */
export function searchConclusionQa(question, opts = {}) {
    const db = getDb();
    if (!db) {
        return {
            ok: false,
            count: 0,
            hits: [],
            error: "База conclusion_qa.sqlite не найдена. Запустите: npm run conclusion-qa:build"
        };
    }

    const q = String(question || "").trim();
    if (!q) {
        return { ok: false, count: 0, hits: [], error: "question обязателен" };
    }

    const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 20);
    const match = ftsQueryFromText(q);

    let rows = [];
    if (match) {
        try {
            rows = db
                .prepare(
                    `SELECT qa.id AS id, qa.sheet AS sheet, qa.question AS question,
                            qa.answer AS answer, qa.ref_id AS refId,
                            bm25(qa_fts) AS score
                     FROM qa_fts
                     JOIN qa ON qa.id = qa_fts.rowid
                     WHERE qa_fts MATCH ?
                     ORDER BY score
                     LIMIT ?`
                )
                .all(match, limit);
        } catch {
            rows = [];
        }
    }

    // Fallback: LIKE по первым словам, если FTS пуст
    if (!rows.length) {
        const like = `%${q.slice(0, 80).replace(/%/g, "")}%`;
        rows = db
            .prepare(
                `SELECT id, sheet, question, answer, ref_id AS refId, NULL AS score
                 FROM qa
                 WHERE question LIKE ? OR answer LIKE ?
                 LIMIT ?`
            )
            .all(like, like, limit);
    }

    return {
        ok: true,
        count: rows.length,
        hits: rows.map((r) => ({
            id: r.id,
            sheet: r.sheet,
            question: maskConclusionRefs(r.question),
            answer: maskConclusionRefs(r.answer),
            refId: r.refId ? maskConclusionRefs(r.refId) : null,
            score: r.score == null ? null : Number(r.score)
        }))
    };
}

export function getConclusionQaInfo() {
    const db = getDb();
    if (!db) {
        return { ready: false, path: CONCLUSION_QA_DB_PATH, total: 0 };
    }
    const row = db.prepare("SELECT COUNT(*) AS n FROM qa").get();
    return {
        ready: true,
        path: CONCLUSION_QA_DB_PATH,
        total: Number(row?.n || 0)
    };
}

function _selfcheckMask() {
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    _selfcheckMask();
    console.log("conclusion-qa mask self-check ok");
}
