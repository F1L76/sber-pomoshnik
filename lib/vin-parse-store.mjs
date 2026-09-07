import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VIN_PARSE_DIR = path.join(__dirname, "..", "data", "vin-parse");
export const RESULTS_JSONL_PATH = path.join(VIN_PARSE_DIR, "results.jsonl");
export const STATUS_PATH = path.join(VIN_PARSE_DIR, "status.json");
export const PROGRESS_LOG_PATH = path.join(VIN_PARSE_DIR, "progress.log");
export const VIN_LIST_PATH = path.join(VIN_PARSE_DIR, "vins.txt");

export function ensureVinParseDir() {
    fs.mkdirSync(VIN_PARSE_DIR, { recursive: true });
}

export function readVinParseStatus() {
    try {
        return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
    } catch {
        return null;
    }
}

export function readVinProgressTail(maxLines = 100) {
    if (!fs.existsSync(PROGRESS_LOG_PATH)) return [];
    const size = fs.statSync(PROGRESS_LOG_PATH).size;
    if (!size) return [];
    const chunk = Math.min(size, 48_000);
    const fd = fs.openSync(PROGRESS_LOG_PATH, "r");
    const buf = Buffer.alloc(chunk);
    fs.readSync(fd, buf, 0, chunk, size - chunk);
    fs.closeSync(fd);
    return buf
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-maxLines);
}

export function loadVinParseProgress() {
    return {
        status: readVinParseStatus() || { done: 0, total: 0, ok: 0, fail: 0, running: false },
        log: readVinProgressTail(100)
    };
}
