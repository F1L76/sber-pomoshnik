import { lookupCadastralObject, normalizeCadastralNumber } from "./cadastral-lookup.mjs";
import { searchBazacoop } from "./listings/bazacoop.mjs";
import {
    relevanceScore,
    dedupeListings,
    buildSearchLinks,
    listingContainsCadastral
} from "./listing-utils.mjs";
import { buildPlacePhotoResult } from "./place-photo.mjs";
import { lookupKadbaseObject, compareKadbaseRosreestr } from "./kadbase-lookup.mjs";

const MIN_RELEVANCE_SCORE = 50;
const MIN_STREET_RELEVANCE_SCORE = 45;
// ponytail: жёсткий потолок на каждый источник, чтобы UI не ждал минутами
const SOURCE_DEADLINE_MS = {
    kadbase: 10_000,
    panorama: 10_000,
    bazacoop: 20_000
};

function withDeadline(promise, ms, fallbackFactory) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(fallbackFactory()), ms);
        })
    ]);
}

function filterListings(listings, context, cadastralNumber) {
    const scored = listings
        .map((listing) => {
            const relevance = relevanceScore(listing, context);
            if (listing.matchedBy === "street" && !relevance.reasons.includes("объявление на той же улице")) {
                relevance.reasons.push("объявление на той же улице");
            }
            return { ...listing, relevance };
        })
        .sort((a, b) => (b.relevance?.score || 0) - (a.relevance?.score || 0));

    return scored.filter((l) => {
        const score = l.relevance?.score || 0;
        if (listingContainsCadastral(l, cadastralNumber)) return true;
        if (l.matchedBy === "analog" || l.matchedBy === "region") return true;
        if (score >= MIN_RELEVANCE_SCORE) return true;
        return l.matchedBy === "street" && score >= MIN_STREET_RELEVANCE_SCORE;
    });
}

function buildStats(allListings) {
    return {
        total: allListings.length,
        matched: allListings.length,
        bySource: {
            bazacoop: allListings.filter((l) => l.source === "bazacoop").length
        }
    };
}

/**
 * Потоковый поиск: после НСПД параллельно kadbase + фото + БазаЦООП.
 * @yields {{ event: string, data: object }}
 */
export async function* streamCadastralSearch(rawNumber) {
    const cadastralNumber = normalizeCadastralNumber(rawNumber);
    yield { event: "status", data: { phase: "nspd", message: "Запрос в реестр НСПД…" } };

    const rosreestr = await lookupCadastralObject(cadastralNumber);
    const address = rosreestr.object?.address || "";

    yield {
        event: "rosreestr",
        data: {
            cadastralNumber,
            rosreestr,
            searchLinks: buildSearchLinks(cadastralNumber, address)
        }
    };

    if (!rosreestr.found) {
        const kadbase = await withDeadline(
            lookupKadbaseObject(cadastralNumber, { address }),
            SOURCE_DEADLINE_MS.kadbase,
            () => ({
                found: false,
                cadastralNumber,
                message: "kadbase.ru не ответил вовремя",
                source: "kadbase.ru"
            })
        );
        yield {
            event: "kadbase",
            data: {
                kadbase,
                comparison: null
            }
        };
        yield {
            event: "done",
            data: {
                errors: [rosreestr.message],
                stats: { total: 0, matched: 0, bySource: { bazacoop: 0 } },
                meta: { note: null }
            }
        };
        return;
    }

    const context = { cadastralNumber, address };
    const allListings = [];
    const allErrors = [];
    const sourceNotices = [];

    // ponytail: один pool после НСПД — не ждём kadbase перед фото/объявлениями
    const pool = new Map([
        [
            "kadbase",
            withDeadline(
                lookupKadbaseObject(cadastralNumber, { address })
                    .then((kadbase) => ({
                        kadbase,
                        comparison: compareKadbaseRosreestr(kadbase, rosreestr)
                    }))
                    .catch((err) => ({
                        kadbase: {
                            found: false,
                            cadastralNumber,
                            message: err?.message || String(err),
                            source: "kadbase.ru"
                        },
                        comparison: null
                    })),
                SOURCE_DEADLINE_MS.kadbase,
                () => ({
                    kadbase: {
                        found: false,
                        cadastralNumber,
                        message: "kadbase.ru не ответил вовремя — откройте поиск по ссылке",
                        source: "kadbase.ru"
                    },
                    comparison: null
                })
            )
        ],
        [
            "panorama",
            withDeadline(
                buildPlacePhotoResult({
                    cadastralNumber,
                    address,
                    lat: rosreestr.object?.location?.lat,
                    lon: rosreestr.object?.location?.lon
                }).catch((err) => ({
                    status: "error",
                    error: err?.message || String(err),
                    photos: [],
                    imageUrl: null
                })),
                SOURCE_DEADLINE_MS.panorama,
                () => ({
                    status: "error",
                    error: "Фото/панорама не получены вовремя",
                    photos: [],
                    imageUrl: null
                })
            )
        ],
        [
            "bazacoop",
            withDeadline(
                searchBazacoop({
                    cadastralNumber,
                    address,
                    objectType: rosreestr.object?.objectType,
                    category: rosreestr.object?.category,
                    area: rosreestr.object?.area
                }).catch((err) => ({ listings: [], errors: [err?.message || String(err)] })),
                SOURCE_DEADLINE_MS.bazacoop,
                () => ({
                    listings: [],
                    errors: [],
                    unavailable: {
                        source: "bazacoop",
                        reason: "timeout",
                        message: "БазаЦООП не ответила вовремя — откройте поиск по ссылке"
                    }
                })
            )
        ]
    ]);

    while (pool.size) {
        const racing = [...pool.entries()].map(([name, promise]) =>
            promise.then((value) => ({ name, value }))
        );
        const { name, value } = await Promise.race(racing);
        pool.delete(name);

        if (name === "kadbase") {
            yield { event: "kadbase", data: value };
            continue;
        }

        if (name === "panorama") {
            yield { event: "panorama", data: { panorama: value } };
            continue;
        }

        const sourceResult = value;
        allErrors.push(...(sourceResult.errors || []));
        if (sourceResult.unavailable) {
            sourceNotices.push(sourceResult.unavailable);
        }
        const matched = filterListings(sourceResult.listings || [], context, cadastralNumber);
        allListings.push(...matched);

        yield {
            event: "listings",
            data: {
                source: name,
                listings: matched,
                errors: sourceResult.errors || [],
                unavailable: sourceResult.unavailable || null,
                stats: buildStats(dedupeListings(allListings))
            }
        };
    }

    const listings = dedupeListings(allListings);
    yield {
        event: "done",
        data: {
            errors: allErrors,
            stats: buildStats(listings),
            meta: {
                sourceNotices,
                note:
                    listings.length === 0
                        ? "Объявления о продаже по этому объекту не найдены в БазаЦООП. Используйте ссылку для ручного поиска."
                        : null
            }
        }
    };
}

/** Полный ответ одним JSON (CLI и обратная совместимость). */
export async function searchByCadastralNumber(rawNumber) {
    let result = null;

    for await (const chunk of streamCadastralSearch(rawNumber)) {
        if (chunk.event === "rosreestr") {
            result = {
                ...chunk.data,
                listings: [],
                errors: [],
                panorama: null,
                kadbase: null,
                comparison: null,
                stats: buildStats([]),
                meta: {}
            };
        } else if (chunk.event === "kadbase") {
            result.kadbase = chunk.data.kadbase;
            result.comparison = chunk.data.comparison;
        } else if (chunk.event === "panorama") {
            result.panorama = chunk.data.panorama;
        } else if (chunk.event === "listings") {
            const seen = new Set(result.listings.map((l) => l.url || l.title));
            for (const item of chunk.data.listings) {
                const key = item.url || item.title;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.listings.push(item);
                }
            }
            result.stats = chunk.data.stats;
            result.errors.push(...chunk.data.errors);
        } else if (chunk.event === "done") {
            result.errors = [...new Set([...result.errors, ...chunk.data.errors])];
            result.stats = chunk.data.stats;
            result.meta = chunk.data.meta;
            result.listings = dedupeListings(result.listings);
        }
    }

    return result;
}
