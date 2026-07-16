import { parseAddressParts } from "./cadastral-lookup.mjs";

const STOP_WORDS = new Set([
    "россия",
    "российская",
    "федерация",
    "город",
    "г",
    "москва",
    "ул",
    "улица",
    "пр",
    "проспект",
    "пер",
    "переулок",
    "д",
    "дом",
    "кв",
    "квартира",
    "вн",
    "тер",
    "муниципальный",
    "округ",
    "земельный",
    "участок",
    "область",
    "край",
    "республика",
    "район",
    "продаю",
    "продажа",
    "продаётся"
]);

export function formatPrice(value, currency = "RUB") {
    if (value == null || value === "" || Number.isNaN(Number(value))) return null;
    const num = Number(String(value).replace(/\s/g, ""));
    if (!num) return null;
    return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency,
        maximumFractionDigits: 0
    }).format(num);
}

export function cadastralSearchVariants(cadastralNumber) {
    const normalized = String(cadastralNumber || "").trim();
    const parts = normalized.split(":");
    const variants = new Set([normalized, normalized.replace(/:/g, " "), normalized.replace(/:/g, "-")]);
    if (parts.length === 4) {
        const shortThird = String(Number(parts[2]));
        if (shortThird !== parts[2]) {
            variants.add(`${parts[0]}:${parts[1]}:${shortThird}:${parts[3]}`);
        }
        variants.add(`${parts[2]}:${parts[3]}`);
    }
    return [...variants];
}

export function textContainsCadastral(text, cadastralNumber) {
    const haystack = String(text || "").toLowerCase();
    if (!haystack || !cadastralNumber) return false;
    return cadastralSearchVariants(cadastralNumber).some((variant) => haystack.includes(variant.toLowerCase()));
}

export function listingContainsCadastral(listing, cadastralNumber) {
    const blob = [listing.title, listing.description, listing.address, JSON.stringify(listing.raw || {})].join("\n");
    return textContainsCadastral(blob, cadastralNumber);
}

export function parsePriceText(text) {
    if (!text) return null;
    const cleaned = String(text).replace(/[^\d]/g, "");
    return cleaned ? Number(cleaned) : null;
}

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function extractStreetTokens(address) {
    if (!address) return [];
    const streetMatch = address.match(
        /(?:улица|ул\.?|проспект|пр-?т|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-?р)\s+([^,]+)/i
    );
    const source = streetMatch ? streetMatch[1] : address.split(",").pop() || address;
    return tokenize(source).filter((w) => w.length > 2);
}

function extractHouseNumber(address) {
    if (!address) return null;
    const m = address.match(/(?:д\.?|дом|участок|вл\.?|владение)\s*(\d+[\w/-]*)/i) || address.match(/(\d+[\w/-]*)\s*$/);
    return m ? m[1].toLowerCase() : null;
}

export function relevanceScore(listing, context) {
    const { cadastralNumber, address } = context;
    const haystack = [listing.title, listing.description, listing.address]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    let score = 0;
    const reasons = [];

    if (cadastralNumber && textContainsCadastral(haystack, cadastralNumber)) {
        score += 100;
        reasons.push("кадастровый номер в тексте объявления");
    }

    if (listing.matchedBy === "analog") {
        score += 60;
        reasons.push(listing.distance ? `аналог БазаЦООП (${listing.distance})` : "аналог БазаЦООП");
    } else if (listing.matchedBy === "region") {
        score += 40;
        reasons.push("тот же регион в БазаЦООП");
    }

    const { city } = parseAddressParts(address);
    if (city && haystack.includes(city.toLowerCase())) {
        score += 20;
        reasons.push(`город (${city})`);
    }

    const streetTokens = extractStreetTokens(address);
    const listingTokens = new Set(tokenize(haystack));
    const matchedStreet = streetTokens.filter((t) => listingTokens.has(t));

    if (streetTokens.length >= 2 && matchedStreet.length >= 2) {
        score += matchedStreet.length * 25;
        reasons.push(`совпадение улицы (${matchedStreet.join(", ")})`);
    } else if (streetTokens.length === 1 && matchedStreet.length === 1) {
        score += 30;
        reasons.push(`совпадение улицы (${matchedStreet[0]})`);
    }

    const house = extractHouseNumber(address);
    if (house && matchedStreet.length > 0 && haystack.includes(house)) {
        score += 25;
        reasons.push(`совпадение номера (${house})`);
    }

    return { score, reasons };
}

export function dedupeListings(listings) {
    const seen = new Map();
    for (const item of listings) {
        const key = `${item.source}:${item.id || item.url}`;
        const prev = seen.get(key);
        if (!prev || (item.relevance?.score || 0) > (prev.relevance?.score || 0)) {
            seen.set(key, item);
        }
    }
    return [...seen.values()];
}

export function buildSearchLinks(cadastralNumber, address) {
    return {
        bazacoop: `https://bazacoop.ru/cadastral`,
        bazacoopList: `https://bazacoop.ru/re/zemelnye-uchastki?location=${encodeURIComponent(address || cadastralNumber)}`
    };
}
