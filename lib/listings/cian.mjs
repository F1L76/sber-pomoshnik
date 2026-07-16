import { BROWSER_HEADERS } from "../https-fetch.mjs";
import { formatPrice, listingContainsCadastral } from "../listing-utils.mjs";

const CIAN_API = "https://api.cian.ru/search-offers/v2/search-offers-desktop/";
const MAX_PAGES_CADASTRAL = 3;
const MAX_PAGES_ADDRESS = 2;
const MAX_QUERIES = 3;

const DEFAULT_SEARCH_TYPES = ["flatsale", "suburbansale", "commercialsale"];

function searchTypesForObject(objectType) {
    const t = String(objectType || "").toLowerCase();
    if (t.includes("помещен") || t.includes("нежил") || t.includes("коммер")) {
        return ["commercialsale", "suburbansale", "flatsale"];
    }
    if (t.includes("земель") || t.includes("участок")) {
        return ["suburbansale", "commercialsale"];
    }
    if (t.includes("дом") || t.includes("коттедж")) {
        return ["suburbansale", "commercialsale"];
    }
    return DEFAULT_SEARCH_TYPES;
}

function buildOfferUrl(offer, type) {
    if (offer.fullUrl) return offer.fullUrl;
    const id = offer.cianId || offer.id;
    if (!id) return null;
    if (type === "commercialsale" || type === "commercialrent") {
        return `https://www.cian.ru/sale/commercial/${id}/`;
    }
    if (type === "suburbansale" || type === "suburbanrent") {
        return `https://www.cian.ru/sale/suburban/${id}/`;
    }
    return `https://www.cian.ru/sale/flat/${id}/`;
}

function mapOffer(offer, query, matchedBy, type) {
    const id = offer.cianId || offer.id;
    const photos = (offer.photos || [])
        .map((p) => p.fullUrl || p.url || p.thumbnailUrl)
        .filter(Boolean)
        .slice(0, 8);

    return {
        source: "cian",
        id: String(id),
        title: offer.title || offer.building?.name || offer.geo?.userInput || "Объявление Циан",
        address: offer.geo?.userInput || offer.geo?.address?.[0]?.fullName || null,
        description: offer.description || null,
        price: offer.bargainTerms?.priceRur ?? offer.bargainTerms?.price ?? null,
        priceFormatted: formatPrice(offer.bargainTerms?.priceRur ?? offer.bargainTerms?.price),
        photos,
        url: buildOfferUrl(offer, type),
        matchedBy,
        searchQuery: query,
        raw: { offerType: type }
    };
}

async function fetchOffersPage(query, regionId, type, page, attempt = 1) {
    const body = {
        jsonQuery: {
            _type: type,
            engine_version: { type: "term", value: 2 },
            region: { type: "terms", value: [regionId] },
            text: { type: "term", value: query },
            page: { type: "term", value: page }
        }
    };

    const res = await fetch(CIAN_API, {
        method: "POST",
        headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.cian.ru",
            Referer: "https://www.cian.ru/"
        },
        body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Циан HTTP ${res.status}`);
    }
    if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500));
            return fetchOffersPage(query, regionId, type, page, attempt + 1);
        }
        throw new Error("Циан заблокировал запрос (антибот). Попробуйте позже или откройте ссылку вручную.");
    }

    const json = JSON.parse(text);
    return json?.data?.offersSerialized || [];
}

async function searchQuery({ query, regionId, type, cadastralNumber, maxPages }) {
    const matchedBy = query.includes(":") ? "cadastral" : "address";
    const results = [];
    let foundCadastral = false;

    for (let page = 1; page <= maxPages; page++) {
        const offers = await fetchOffersPage(query, regionId, type, page);
        if (!offers.length) break;

        for (const offer of offers) {
            const mapped = mapOffer(offer, query, matchedBy, type);
            results.push(mapped);
            if (cadastralNumber && listingContainsCadastral(mapped, cadastralNumber)) {
                foundCadastral = true;
            }
        }

        if (foundCadastral && matchedBy === "cadastral") break;
        await new Promise((r) => setTimeout(r, 120));
    }

    return results;
}

export async function searchCian({ queries, regionId, objectType, cadastralNumber }) {
    const results = [];
    const errors = [];
    const types = searchTypesForObject(objectType);

    const orderedQueries = [...queries].sort((a, b) => {
        const rank = (q) => {
            if (q.includes(":")) return 0;
            if (/\d/.test(q) && /(?:ул|улица|пр|пер|ш|наб|б-?р|пл)/i.test(q)) return 1;
            return 2;
        };
        return rank(a) - rank(b);
    });

    for (const query of orderedQueries.slice(0, MAX_QUERIES)) {
        const isCadastralQuery = query.includes(":");
        const maxPages = isCadastralQuery ? MAX_PAGES_CADASTRAL : MAX_PAGES_ADDRESS;

        for (const type of types) {
            try {
                const batch = await searchQuery({
                    query,
                    regionId,
                    type,
                    cadastralNumber,
                    maxPages
                });
                results.push(...batch);

                if (cadastralNumber && batch.some((item) => listingContainsCadastral(item, cadastralNumber))) {
                    break;
                }
                await new Promise((r) => setTimeout(r, 150));
            } catch (e) {
                errors.push(`Циан (${type}, «${query}»): ${e.message}`);
                break;
            }
        }

        if (cadastralNumber && results.some((item) => listingContainsCadastral(item, cadastralNumber))) {
            break;
        }
    }

    return { listings: results, errors: [...new Set(errors)] };
}
