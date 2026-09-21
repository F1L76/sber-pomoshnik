/**
 * Оценки ответов RAG (👍/👎) → JSONL.
 * ponytail: append-only файл; без БД, пока объём маленький.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEEDBACK_PATH = path.join(__dirname, "..", "data", "gl_rag", "feedback.jsonl");

export function appendConclusionQaFeedback(entry) {
    const vote = entry?.vote;
    if (vote !== "up" && vote !== "down") {
        return { ok: false, error: "vote: up|down" };
    }
    const question = String(entry.question || "").trim();
    if (!question) return { ok: false, error: "question обязателен" };

    const row = {
        at: new Date().toISOString(),
        vote,
        question: question.slice(0, 2000),
        answer: entry.answer != null ? String(entry.answer).slice(0, 4000) : undefined,
        comment: entry.comment != null ? String(entry.comment).slice(0, 1000) : undefined,
        hitIds: Array.isArray(entry.hitIds) ? entry.hitIds.slice(0, 10).map(String) : undefined,
        source: entry.source ? String(entry.source).slice(0, 40) : undefined
    };

    fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
    fs.appendFileSync(FEEDBACK_PATH, JSON.stringify(row) + "\n", "utf8");
    return { ok: true, path: FEEDBACK_PATH };
}

export function getFeedbackPath() {
    return FEEDBACK_PATH;
}
