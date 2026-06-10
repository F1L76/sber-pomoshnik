import fs from "fs";
import path from "path";
import readline from "readline";
import zlib from "zlib";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    "dataset_СДЕЛКИ_r-r_01-92_y_2025_q_4.csv",
    "dataset_СДЕЛКИ_r-r_01-92_y_2025_q_3.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2026_q_1.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2025_q_4.csv",
    "dataset_АРЕНДА_r-r_01-92_y_2025_q_3.csv"
];

const OBJECT_CATEGORIES = [
    { id: "land", label: "Земельные участки" },
    { id: "house", label: "Жилые дома" },
    { id: "nonres", label: "Нежилые здания/помещения" },
    { id: "flat", label: "Квартиры" },
    { id: "parking", label: "Машиноместа" }
];

const REALESTATE_TYPE_LABELS = {
    "002001001000": "Земельный участок",
    "002001002000": "Здание",
    "002001003000": "Помещение",
    "002001004000": "Сооружение",
    "002001005000": "ОНС",
    "002001009000": "Машино-место"
};

const PURPOSE_LABELS = {
    "141004000000": "ИЖС",
    "142001020100": "Многоквартирный дом",
    "204001000000": "Жилое",
    "204002000000": "Нежилое",
    "206001000000": "Жилое",
    "206002000000": "Нежилое"
};

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
        kindLabel: isRent ? "Аренда" : "Сделка",
        year: year ? Number(year) : null,
        quarter: quarter ? Number(quarter) : null,
        periodLabel,
        periodShortLabel,
        sortKey: year && quarter ? year * 10 + quarter : 0
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

    const dirs = [
        path.join(__dirname, "..", "data", "deals"),
        path.join(os.homedir(), "Downloads")
    ];

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

function isResidentialPurpose(code) {
    if (!code) return false;
    return code.startsWith("204001") || code.startsWith("206001");
}

function isNonResidentialPurpose(code) {
    if (!code) return false;
    return code.startsWith("204002") || code.startsWith("206002");
}

export function classifyObjectCategory(row) {
    const type = row.realestate_type_code;
    const purpose = row.purpose_code || "";

    if (type === "002001001000") return "land";
    if (type === "002001009000") return "parking";

    if (type === "002001003000") {
        if (isResidentialPurpose(purpose)) return "flat";
        return "nonres";
    }

    if (type === "002001002000") {
        if (isResidentialPurpose(purpose)) return "house";
        if (isNonResidentialPurpose(purpose)) return "nonres";
        return "house";
    }

    return "nonres";
}

function parseRow(line) {
    const parts = line.split("~");
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
    const categoryId = classifyObjectCategory(row);
    const categoryLabel = OBJECT_CATEGORIES.find((c) => c.id === categoryId)?.label || "Прочее";

    return {
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
        realestateTypeLabel: REALESTATE_TYPE_LABELS[row.realestate_type_code] || row.realestate_type_code,
        purposeLabel: PURPOSE_LABELS[row.purpose_code] || row.purpose_code,
        locationLabel: [row.city, row.district, row.street].filter(Boolean).join(", ") || null
    };
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

async function scanDataset(datasetMeta, quarter) {
    const deals = [];
    const rl = readline.createInterface({
        input: openDatasetStream(datasetMeta.path),
        crlfDelay: Infinity
    });

    let isHeader = true;
    for await (const line of rl) {
        if (!line.trim()) continue;
        if (isHeader) {
            isHeader = false;
            continue;
        }
        const row = parseRow(line);
        if (!row || row.quarter_cad_number !== quarter) continue;
        deals.push(enrichRow(row, datasetMeta));
    }
    return deals;
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
export async function searchDealsByQuarter(rawQuarter, { limit = 10000 } = {}) {
    const quarter = normalizeQuarterCadNumber(rawQuarter);
    const datasets = resolveDatasetPaths();

    if (!datasets.length) {
        return {
            found: false,
            quarterCadNumber: quarter,
            deals: [],
            stats: buildStats([]),
            meta: { datasets: [] },
            message: getDealsDatasetInfo().message
        };
    }

    const batches = await Promise.all(datasets.map((d) => scanDataset(d, quarter)));
    const deals = batches.flat();

    deals.sort((a, b) => {
        const metaA = datasets.find((d) => d.fileName === a.datasetFile);
        const metaB = datasets.find((d) => d.fileName === b.datasetFile);
        const sk = (metaB?.sortKey || 0) - (metaA?.sortKey || 0);
        if (sk !== 0) return sk;
        return (b.deal_price || 0) - (a.deal_price || 0);
    });

    const stats = buildStats(deals);
    const truncated = deals.length > limit;

    return {
        found: deals.length > 0,
        quarterCadNumber: quarter,
        deals: deals.slice(0, limit),
        stats,
        meta: {
            datasets: getDealsDatasetInfo().datasets,
            truncated,
            shown: Math.min(deals.length, limit),
            totalInQuarter: deals.length
        },
        message: deals.length
            ? null
            : `Записей по кварталу ${quarter} в подключённых датасетах не найдено`
    };
}
