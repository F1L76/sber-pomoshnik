import { BROWSER_HEADERS } from "../https-fetch.mjs";
import { formatPrice } from "../listing-utils.mjs";

const REAL_ESTATE_PATH_RE = /(kvartir|dom|kommer|nedvizhimost|zemel|ofis|pomesh|garazh|room)/i;

const BLOCK_CACHE_MS = 5 * 60 * 1000;
let blockCacheUntil = 0;

const AVITO_UNAVAILABLE = {
    source: "avito",
    reason: "ip_blocked",
    message:
        "Авито недоступен с IP сервера — площадка ограничивает автоматические запросы. Откройте поиск по ссылке «Авито» выше."
};

const BLOCK_TEXT_PATTERNS = [
    /ip-?адрес/i,
    /доступ.*огранич/i,
    /ограничил/i,
    /captcha/i,
    /too-?many-?requests/i,
    /forbidden/i
];

export class AvitoBlockedError extends Error {
    constructor(message = AVITO_UNAVAILABLE.message) {
        super(message);
        this.name = "AvitoBlockedError";
        this.code = "AVITO_BLOCKED";
    }
}

function isBlockedMessage(text) {
    const s = String(text || "");
    if (!s) return false;
    return BLOCK_TEXT_PATTERNS.some((re) => re.test(s));
}

function detectBlockedResponse(res, text, json) {
    if (res.status === 403 || res.status === 429) return true;
    if (json?.["too-many-requests"]) return true;
    if (isBlockedMessage(text)) return true;
    if (json && typeof json === "object") {
        const payload = JSON.stringify(json);
        if (isBlockedMessage(payload)) return true;
    }
    return false;
}

function blockedResult(cached = false) {
    return {
        listings: [],
        errors: [],
        unavailable: { ...AVITO_UNAVAILABLE, cached }
    };
}

function avitoPhoto(images) {
    if (!images?.length) return [];
    return images
        .slice(0, 8)
        .map((img) => {
            if (typeof img === "string") return img;
            return img["640x480"] || img["432x324"] || img["339x339"] || img["278x278"] || Object.values(img)[0];
        })
        .filter(Boolean);
}

function mapItem(item, query, matchedBy) {
    const price = item.priceDetailed?.value || item.price || null;
    return {
        source: "avito",
        id: String(item.id),
        title: item.title || "Объявление Авито",
        address: item.location?.name || null,
        description: item.description || null,
        price: price || null,
        priceFormatted: item.priceDetailed?.string || formatPrice(price),
        photos: avitoPhoto(item.images),
        url: item.urlPath ? `https://www.avito.ru${item.urlPath.split("?")[0]}` : null,
        matchedBy,
        searchQuery: query
    };
}

async function searchOnce(query, { locationId = 637640, matchedBy = null, maxPages = 2 } = {}) {
    const matchType = matchedBy || "address";
    const all = [];

    for (let page = 1; page <= maxPages; page++) {
        const url =
            `https://www.avito.ru/web/1/main/items?` +
            new URLSearchParams({
                query,
                locationId: String(locationId),
                categoryId: "42",
                page: String(page)
            }).toString();

        const res = await fetch(url, {
            headers: {
                ...BROWSER_HEADERS,
                Accept: "application/json, text/plain, */*",
                Referer: "https://www.avito.ru/rossiya/nedvizhimost"
            }
        });
        const text = await res.text();

        let json;
        try {
            json = JSON.parse(text);
        } catch {
            if (detectBlockedResponse(res, text, null)) {
                throw new AvitoBlockedError(
                    isBlockedMessage(text) ? text.slice(0, 200) : "Доступ к Авито временно ограничен"
                );
            }
            if (!res.ok) {
                throw new Error(`Авито HTTP ${res.status}`);
            }
            throw new Error("Авито вернул неожиданный ответ");
        }

        if (detectBlockedResponse(res, text, json)) {
            const blockMessage =
                json?.["too-many-requests"]?.message ||
                (isBlockedMessage(text) ? text.slice(0, 200) : null) ||
                "Доступ к Авито временно ограничен";
            throw new AvitoBlockedError(blockMessage);
        }

        if (!res.ok) {
            throw new Error(`Авито HTTP ${res.status}`);
        }

        const items = (json.items || [])
            .filter(
                (item) =>
                    REAL_ESTATE_PATH_RE.test(item.urlPath || "") ||
                    REAL_ESTATE_PATH_RE.test(item.title || "")
            )
            .map((item) => mapItem(item, query, matchType));

        all.push(...items);
        if (!json.items?.length) break;
        await new Promise((r) => setTimeout(r, 400));
    }

    return all;
}

export async function searchAvito({ queries, streetQueries = [], locationId = 637640 }) {
    if (Date.now() < blockCacheUntil) {
        return blockedResult(true);
    }

    const results = [];
    const errors = [];
    const plan = [];
    const seen = new Set();

    for (const query of queries) {
        if (seen.has(query)) continue;
        seen.add(query);
        plan.push({ query, matchedBy: "address" });
        if (plan.length >= 4) break;
    }
    for (const query of streetQueries) {
        if (seen.has(query)) continue;
        seen.add(query);
        plan.push({ query, matchedBy: "street" });
        if (plan.length >= 6) break;
    }

    for (const { query, matchedBy } of plan) {
        try {
            const batch = await searchOnce(query, {
                matchedBy,
                locationId,
                maxPages: matchedBy === "street" ? 2 : 3
            });
            results.push(...batch);
            await new Promise((r) => setTimeout(r, 800));
        } catch (e) {
            if (e instanceof AvitoBlockedError || isBlockedMessage(e.message) || String(e.message).includes("403")) {
                blockCacheUntil = Date.now() + BLOCK_CACHE_MS;
                return blockedResult(false);
            }
            errors.push(`Авито («${query}»): ${e.message}`);
        }
    }

    return { listings: results, errors: [...new Set(errors)], unavailable: null };
}

/** @internal Сброс кэша блокировки (для тестов). */
export function _resetAvitoBlockCache() {
    blockCacheUntil = 0;
}
