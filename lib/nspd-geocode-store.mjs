import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { regionFromCadastral } from "./listings/bazacoop.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const GEOCODE_DIR = path.join(__dirname, "..", "data", "nspd-geocode");
export const KN_LIST_PATH = path.join(GEOCODE_DIR, "kn.txt");
export const COORDS_JSONL_PATH = path.join(GEOCODE_DIR, "coords.jsonl");
export const STATUS_PATH = path.join(GEOCODE_DIR, "status.json");
export const PROGRESS_LOG_PATH = path.join(GEOCODE_DIR, "progress.log");

export function ensureGeocodeDir() {
    fs.mkdirSync(GEOCODE_DIR, { recursive: true });
}

export function compactPoint(row) {
    if (!row || row.ok === false || row.found === false) return null;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const kn = String(row.kn || row.cadastralNumber || "").trim();
    if (!kn) return null;
    return {
        kn,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        t: String(row.t || row.objectType || row.category || ""),
        src: String(row.src || "")
    };
}

export function readStatus() {
    try {
        return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
    } catch {
        return null;
    }
}

/** Последние строки лога геокода — для живого экрана. */
export function readProgressTail(maxLines = 80) {
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

export function loadGeocodeProgress() {
    return {
        status: readStatus() || { done: 0, total: 0, ok: 0, fail: 0, running: false, recent: [] },
        log: readProgressTail(100)
    };
}

function fileMtime(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return 0;
    }
}

let payloadCache = { stamp: -1, payload: null };

export function loadGeocodeMapPayload() {
    const stamp = Math.max(fileMtime(COORDS_JSONL_PATH), fileMtime(STATUS_PATH));
    if (payloadCache.payload && payloadCache.stamp === stamp) return payloadCache.payload;

    const status = readStatus() || {};
    const last = new Map();
    const types = {};
    const regions = {};

    if (fs.existsSync(COORDS_JSONL_PATH)) {
        const raw = fs.readFileSync(COORDS_JSONL_PATH, "utf8");
        for (const line of raw.split("\n")) {
            if (!line) continue;
            let row;
            try {
                row = JSON.parse(line);
            } catch {
                continue;
            }
            const kn = String(row.kn || row.cadastralNumber || "").trim();
            const point = compactPoint(row);
            if (point) last.set(point.kn, { point });
            else if (kn) last.set(kn, { fail: true });
        }
    }

    const points = [];
    let ok = 0;
    let fail = 0;
    for (const rec of last.values()) {
        if (!rec.point) {
            fail += 1;
            continue;
        }
        ok += 1;
        points.push(rec.point);
        const typeKey = rec.point.t || "другое";
        types[typeKey] = (types[typeKey] || 0) + 1;
        const region = regionFromCadastral(rec.point.kn) || "неизвестно";
        regions[region] = (regions[region] || 0) + 1;
    }

    const payload = {
        status: {
            ...status,
            ok: status.ok ?? ok,
            fail: status.fail ?? fail,
            points: points.length
        },
        points,
        types,
        regions
    };
    payloadCache = { stamp, payload };
    return payload;
}
