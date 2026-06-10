import fs from "fs";
import path from "path";
import readline from "readline";
import zlib from "zlib";
import { fileURLToPath } from "url";
import os from "os";
import { applyClassifierLabels } from "./rosreestr-classifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEALS_DIR = path.join(__dirname, "..", "data", "deals");

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
    { id: "flat", label: "Квартиры" },
    { id: "parking", label: "Машиноместа" }
];

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

export function parseDatasetMeta(filePath) {
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

export function resolveDatasetPathsForImport() {
    const found = [];
    const seen = new Set();
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

    return found.sort((a, b) => a.sortKey - b.sortKey);
}

function isResidentialPurpose(code) {
    if (!code) return false;
    return code.startsWith("204001") || code.startsWith("206001");
}

function isNonResidentialPurpose(code) {
    if (!code) return false;
    return code.startsWith("204002") || code.startsWith("206002");
}

function classifyObjectCategory(row) {
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
    const categoryId = classifyObjectCategory(row);
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

export async function* iterDatasetRows(datasetMeta) {
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
        if (!row) continue;
        yield enrichRow(row, datasetMeta);
    }
}
