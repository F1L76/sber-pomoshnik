import { fileURLToPath } from "url";
import { httpsFetch, BROWSER_HEADERS } from "../https-fetch.mjs";
import { formatPrice, parsePriceText } from "../listing-utils.mjs";
import { parseAddressParts } from "../cadastral-lookup.mjs";

const BASE = "https://bazacoop.ru";
const TIMEOUT_MS = 18_000;

function normalizePhotoUrl(src) {
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith("//")) return `https:${src}`;
    if (src.startsWith("/")) return `${BASE}${src}`;
    return `${BASE}/${src}`;
}

/** Код субъекта РФ → значение фильтра region на БазаЦООП */
const REGION_BY_CODE = {
    1: "Адыгея",
    2: "Башкортостан",
    3: "Бурятия",
    4: "Алтайский край",
    5: "Дагестан",
    6: "Ингушетия",
    7: "Кабардино-Балкария",
    8: "Калмыкия",
    9: "Карачаево-Черкесия",
    10: "Карелия",
    11: "Коми",
    12: "Марий Эл",
    13: "Мордовия",
    14: "Саха (Якутия)",
    15: "Северная Осетия",
    16: "Татарстан",
    17: "Тыва",
    18: "Удмуртия",
    19: "Хакасия",
    20: "Чечня",
    21: "Чувашия",
    22: "Алтайский край",
    23: "Краснодарский край",
    24: "Красноярский край",
    25: "Приморский край",
    26: "Ставропольский край",
    27: "Хабаровский край",
    28: "Амурская область",
    29: "Архангельская область",
    30: "Астраханская область",
    31: "Белгородская область",
    32: "Брянская область",
    33: "Владимирская область",
    34: "Волгоградская область",
    35: "Вологодская область",
    36: "Воронежская область",
    37: "Ивановская область",
    38: "Иркутская область",
    39: "Калининградская область",
    40: "Калужская область",
    41: "Камчатский край",
    42: "Кемеровская область",
    43: "Кировская область",
    44: "Костромская область",
    45: "Курганская область",
    46: "Курская область",
    47: "Ленинградская область",
    48: "Липецкая область",
    49: "Магаданская область",
    50: "Московская область",
    51: "Мурманская область",
    52: "Нижегородская область",
    53: "Новгородская область",
    54: "Новосибирская область",
    55: "Омская область",
    56: "Оренбургская область",
    57: "Орловская область",
    58: "Пензенская область",
    59: "Пермский край",
    60: "Псковская область",
    61: "Ростовская область",
    62: "Рязанская область",
    63: "Самарская область",
    64: "Саратовская область",
    65: "Сахалинская область",
    66: "Свердловская область",
    67: "Смоленская область",
    68: "Тамбовская область",
    69: "Тверская область",
    70: "Томская область",
    71: "Тульская область",
    72: "Тюменская область",
    73: "Ульяновская область",
    74: "Челябинская область",
    75: "Забайкальский край",
    76: "Ярославская область",
    77: "Москва",
    78: "Санкт-Петербург",
    79: "Еврейская АО",
    86: "Ханты-Мансийский АО",
    89: "Ямало-Ненецкий АО",
    91: "Крым",
    92: "Севастополь"
};

function stripTags(html) {
    return String(html || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&#34;/g, '"')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

/** КН + тип из НСПД → земля или коммерция (каталог БазаЦООП). */
export function detectListingKind({ objectType, category } = {}) {
    const blob = `${objectType || ""} ${category || ""}`.toLowerCase();
    if (/здан|строен|помещен|квартир|коммер|псн|офис|торгов|нежил|building|room/i.test(blob)) {
        return "commercial";
    }
    if (/земел|участ|land|parcel/i.test(blob)) return "land";
    // ponytail: кадастровый поиск чаще по ЗУ — по умолчанию земля
    return "land";
}

export function regionFromCadastral(cadastralNumber, address) {
    const code = Number(String(cadastralNumber || "").split(":")[0]);
    if (REGION_BY_CODE[code]) return REGION_BY_CODE[code];

    if (!address) return null;
    const obl = address.match(/([А-Яа-яЁё-]+(?:\s+[А-Яа-яЁё-]+)?)\s+обл(?:асть|\.)?/i);
    if (obl) return `${obl[1].trim()} область`;
    const krai = address.match(/([А-Яа-яЁё-]+(?:\s+[А-Яа-яЁё-]+)?)\s+край/i);
    if (krai) return `${krai[1].trim()} край`;
    if (/Москва/i.test(address)) return "Москва";
    if (/Санкт-Петербург|Петербург/i.test(address)) return "Санкт-Петербург";
    return null;
}

function streetSearchToken(street, streetLabel) {
    const raw = (street || streetLabel || "").replace(
        /^(?:улица|ул\.?|проспект|пр-?т|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-?р|площадь|пл\.?)\s+/i,
        ""
    );
    return raw.replace(/\s+/g, " ").trim() || null;
}

function listingMatchesStreet(listing, streetToken) {
    if (!streetToken) return true;
    const hay = `${listing.address || ""} ${listing.title || ""}`.toLowerCase();
    const token = streetToken.toLowerCase();
    if (hay.includes(token)) return true;
    // «Ленина» ↔ «ул. Ленина» / без окончания
    const stem = token.replace(/(ая|яя|ое|ий|ый|ой)$/i, "");
    return stem.length >= 4 && hay.includes(stem);
}

function areaRange(areaM2, land) {
    const n = Number(areaM2);
    if (!n || n <= 0) return {};
    if (land) {
        const sot = n / 100;
        return {
            area_min: Math.max(0.1, Math.round(sot * 0.7 * 10) / 10),
            area_max: Math.round(sot * 1.3 * 10) / 10
        };
    }
    return {
        area_min: Math.max(1, Math.round(n * 0.7)),
        area_max: Math.round(n * 1.3)
    };
}

function parseAdsTable(html, matchedBy) {
    const rows = [...html.matchAll(/<tr class="ads-table__row"[^>]*>([\s\S]*?)<\/tr>/gi)];
    const listings = [];

    for (const [, row] of rows) {
        const adPath = (row.match(/href="(\/ads\/\d+)/) || [])[1];
        if (!adPath) continue;
        const id = adPath.split("/").pop();
        const externalId = stripTags((row.match(/class="ads-table__link"[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
        const photo = (row.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
        const location =
            stripTags((row.match(/class="col-location"[^>]*>([\s\S]*?)<\/td>/) || [])[1]) ||
            cells.find((c) => /обл\.|край|г\.|ул\.|р-н|поселен/i.test(c)) ||
            null;
        const priceCell =
            stripTags((row.match(/class="col-price"[^>]*>([\s\S]*?)<\/td>/) || [])[1]) ||
            cells.find((c) => /₽/.test(c) && !/км/.test(c)) ||
            null;
        const price = parsePriceText(priceCell);
        const areaText = cells.find((c) => /сот\.|м²|м2/i.test(c)) || null;
        const distance = cells.find((c) => /км/i.test(c)) || null;
        const suitable = /badge--active/.test(row);
        const badge = suitable ? "Подходит" : /badge--inactive/.test(row) ? "Не подходит" : null;

        const titleParts = [areaText, priceCell].filter(Boolean);
        const descParts = [
            distance ? `Расстояние: ${distance}` : null,
            badge,
            externalId ? `ID источника: ${externalId}` : null
        ].filter(Boolean);

        listings.push({
            source: "bazacoop",
            id,
            title: titleParts.length ? titleParts.join(", ") : `Объявление ${externalId || id}`,
            address: location,
            description: descParts.join(". ") || null,
            price,
            priceFormatted: priceCell || formatPrice(price),
            photos: photo ? [normalizePhotoUrl(photo)].filter(Boolean) : [],
            url: `${BASE}${adPath}`,
            bazacoopUrl: `${BASE}${adPath}`,
            matchedBy,
            area: areaText,
            distance,
            suitable
        });
    }

    return listings;
}

function extractExternalListingUrl(html) {
    const fromLabel = (html.match(
        /Ссылка на объявление[\s\S]{0,400}?href="(https?:\/\/[^"]+)"/i
    ) || [])[1];
    if (fromLabel) return fromLabel;
    return (
        (html.match(
            /href="(https?:\/\/(?:www\.)?(?:avito\.ru|cian\.ru|domclick\.ru|youla\.ru|m\.avito\.ru)[^"]*)"/i
        ) || [])[1] || null
    );
}

async function fetchSourceListingUrl(bazacoopAdUrl) {
    try {
        const { res, html } = await fetchHtml(bazacoopAdUrl, {
            headers: { Referer: `${BASE}/re` },
            timeoutMs: 10_000
        });
        if (!res.ok) return null;
        return extractExternalListingUrl(html);
    } catch {
        return null;
    }
}

/** Достаём исходную ссылку (Авито и т.п.) с карточки БазаЦООП. */
async function enrichListingsWithSourceUrls(listings, { limit = 25, concurrency = 6 } = {}) {
    const targets = listings.slice(0, limit);
    let i = 0;

    async function worker() {
        while (i < targets.length) {
            const idx = i++;
            const item = targets[idx];
            const sourceUrl = await fetchSourceListingUrl(item.bazacoopUrl || item.url);
            if (sourceUrl) {
                item.url = sourceUrl;
                item.sourceUrl = sourceUrl;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
    return listings;
}

async function fetchHtml(url, options = {}) {
    const { headers: extraHeaders, timeoutMs, ...rest } = options;
    const res = await httpsFetch(url, {
        timeoutMs: timeoutMs || TIMEOUT_MS,
        headers: {
            ...BROWSER_HEADERS,
            Accept: "text/html,application/xhtml+xml",
            ...(extraHeaders || {})
        },
        ...rest
    });
    const html = await res.text();
    return { res, html };
}

async function searchByCadastral(cadastralNumber) {
    const body = new URLSearchParams({ cadastral_number: cadastralNumber }).toString();
    const { res, html } = await fetchHtml(`${BASE}/cadastral`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: BASE,
            Referer: `${BASE}/cadastral`
        },
        body
    });

    if (!res.ok) {
        throw new Error(`БазаЦООП HTTP ${res.status}`);
    }
    if (/notice--error/.test(html) && !/ads-table__row/.test(html)) {
        const notice = stripTags((html.match(/class="notice[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
        return { listings: [], notice: notice || "Объект не найден в БазаЦООП" };
    }

    return { listings: parseAdsTable(html, "analog"), notice: null };
}

async function fetchCatalogPage({ kind, region, location, area, land }) {
    const path = kind === "commercial" ? "/re/kommercheskaya-nedvizhimost" : "/re/zemelnye-uchastki";
    const params = new URLSearchParams({
        sort_by: "parsed_at",
        sort_order: "desc",
        ...(region ? { region } : {}),
        ...(location ? { location } : {}),
        ...Object.fromEntries(
            Object.entries(areaRange(area, land)).map(([k, v]) => [k, String(v)])
        )
    });
    if (land) params.set("suitability_status", "suitable");

    const url = `${BASE}${path}?${params}`;
    const { res, html } = await fetchHtml(url, { headers: { Referer: `${BASE}/re` } });
    if (!res.ok) throw new Error(`БазаЦООП каталог HTTP ${res.status}`);
    return parseAdsTable(html, location ? "address" : "region");
}

/**
 * Регион из КН → каталог земли/коммерции → location=город, затем улица.
 */
async function searchByAddress({ cadastralNumber, address, objectType, category, area }) {
    const kind = detectListingKind({ objectType, category });
    const land = kind === "land";
    const region = regionFromCadastral(cadastralNumber, address);
    const { city, street, streetLabel } = parseAddressParts(address);
    const streetToken = streetSearchToken(street, streetLabel);

    const queries = [];
    // 1) город в регионе
    if (city) queries.push({ location: city, matchedBy: "address" });
    // 2) улица (фильтр location на БазаЦООП — подстрока адреса)
    if (streetToken) queries.push({ location: streetToken, matchedBy: "street" });
    // 3) только регион, если адреса нет
    if (!queries.length) queries.push({ location: null, matchedBy: "region" });

    const byId = new Map();
    for (const q of queries) {
        try {
            const rows = await fetchCatalogPage({
                kind,
                region,
                location: q.location,
                area,
                land
            });
            for (const row of rows) {
                const item = { ...row, matchedBy: q.matchedBy, region, kind };
                const prev = byId.get(item.id);
                if (!prev) {
                    byId.set(item.id, item);
                    continue;
                }
                // улица важнее города
                const rank = { street: 3, address: 2, region: 1, analog: 4 };
                if ((rank[item.matchedBy] || 0) > (rank[prev.matchedBy] || 0)) {
                    byId.set(item.id, item);
                }
            }
        } catch (e) {
            // собираем ошибки снаружи
            throw e;
        }
    }

    let listings = [...byId.values()];

    // если искали и город, и улицу — оставляем объявления на улице (предпочтительно в том же городе)
    if (city && streetToken) {
        const onStreet = listings.filter((l) => listingMatchesStreet(l, streetToken));
        if (onStreet.length) {
            const inCity = onStreet.filter((l) =>
                (l.address || "").toLowerCase().includes(city.toLowerCase())
            );
            listings = (inCity.length ? inCity : onStreet).map((l) =>
                l.matchedBy === "street" ? l : { ...l, matchedBy: "street" }
            );
        }
    }

    return { listings, meta: { kind, region, city, street: streetToken } };
}

function parseDistanceKm(distance) {
    if (distance == null) return null;
    if (typeof distance === "number" && Number.isFinite(distance)) return distance;
    const m = String(distance).replace(",", ".").match(/([\d.]+)\s*км/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

/**
 * Радиус выдачи: ≤30 км; если таких меньше 3 — расширяем до 50 км.
 * Без дистанции оставляем только город/улицу (не «весь регион»).
 */
export function filterListingsByDistance(listings, { nearKm = 30, farKm = 50, minCount = 3 } = {}) {
    const tagged = listings.map((l) => ({
        ...l,
        distanceKm: l.distanceKm ?? parseDistanceKm(l.distance)
    }));

    const withKm = tagged.filter((l) => l.distanceKm != null);
    const withoutKm = tagged.filter(
        (l) => l.distanceKm == null && (l.matchedBy === "street" || l.matchedBy === "address")
    );

    let kept = withKm.filter((l) => l.distanceKm <= nearKm);
    let radiusKm = nearKm;
    if (kept.length < minCount) {
        kept = withKm.filter((l) => l.distanceKm <= farKm);
        radiusKm = farKm;
    }

    kept.sort((a, b) => a.distanceKm - b.distanceKm);
    return {
        listings: [...kept, ...withoutKm],
        radiusKm,
        nearCount: withKm.filter((l) => l.distanceKm <= nearKm).length
    };
}

/**
 * Поиск на bazacoop.ru:
 * 1) тип (земля/коммерция) и регион из КН/НСПД
 * 2) каталог по городу и улице
 * 3) аналоги по КН
 * 4) радиус ≤30 км (если <3 — до 50 км)
 */
export async function searchBazacoop({
    cadastralNumber,
    address,
    objectType,
    category,
    area
}) {
    const errors = [];
    const byId = new Map();

    try {
        const byAddr = await searchByAddress({
            cadastralNumber,
            address,
            objectType,
            category,
            area
        });
        for (const item of byAddr.listings) byId.set(item.id, item);
    } catch (e) {
        errors.push(e.message || String(e));
    }

    try {
        const byCad = await searchByCadastral(cadastralNumber);
        for (const item of byCad.listings) {
            const prev = byId.get(item.id);
            if (!prev || item.matchedBy === "analog") byId.set(item.id, item);
        }
        if (!byCad.listings.length && byCad.notice && !byId.size) {
            errors.push(byCad.notice);
        }
    } catch (e) {
        errors.push(e.message || String(e));
    }

    const filtered = filterListingsByDistance([...byId.values()]);
    let listings = filtered.listings;
    try {
        listings = await enrichListingsWithSourceUrls(listings, { limit: 30, concurrency: 8 });
    } catch (e) {
        errors.push(e.message || String(e));
    }

    return {
        listings,
        errors: [...new Set(errors)],
        meta: { radiusKm: filtered.radiusKm, nearCount: filtered.nearCount }
    };
}

/** ponytail: runnable self-check — node lib/listings/bazacoop.mjs */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    console.assert(detectListingKind({ objectType: "Земельный участок" }) === "land");
    console.assert(detectListingKind({ objectType: "Здание", category: "ОКС" }) === "commercial");
    console.assert(regionFromCadastral("76:17:010101:15") === "Ярославская область");
    console.assert(regionFromCadastral("77:07:0015009:12") === "Москва");

    const f30 = filterListingsByDistance([
        { id: "1", distance: "10 км", matchedBy: "analog" },
        { id: "2", distance: "25 км", matchedBy: "analog" },
        { id: "3", distance: "40 км", matchedBy: "analog" },
        { id: "4", distance: "80 км", matchedBy: "analog" }
    ]);
    console.assert(f30.radiusKm === 50 && f30.listings.length === 3, "expand to 50 when <3 within 30");

    const f50 = filterListingsByDistance([
        { id: "1", distance: "5 км", matchedBy: "analog" },
        { id: "2", distance: "12 км", matchedBy: "analog" },
        { id: "3", distance: "28 км", matchedBy: "analog" },
        { id: "4", distance: "45 км", matchedBy: "analog" }
    ]);
    console.assert(f50.radiusKm === 30 && f50.listings.length === 3, "keep 30 when enough");

    console.log("bazacoop self-check ok");
}
