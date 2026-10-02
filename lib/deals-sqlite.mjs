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
        CREATE INDEX idx_deals_city_sort ON deals(json_extract(payload, '$.city'), sort_key);
        CREATE INDEX idx_deals_region_sort ON deals(json_extract(payload, '$.region_code'), sort_key);
    `);
}

const LOCATION_INDEXES = ["idx_deals_city_sort", "idx_deals_region_sort"];

/** Индексы для отчёта по городу/региону. На уже собранной БД — npm run deals:location-index. */
export function ensureDealsLocationIndexes(db) {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_deals_city_sort
            ON deals(json_extract(payload, '$.city'), sort_key);
        CREATE INDEX IF NOT EXISTS idx_deals_region_sort
            ON deals(json_extract(payload, '$.region_code'), sort_key);
    `);
}

/** ponytail: один раз на старой БД; если индексов нет — полный проход таблицы (минуты на большом sqlite). */
export function ensureDealsLocationIndexesIfMissing() {
    if (!isSqliteReady()) return false;
    const db = openWritableDb();
    try {
        const placeholders = LOCATION_INDEXES.map(() => "?").join(", ");
        const row = db
            .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name IN (${placeholders})`)
            .get(...LOCATION_INDEXES);
        if (Number(row?.c) >= LOCATION_INDEXES.length) return false;
        ensureDealsLocationIndexes(db);
        return true;
    } finally {
        db.close();
    }
}

function hydrateDeal(row) {
    const deal = applyClassifierLabels(JSON.parse(row.payload));
    if (deal.operationKind === "Сделка") deal.operationKind = "Продажа";
    deal.categoryId = classifyDealCategory(deal);
    deal.categoryLabel = CATEGORY_LABELS[deal.categoryId] || "Прочее";
    return deal;
}

function withDealFilters(sql, params, { year, sortKeys, objectTypeCodes, operationKinds, limit } = {}) {
    if (sortKeys?.length) {
        sql += ` AND sort_key IN (${sortKeys.map(() => "?").join(", ")})`;
        params.push(...sortKeys);
    } else if (year != null && Number.isFinite(year)) {
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
    return sql;
}

export function searchDealsFromSqlite(quarter, { limit, year, objectTypeCodes, operationKinds } = {}) {
    const db = getReadDb();
    if (!db) return null;

    const params = [quarter];
    const sql = withDealFilters(
        `SELECT payload FROM deals WHERE quarter_cad_number = ?`,
        params,
        { year, objectTypeCodes, operationKinds, limit }
    );
    return db.prepare(sql).all(...params).map(hydrateDeal);
}

export function searchDealsReportFromSqlite({
    city,
    regionCodes,
    sortKeys,
    objectTypeCodes,
    operationKinds,
    limit
} = {}) {
    const db = getReadDb();
    if (!db) return null;
    if (!sortKeys?.length) return [];

    const params = [];
    let where;
    if (city) {
        where = `json_extract(payload, '$.city') = ?`;
        params.push(city);
    } else if (regionCodes?.length) {
        where = `json_extract(payload, '$.region_code') IN (${regionCodes.map(() => "?").join(", ")})`;
        params.push(...regionCodes);
    } else {
        return [];
    }
    const sql = withDealFilters(`SELECT payload FROM deals WHERE ${where}`, params, {
        sortKeys,
        objectTypeCodes,
        operationKinds,
        limit
    });
    return db.prepare(sql).all(...params).map(hydrateDeal);
}

export function countDealsInSqlite(quarter) {
    const db = getReadDb();
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM deals WHERE quarter_cad_number = ?`).get(quarter);
    return Number(row?.cnt ?? 0);
}
