import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFIER_PATH = path.join(__dirname, "..", "data", "rosreestr-classifier.json");

/** @type {Record<string, string> | null} */
let codeMap = null;

function loadCodeMap() {
    if (codeMap) return codeMap;
    const raw = JSON.parse(fs.readFileSync(CLASSIFIER_PATH, "utf8"));
    codeMap = raw.codes || {};
    return codeMap;
}

function normalizeCodeKey(code) {
    const digits = String(code || "").replace(/\D/g, "");
    if (!digits) return null;
    return digits.padStart(12, "0");
}

export function lookupClassifierCode(code) {
    if (code == null || code === "") return null;
    const map = loadCodeMap();
    const raw = String(code).trim();
    if (map[raw]) return map[raw];
    const padded = normalizeCodeKey(raw);
    if (padded && map[padded]) return map[padded];
    const trimmed = raw.replace(/^0+/, "");
    for (const [key, value] of Object.entries(map)) {
        if (key.replace(/^0+/, "") === trimmed) return value;
    }
    return null;
}

export function labelClassifierCode(code, fallback = null) {
    const label = lookupClassifierCode(code);
    if (label) return label;
    if (fallback != null && fallback !== "" && !/^\d{11,12}$/.test(String(fallback).trim())) {
        return fallback;
    }
    return code != null && code !== "" ? String(code) : (fallback ?? null);
}

export function labelClassifierCodesList(raw, fallback = null) {
    if (raw == null || raw === "") return fallback ?? null;
    const parts = String(raw)
        .split(/[;]+/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (!parts.length) return fallback ?? null;
    return parts.map((p) => labelClassifierCode(p, p)).join("; ");
}

export function applyClassifierLabels(deal) {
    if (!deal) return deal;
    return {
        ...deal,
        realestateTypeLabel: labelClassifierCode(deal.realestate_type_code, deal.realestateTypeLabel),
        purposeLabel: labelClassifierCode(deal.purpose_code, deal.purposeLabel),
        wallMaterialLabel: labelClassifierCodesList(deal.wall_material_code)
    };
}

const RESIDENTIAL_PURPOSE_LABELS = new Set(["Жилое", "Жилое строение", "Садовый дом"]);
const NONRESIDENTIAL_PURPOSE_LABELS = new Set(["Нежилое"]);

/** Жилое / нежилое по коду назначения (204xxx — здания, 206xxx — помещения). */
export function purposeKindFromCode(code) {
    if (code == null || code === "") return null;
    const label = lookupClassifierCode(code);
    if (label && RESIDENTIAL_PURPOSE_LABELS.has(label)) return "residential";
    if (label && NONRESIDENTIAL_PURPOSE_LABELS.has(label)) return "nonresidential";
    const digits = String(code).replace(/\D/g, "");
    if (!digits) return null;
    if (digits.startsWith("204002") || digits.startsWith("206002") || digits.startsWith("204004") || digits.startsWith("204005")) {
        return "residential";
    }
    if (digits.startsWith("204001") || digits.startsWith("206001")) {
        return "nonresidential";
    }
    return null;
}

export function classifyDealCategory(row) {
    const type = normalizeCodeKey(row?.realestate_type_code) || "";
    const purposeKind = purposeKindFromCode(row?.purpose_code);

    if (type === "002001001000") return "land";
    if (type === "002001009000") return "parking";
    if (type === "002001003000") {
        if (purposeKind === "residential") return "flat";
        return "nonres";
    }
    if (type === "002001002000") {
        if (purposeKind === "residential") return "house";
        if (purposeKind === "nonresidential") return "nonres";
        return "house";
    }
    return "nonres";
}
