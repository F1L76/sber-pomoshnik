import fs from "fs";
import path from "path";
import readline from "readline";
import zlib from "zlib";
import { fileURLToPath } from "url";
import os from "os";
import {
    isSqliteReady,
    isSqliteSupported,
    searchDealsFromSqlite,
    getReadDb,
    DEALS_DB_PATH
} from "./deals-sqlite.mjs";
import { applyClassifierLabels, classifyDealCategory } from "./rosreestr-classifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEALS_DIR = path.join(__dirname, "..", "data", "deals");
const QUARTER_INDEX_DIR = path.join(DEALS_DIR, "index");

/** @type {Map<string, string[]>} */
const quarterIndexCache = new Map();

const CSV_COLUMNS = [
    "number",
    "okato",
    "region_code",
    "district",
    "city",
    "quarter_cad_number",
    "street",
    "realestate_type_code",
    "wall_material_code",
    "year_build",
    "floor",
    "purpose_code",
    "area",
    "period_start_date",
    "deal_price",
    "currency",
    "doc_type"
];

const DATASET_FILES = [
    "dataset_СДЕЛКИ_r-r_01-92_y_2026_q_2.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2026_q_2.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2026_q_1.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2026_q_1.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2025_q_4.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2025_q_4.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2025_q_3.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2025_q_3.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2024_q_4.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2024_q_4.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2024_q_3.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2024_q_3.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2024_q_2.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2024_q_2.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2024_q_1.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2024_q_1.csv"
];

const OBJECT_CATEGORIES = [
    { id: "land", label: "Земельные участки" },
    { id: "house", label: "Жилые дома" },
    { id: "nonres", label: "Нежилые здания/помещения" },
    { id: "flat", label: "Жилые помещения" },
    { id: "parking", label: "Машиноместа" }
];

export function normalizeQuarterCadNumber(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/[^\d:]/g, "");
    const parts = digits.split(":").filter(Boolean);
    if (parts.length < 3) {
        throw new Error("Укажите кадастровый квартал в формате XX:XX:XXXXXXX (или полный кадастровый номер)");
    }
    const [region, district, quarter] = parts.slice(0, 3);
    return `${region.padStart(2, "0")}:${district.padStart(2, "0")}:${quarter}`;
}

function resolveDatasetFile(dir, name) {
    const csvPath = path.join(dir, name);
    if (fs.existsSync(csvPath)) return csvPath;
    const gzPath = `${csvPath}.gz`;
    if (fs.existsSync(gzPath)) return gzPath;
    return null;
}

function openDatasetStream(filePath) {
    const stream = fs.createReadStream(filePath);
    if (filePath.endsWith(".gz")) {
        return stream.pipe(zlib.createGunzip());
    }
    return stream;
}

function parseDatasetMeta(filePath) {
    const base = path.basename(filePath).replace(/\.gz$/i, "");
    const isRent = /АРЕНДА/i.test(base);
    const match = base.match(/y_(\d{4})_q_(\d)/i);
    const year = match?.[1] || null;
    const quarter = match?.[2] || null;
    const periodLabel =
        year && quarter ? `${quarter} квартал ${year} года` : "Период не указан";
    const periodShortLabel =
        year && quarter ? `${quarter} кв ${year}` : null;

    return {
        fileName: base,
        path: filePath,
        kind: isRent ? "rent" : "deal",
        kindLabel: isRent ? "Аренда" : "Продажа",
        year: year ? Number(year) : null,
        quarter: quarter ? Number(quarter) : null,
        periodLabel,
        periodShortLabel,
        sortKey: year && quarter ? Number(year) * 100 + Number(quarter) : 0
    };
}

function resolveDatasetPaths() {
    const found = [];
    const seen = new Set();

    const envList = process.env.DEALS_DATASET_PATHS?.trim();
    if (envList) {
        for (const part of envList.split(/[;,]/)) {
            const file = part.trim();
            if (file && fs.existsSync(file) && !seen.has(file)) {
                seen.add(file);
                found.push(parseDatasetMeta(file));
            }
        }
    }

    if (process.env.DEALS_DATASET_PATH?.trim()) {
        const file = process.env.DEALS_DATASET_PATH.trim();
        if (fs.existsSync(file) && !seen.has(file)) {
            seen.add(file);
            found.push(parseDatasetMeta(file));
        }
    }

    const dirs = [DEALS_DIR, path.join(os.homedir(), "Downloads")];

    for (const name of DATASET_FILES) {
        for (const dir of dirs) {
            const file = resolveDatasetFile(dir, name);
            if (file && !seen.has(file)) {
                seen.add(file);
                found.push(parseDatasetMeta(file));
                break;
            }
        }
    }

    return found.sort((a, b) => b.sortKey - a.sortKey);
}

export function getAvailableDealYears() {
    const years = new Set(resolveDatasetPaths().map((d) => d.year).filter(Boolean));
    return [...years].sort((a, b) => b - a);
}

function detectDelimiter(headerLine) {
    const semi = (headerLine.match(/;/g) || []).length;
    const tilde = (headerLine.match(/~/g) || []).length;
    return semi > tilde ? ";" : "~";
}

function parseRow(line, delimiter = "~") {
    const parts = line.split(delimiter);
    if (parts.length < CSV_COLUMNS.length) return null;
    const row = {};
    for (let i = 0; i < CSV_COLUMNS.length; i++) {
        let v = parts[i] ?? "";
        if (v === '""' || v === "") v = null;
        else v = v.replace(/^"(.*)"$/, "$1");
        row[CSV_COLUMNS[i]] = v;
    }
    return row;
}

function enrichRow(row, datasetMeta) {
    const price = row.deal_price != null ? Number(String(row.deal_price).replace(/\s/g, "")) : null;
    const area = row.area != null ? Number(String(row.area).replace(/\s/g, "").replace(",", ".")) : null;
    const pricePerSqm = price != null && area > 0 ? Math.round(price / area) : null;
    const categoryId = classifyDealCategory(row);
    const categoryLabel = OBJECT_CATEGORIES.find((c) => c.id === categoryId)?.label || "Прочее";

    const enriched = {
        ...row,
        deal_price: Number.isFinite(price) ? price : null,
        area: Number.isFinite(area) ? area : null,
        pricePerSqm,
        categoryId,
        categoryLabel,
        operationKind: datasetMeta.kindLabel,
        periodLabel: datasetMeta.periodLabel,
        periodShortLabel: datasetMeta.periodShortLabel,
        datasetFile: datasetMeta.fileName,
        locationLabel: [row.city, row.district, row.street].filter(Boolean).join(", ") || null
    };
    return applyClassifierLabels(enriched);
}

function statsForDeals(deals) {
    const prices = deals.map((d) => d.deal_price).filter((p) => p != null && p > 0);
    const sum = prices.reduce((a, b) => a + b, 0);
    const withArea = deals.filter((d) => d.deal_price > 0 && d.area > 0);
    const totalArea = withArea.reduce((a, d) => a + d.area, 0);
    const totalPriceForArea = withArea.reduce((a, d) => a + d.deal_price, 0);
    const pricePerSqmAvg = totalArea > 0 ? Math.round(totalPriceForArea / totalArea) : null;
    return {
        count: deals.length,
        withPrice: prices.length,
        priceMin: prices.length ? Math.min(...prices) : null,
        priceMax: prices.length ? Math.max(...prices) : null,
        priceAvg: prices.length ? Math.round(sum / prices.length) : null,
        priceSum: prices.length ? Math.round(sum) : null,
        pricePerSqmAvg
    };
}

function buildStats(deals) {
    const byCategory = {};
    for (const cat of OBJECT_CATEGORIES) {
        byCategory[cat.id] = { label: cat.label, ...statsForDeals([]) };
    }

    const grouped = Object.fromEntries(OBJECT_CATEGORIES.map((c) => [c.id, []]));
    for (const deal of deals) {
        const id = deal.categoryId || "nonres";
        if (!grouped[id]) grouped[id] = [];
        grouped[id].push(deal);
    }

    for (const cat of OBJECT_CATEGORIES) {
        byCategory[cat.id] = { label: cat.label, ...statsForDeals(grouped[cat.id]) };
    }

    const overall = statsForDeals(deals);
    return {
        total: overall.count,
        withPrice: overall.withPrice,
        priceMin: overall.priceMin,
        priceMax: overall.priceMax,
        priceAvg: overall.priceAvg,
        priceSum: overall.priceSum,
        pricePerSqmAvg: overall.pricePerSqmAvg,
        byCategory
    };
}

function quarterIndexPath(datasetMeta) {
    return path.join(QUARTER_INDEX_DIR, `${datasetMeta.fileName}.quarters.json.gz`);
}

function loadQuarterIndex(datasetMeta) {
    const cacheKey = datasetMeta.fileName;
    if (quarterIndexCache.has(cacheKey)) {
        return quarterIndexCache.get(cacheKey);
    }

    const indexPath = quarterIndexPath(datasetMeta);
    if (!fs.existsSync(indexPath)) {
        quarterIndexCache.set(cacheKey, null);
        return null;
    }

    const raw = zlib.gunzipSync(fs.readFileSync(indexPath)).toString("utf8");
    const quarters = JSON.parse(raw);
    quarterIndexCache.set(cacheKey, quarters);
    return quarters;
}

function quarterListedInIndex(quarters, quarter) {
    if (!quarters?.length) return true;
    let lo = 0;
    let hi = quarters.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cmp = quarters[mid].localeCompare(quarter);
        if (cmp === 0) return true;
        if (cmp < 0) lo = mid + 1;
        else hi = mid - 1;
    }
    return false;
}

function shouldScanDataset(datasetMeta, quarter) {
    const quarters = loadQuarterIndex(datasetMeta);
    if (quarters === null) return true;
    return quarterListedInIndex(quarters, quarter);
}

export const DEAL_OBJECT_TYPE_CODES = {
    land: "002001001000",
    building: "002001002000",
    premises: "002001003000"
};

export function normalizeOperationKinds(input) {
    if (!input?.length) return null;
    const kinds = new Set();
    for (const item of input) {
        const s = String(item).trim().toLowerCase();
        if (s === "deal" || s === "deals" || s === "сделка" || s === "сделки" || s === "продажа" || s === "продажи") kinds.add("deal");
        if (s === "rent" || s === "аренда") kinds.add("rent");
    }
    return kinds.size ? [...kinds] : null;
}

export function normalizeObjectTypeCodes(input) {
    if (!input?.length) return null;
    const codes = new Set();
    const labels = {
        зу: DEAL_OBJECT_TYPE_CODES.land,
        здание: DEAL_OBJECT_TYPE_CODES.building,
        помещение: DEAL_OBJECT_TYPE_CODES.premises
    };
    for (const item of input) {
        const s = String(item).trim();
        if (!s) continue;
        if (Object.values(DEAL_OBJECT_TYPE_CODES).includes(s)) codes.add(s);
        else if (DEAL_OBJECT_TYPE_CODES[s]) codes.add(DEAL_OBJECT_TYPE_CODES[s]);
        else if (labels[s.toLowerCase()]) codes.add(labels[s.toLowerCase()]);
    }
    return codes.size ? [...codes] : null;
}

async function scanDataset(datasetMeta, quarter, objectTypeCodes = null) {
    const deals = [];
    const rl = readline.createInterface({
        input: openDatasetStream(datasetMeta.path),
        crlfDelay: Infinity
    });

    let isHeader = true;
    let delimiter = "~";
    for await (const line of rl) {
        if (!line.trim()) continue;
        if (isHeader) {
            delimiter = detectDelimiter(line);
            isHeader = false;
            continue;
        }
        const row = parseRow(line, delimiter);
        if (!row || row.quarter_cad_number !== quarter) continue;
        if (objectTypeCodes?.length && !objectTypeCodes.includes(row.realestate_type_code)) continue;
        deals.push(enrichRow(row, datasetMeta));
    }
    return deals;
}

/** Подгружает индексы кварталов в память при старте сервера (ускоряет первый поиск). */
export function warmupDealsIndexes() {
    try {
        if (isSqliteReady()) {
            getReadDb();
            console.log(`[deals] SQLite готов: ${DEALS_DB_PATH}`);
            return;
        }
        if (!isSqliteSupported()) {
            console.warn("[deals] SQLite недоступен (нужен Node.js 22+), поиск по CSV");
        } else if (!fs.existsSync(DEALS_DB_PATH)) {
            console.warn("[deals] SQLite не найден — выполните: npm run deals:import");
        }
        const datasets = resolveDatasetPaths();
        for (const datasetMeta of datasets) {
            loadQuarterIndex(datasetMeta);
        }
        console.log(`[deals] индексы кварталов загружены: ${datasets.length} датасетов`);
    } catch (e) {
        console.warn("[deals] не удалось прогреть индексы:", e.message);
    }
}

export function getDealsDatasetInfo() {
    const datasets = resolveDatasetPaths();
    if (!datasets.length) {
        return {
            available: false,
            datasets: [],
            message: "Файлы датасетов не найдены. Положите CSV или CSV.GZ в data/deals/"
        };
    }
    return {
        available: true,
        datasets: datasets.map((d) => ({
            fileName: d.fileName,
            kind: d.kindLabel,
            period: d.periodLabel,
            sizeMb: Math.round((fs.statSync(d.path).size / (1024 * 1024)) * 10) / 10
        }))
    };
}

/**
 * Поиск сделок и аренды по номеру кадастрового квартала (XX:XX:XXXXXXX).
 */
function sortDeals(deals, datasets) {
    deals.sort((a, b) => {
        const metaA = datasets.find((d) => d.fileName === a.datasetFile);
        const metaB = datasets.find((d) => d.fileName === b.datasetFile);
        const sk = (metaB?.sortKey || 0) - (metaA?.sortKey || 0);
        if (sk !== 0) return sk;
        return (b.deal_price || 0) - (a.deal_price || 0);
    });
    return deals;
}

function buildSearchMeta(deals, { limit, year, source } = {}) {
    const truncated = deals.length > limit;
    return {
        datasets: getDealsDatasetInfo().datasets,
        availableYears: getAvailableDealYears(),
        year: year ?? null,
        truncated,
        shown: Math.min(deals.length, limit),
        totalInQuarter: deals.length,
        ...(source ? { source } : {})
    };
}

function emptyYearMessage(quarter, year) {
    return `Записей по кварталу ${quarter} за ${year} год не найдено`;
}

export async function searchDealsByQuarter(rawQuarter, { limit = 10000, year, objectTypes, operationKinds } = {}) {
    const quarter = normalizeQuarterCadNumber(rawQuarter);
    const objectTypeCodes = normalizeObjectTypeCodes(objectTypes);
    const operationKindFilter = normalizeOperationKinds(operationKinds);
    const allDatasets = resolveDatasetPaths();
    const yearFilter = year != null && Number.isFinite(Number(year)) ? Number(year) : null;
    let datasets = yearFilter
        ? allDatasets.filter((d) => d.year === yearFilter)
        : allDatasets;
    if (operationKindFilter?.length) {
        datasets = datasets.filter((d) => operationKindFilter.includes(d.kind));
    }

    if (!allDatasets.length) {
        return {
            found: false,
            quarterCadNumber: quarter,
            deals: [],
            stats: buildStats([]),
            meta: { datasets: [], availableYears: [] },
            message: getDealsDatasetInfo().message
        };
    }

    if (yearFilter && !datasets.length) {
        return {
            found: false,
            quarterCadNumber: quarter,
            deals: [],
            stats: buildStats([]),
            meta: buildSearchMeta([], { limit, year: yearFilter }),
            message: `Датасеты за ${yearFilter} год не подключены`
        };
    }

    if (isSqliteReady()) {
        const deals = searchDealsFromSqlite(quarter, {
            year: yearFilter,
            objectTypeCodes,
            operationKinds: operationKindFilter
        }) || [];
        const stats = buildStats(deals);
        return {
            found: deals.length > 0,
            quarterCadNumber: quarter,
            deals: deals.slice(0, limit),
            stats,
            meta: buildSearchMeta(deals, { limit, year: yearFilter, source: "sqlite" }),
            message: deals.length
                ? null
                : yearFilter
                  ? emptyYearMessage(quarter, yearFilter)
                  : `Записей по кварталу ${quarter} в подключённых датасетах не найдено`
        };
    }

    const deals = [];
    for (const datasetMeta of datasets) {
        if (!shouldScanDataset(datasetMeta, quarter)) continue;
        const batch = await scanDataset(datasetMeta, quarter, objectTypeCodes);
        if (batch.length) deals.push(...batch);
    }

    sortDeals(deals, allDatasets);
    const stats = buildStats(deals);

    return {
        found: deals.length > 0,
        quarterCadNumber: quarter,
        deals: deals.slice(0, limit),
        stats,
        meta: buildSearchMeta(deals, { limit, year: yearFilter }),
        message: deals.length
            ? null
            : yearFilter
              ? emptyYearMessage(quarter, yearFilter)
              : `Записей по кварталу ${quarter} в подключённых датасетах не найдено`
    };
}
