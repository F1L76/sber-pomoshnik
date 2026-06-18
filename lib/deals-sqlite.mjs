import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "url";
import { applyClassifierLabels, classifyDealCategory } from "./rosreestr-classifier.mjs";

const CATEGORY_LABELS = {
    land: "Земельные участки",
    house: "Жилые дома",
    nonres: "Нежилые здания/помещения",
    flat: "Жилые помещения",
    parking: "Машиноместа"
};

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEALS_DB_PATH = path.join(__dirname, "..", "data", "deals", "deals.sqlite");

/** @type {typeof import("node:sqlite").DatabaseSync | null} */
let DatabaseSync = null;
try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
} catch {
    DatabaseSync = null;
}

let readDb = null;

export function isSqliteSupported() {
    return DatabaseSync != null;
}

export function isSqliteReady() {
    return isSqliteSupported() && fs.existsSync(DEALS_DB_PATH);
}

export function getReadDb() {
    if (!isSqliteReady()) return null;
    if (!readDb) {
        readDb = new DatabaseSync(DEALS_DB_PATH, { readOnly: true });
    }
    return readDb;
}

export function openWritableDb() {
    if (!DatabaseSync) {
        throw new Error("SQLite недоступен: нужен Node.js 22+");
    }
    return new DatabaseSync(DEALS_DB_PATH);
}

export function initDealsDbSchema(db) {
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        DROP TABLE IF EXISTS deals;
        CREATE TABLE deals (
            quarter_cad_number TEXT NOT NULL,
            sort_key INTEGER NOT NULL,
            deal_price REAL,
            payload TEXT NOT NULL
        );
        CREATE INDEX idx_deals_quarter ON deals(quarter_cad_number);
        CREATE INDEX idx_deals_quarter_sort ON deals(quarter_cad_number, sort_key DESC, deal_price DESC);
    `);
}

export function searchDealsFromSqlite(quarter, { limit, year, objectTypeCodes, operationKinds } = {}) {
    const db = getReadDb();
    if (!db) return null;

    let sql = `SELECT payload FROM deals
               WHERE quarter_cad_number = ?`;
    const params = [quarter];
    if (year != null && Number.isFinite(year)) {
        sql += ` AND sort_key >= ? AND sort_key < ?`;
        params.push(year * 100, (year + 1) * 100);
    }
    if (objectTypeCodes?.length) {
        const placeholders = objectTypeCodes.map(() => "?").join(", ");
        sql += ` AND json_extract(payload, '$.realestate_type_code') IN (${placeholders})`;
        params.push(...objectTypeCodes);
    }
    if (operationKinds?.length) {
        const labels = [];
        for (const k of operationKinds) {
            if (k === "rent") labels.push("Аренда");
            else labels.push("Продажа", "Сделка");
        }
        const placeholders = labels.map(() => "?").join(", ");
        sql += ` AND json_extract(payload, '$.operationKind') IN (${placeholders})`;
        params.push(...labels);
    }
    sql += ` ORDER BY sort_key DESC, deal_price DESC`;
    if (limit != null && Number.isFinite(limit)) {
        sql += ` LIMIT ?`;
        params.push(limit);
    }

    return db.prepare(sql).all(...params).map((row) => {
        const deal = applyClassifierLabels(JSON.parse(row.payload));
        if (deal.operationKind === "Сделка") deal.operationKind = "Продажа";
        deal.categoryId = classifyDealCategory(deal);
        deal.categoryLabel = CATEGORY_LABELS[deal.categoryId] || "Прочее";
        return deal;
    });
}

export function countDealsInSqlite(quarter) {
    const db = getReadDb();
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM deals WHERE quarter_cad_number = ?`).get(quarter);
    return Number(row?.cnt ?? 0);
}
