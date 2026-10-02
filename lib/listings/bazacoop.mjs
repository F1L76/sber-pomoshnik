import { fileURLToPath } from "url";
import { httpsFetchFollow, BROWSER_HEADERS } from "../https-fetch.mjs";
import { formatPrice, parsePriceText } from "../listing-utils.mjs";
import { parseAddressParts } from "../cadastral-lookup.mjs";
import { RF_REGIONS as REGION_BY_CODE } from "../rf-regions.mjs";

const BASE = "https://bazacoop.ru";
const TIMEOUT_MS = 18_000;
const AUTH_HINT =
    "БазаЦООП теперь требует вход — задайте BAZACOOP_USERNAME и BAZACOOP_PASSWORD (или BAZACOOP_COOKIE) в .env";

export function isBazacoopLoginWall(res, html = "") {
    const loc = String(res?.headers?.location || res?.finalUrl || "");
    if (/\/login(?:\?|$)/i.test(loc)) return true;
    if (res?.status === 401) return true;
    const body = String(html || "");
    return /Вход — БазаЦООП|login-form|Учётные записи создаёт администратор/i.test(body);
}

function authError(message = AUTH_HINT) {
    const err = new Error(message);
    err.code = "BAZACOOP_AUTH";
    return err;
}

function applyCookieHeader(cookieJar, header) {
    for (const part of String(header || "").split(";")) {
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        cookieJar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
}

/** Сессия: cookie из env или логин/пароль. Без учётки сайт отдаёт /login. */
async function ensureBazacoopSession(cookieJar) {
    const cookie = String(process.env.BAZACOOP_COOKIE || "").trim();
    if (cookie) {
        applyCookieHeader(cookieJar, cookie);
        return "cookie";
    }

    const username = String(
        process.env.BAZACOOP_USERNAME || process.env.BAZACOOP_USER || ""
    ).trim();
    const password = String(
        process.env.BAZACOOP_PASSWORD || process.env.BAZACOOP_PASS || ""
    ).trim();
    if (!username || !password) return "anonymous";

    const body = new URLSearchParams({
        username,
        password,
        next: "/"
    }).toString();
    const res = await httpsFetchFollow(`${BASE}/login`, {
        method: "POST",
        timeoutMs: TIMEOUT_MS,
        cookieJar,
        headers: {
            ...BROWSER_HEADERS,
            Accept: "text/html,application/xhtml+xml",
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: BASE,
            Referer: `${BASE}/login`
        },
        body
    });
    const html = await res.text();
    if (isBazacoopLoginWall(res, html) || !cookieJar.size) {
        throw authError("БазаЦООП: не удалось войти — проверьте логин и пароль");
    }
    return "password";
}

function normalizePhotoUrl(src) {
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith("//")) return `https:${src}`;
    if (src.startsWith("/")) return `${BASE}${src}`;
    return `${BASE}/${src}`;
}

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

async function fetchSourceListingUrl(bazacoopAdUrl, cookieJar) {
    try {
        const { res, html } = await fetchHtml(bazacoopAdUrl, {
            cookieJar,
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
async function enrichListingsWithSourceUrls(listings, { limit = 25, concurrency = 6, cookieJar } = {}) {
    const targets = listings.slice(0, limit);
    let i = 0;

    async function worker() {
        while (i < targets.length) {
            const idx = i++;
            const item = targets[idx];
            const sourceUrl = await fetchSourceListingUrl(item.bazacoopUrl || item.url, cookieJar);
            if (sourceUrl) {
                item.url = sourceUrl;
                item.sourceUrl = sourceUrl;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
    return listings;
}

function enrichWithDeadline(listings, deadlineMs, cookieJar) {
    if (!deadlineMs || deadlineMs <= 0 || !listings.length) {
        return Promise.resolve({ listings, completed: true });
    }
    let timer;
    return Promise.race([
        enrichListingsWithSourceUrls(listings, { limit: 20, concurrency: 6, cookieJar })
            .then((rows) => ({ listings: rows, completed: true }))
            .finally(() => clearTimeout(timer)),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve({ listings, completed: false }), deadlineMs);
        })
    ]);
}

async function fetchHtml(url, options = {}) {
    const { headers: extraHeaders, timeoutMs, cookieJar, ...rest } = options;
    const res = await httpsFetchFollow(url, {
        timeoutMs: timeoutMs || TIMEOUT_MS,
        cookieJar,
        headers: {
            ...BROWSER_HEADERS,
            Accept: "text/html,application/xhtml+xml",
            ...(extraHeaders || {})
        },
        ...rest
    });
    const html = await res.text();
    if (isBazacoopLoginWall(res, html)) throw authError();
    return { res, html };
}

async function searchByCadastral(cadastralNumber, cookieJar) {
    const body = new URLSearchParams({ cadastral_number: cadastralNumber }).toString();
    const { res, html } = await fetchHtml(`${BASE}/cadastral`, {
        method: "POST",
        cookieJar,
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

async function fetchCatalogPage({ kind, region, location, area, land, cookieJar }) {
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
    const { res, html } = await fetchHtml(url, {
        cookieJar,
        headers: { Referer: `${BASE}/re` }
    });
    if (!res.ok) throw new Error(`БазаЦООП каталог HTTP ${res.status}`);
    return parseAdsTable(html, location ? "address" : "region");
}

/**
 * Регион из КН → каталог земли/коммерции → location=город, затем улица.
 */
async function searchByAddress({ cadastralNumber, address, objectType, category, area, cookieJar }) {
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
                land,
                cookieJar
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
 * Радиус выдачи: ≤30 км → если <3, до 50 км → если всё ещё <3, до 100 км.
 * Без дистанции оставляем только город/улицу (не «весь регион»).
 */
export function filterListingsByDistance(
    listings,
    { nearKm = 30, midKm = 50, farKm = 100, minCount = 3 } = {}
) {
    const tagged = listings.map((l) => ({
        ...l,
        distanceKm: l.distanceKm ?? parseDistanceKm(l.distance)
    }));

    const withKm = tagged.filter((l) => l.distanceKm != null);
    const withoutKm = tagged.filter(
        (l) => l.distanceKm == null && (l.matchedBy === "street" || l.matchedBy === "address")
    );

    const steps = [nearKm, midKm, farKm];
    let kept = [];
    let radiusKm = nearKm;
    for (const km of steps) {
        kept = withKm.filter((l) => l.distanceKm <= km);
        radiusKm = km;
        if (kept.length >= minCount) break;
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
 * 4) радиус ≤30 км → при нехватке 50 км → затем 100 км
 */
export async function searchBazacoop({
    cadastralNumber,
    address,
    objectType,
    category,
    area,
    enrichDeadlineMs = 12_000
}) {
    const errors = [];
    const byId = new Map();
    const cookieJar = new Map();
    const authFail = (message) => ({
        listings: [],
        errors: [],
        unavailable: {
            source: "bazacoop",
            reason: "auth",
            message: message || AUTH_HINT
        },
        meta: { radiusKm: null, nearCount: 0, enrichmentCompleted: true }
    });

    try {
        await ensureBazacoopSession(cookieJar);
    } catch (e) {
        if (e?.code === "BAZACOOP_AUTH") return authFail(e.message);
        throw e;
    }

    try {
        const byAddr = await searchByAddress({
            cadastralNumber,
            address,
            objectType,
            category,
            area,
            cookieJar
        });
        for (const item of byAddr.listings) byId.set(item.id, item);
    } catch (e) {
        if (e?.code === "BAZACOOP_AUTH") return authFail(e.message);
        errors.push(e.message || String(e));
    }

    try {
        const byCad = await searchByCadastral(cadastralNumber, cookieJar);
        for (const item of byCad.listings) {
            const prev = byId.get(item.id);
            if (!prev || item.matchedBy === "analog") byId.set(item.id, item);
        }
        if (!byCad.listings.length && byCad.notice && !byId.size) {
            errors.push(byCad.notice);
        }
    } catch (e) {
        if (e?.code === "BAZACOOP_AUTH") return authFail(e.message);
        errors.push(e.message || String(e));
    }

    const filtered = filterListingsByDistance([...byId.values()]);
    let listings = filtered.listings;
    let enrichmentCompleted = true;
    if (listings.length) {
        const enriched = await enrichWithDeadline(listings, enrichDeadlineMs, cookieJar);
        listings = enriched.listings;
        enrichmentCompleted = enriched.completed;
    }

    return {
        listings,
        errors: [...new Set(errors)],
        meta: {
            radiusKm: filtered.radiusKm,
            nearCount: filtered.nearCount,
            enrichmentCompleted
        }
    };
}

/**
 * Точки карты ЗУ с /map: { id, lat, lng, price, area(сот.), region }.
 * Нормализация: pricePerSotka, pricePerSqm; отбрасываем price≤1 и без координат.
 */
export function normalizeMapPoint(raw) {
    const id = raw?.id != null ? String(raw.id) : "";
    const lat = Number(raw?.lat);
    const lng = Number(raw?.lng);
    const price = Number(raw?.price);
    const area = Number(raw?.area);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!Number.isFinite(price) || price <= 1) return null;
    if (!Number.isFinite(area) || area <= 0) return null;
    const pricePerSotka = Math.round(price / area);
    const pricePerSqm = Math.round(price / (area * 100));
    return {
        id,
        lat,
        lng,
        price,
        area,
        region: String(raw?.region || "").trim() || null,
        pricePerSotka,
        pricePerSqm,
        url: `${BASE}/ads/${id}`,
    };
}

function parseMapPointsHtml(html) {
    const byId = html.match(
        /<script[^>]*\bid=["']mapPointsData["'][^>]*>([\s\S]*?)<\/script>/i
    );
    let raw = byId?.[1]?.trim() || "";
    if (!raw) {
        // fallback: большой JSON-массив в inline script
        const inlines = [...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi)];
        for (const m of inlines) {
            const body = String(m[1] || "").trim();
            if (body.startsWith("[") && body.includes('"lat"') && body.includes('"price"')) {
                raw = body;
                break;
            }
        }
    }
    if (!raw) return [];
    let arr;
    try {
        arr = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const row of arr) {
        const p = normalizeMapPoint(row);
        if (p) out.push(p);
    }
    return out;
}

/**
 * Снимок всех точек карты БазаЦООП (ЗУ). Нужен логин в env.
 * @returns {Promise<{ points: object[], unavailable?: object }>}
 */
export async function fetchMapPoints() {
    const cookieJar = new Map();
    try {
        const mode = await ensureBazacoopSession(cookieJar);
        if (mode === "anonymous") {
            return {
                points: [],
                unavailable: { source: "bazacoop", reason: "auth", message: AUTH_HINT },
            };
        }
    } catch (e) {
        if (e?.code === "BAZACOOP_AUTH") {
            return {
                points: [],
                unavailable: {
                    source: "bazacoop",
                    reason: "auth",
                    message: e.message || AUTH_HINT,
                },
            };
        }
        throw e;
    }

    const { res, html } = await fetchHtml(`${BASE}/map`, {
        cookieJar,
        headers: { Referer: `${BASE}/` },
        timeoutMs: 60_000,
    });
    if (!res.ok) throw new Error(`БазаЦООП /map HTTP ${res.status}`);
    const points = parseMapPointsHtml(html);
    return { points };
}

/** ponytail: runnable self-check — node lib/listings/bazacoop.mjs */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    console.assert(detectListingKind({ objectType: "Земельный участок" }) === "land");
    console.assert(detectListingKind({ objectType: "Здание", category: "ОКС" }) === "commercial");
    console.assert(regionFromCadastral("76:17:010101:15") === "Ярославская область");
    console.assert(regionFromCadastral("04:01:010101:1") === "Алтай");
    console.assert(regionFromCadastral("77:07:0015009:12") === "Москва");

    console.assert(
        isBazacoopLoginWall(
            { status: 303, headers: { location: "/login?next=%2Fcadastral" } },
            ""
        ),
        "303 to /login is auth wall"
    );
    console.assert(
        isBazacoopLoginWall(
            { status: 200, finalUrl: "https://bazacoop.ru/login" },
            "<title>Вход — БазаЦООП</title><form class=\"login-form\">"
        ),
        "login HTML is auth wall"
    );
    console.assert(
        !isBazacoopLoginWall(
            { status: 200, finalUrl: "https://bazacoop.ru/re/zemelnye-uchastki" },
            '<tr class="ads-table__row"><td>ok</td></tr>'
        ),
        "catalog HTML is not auth wall"
    );

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

    const f100 = filterListingsByDistance([
        { id: "1", distance: "28 км", matchedBy: "analog" },
        { id: "2", distance: "29 км", matchedBy: "analog" },
        { id: "3", distance: "51 км", matchedBy: "analog" },
        { id: "4", distance: "80 км", matchedBy: "analog" }
    ]);
    console.assert(f100.radiusKm === 100 && f100.listings.length === 4, "expand to 100 when <3 within 50");

    const live = await searchBazacoop({
        cadastralNumber: "76:17:010101:15",
        address: "Ярославская область, г. Ярославль",
        objectType: "Земельный участок",
        area: 1000
    });
    if (!process.env.BAZACOOP_USERNAME && !process.env.BAZACOOP_COOKIE) {
        console.assert(live.unavailable?.reason === "auth", "anonymous live search → auth soft-fail");
    }

    console.assert(normalizeMapPoint({ id: 1, lat: 1, lng: 2, price: 100000, area: 10 })?.pricePerSotka === 10000);
    console.assert(normalizeMapPoint({ id: 1, lat: 1, lng: 2, price: 1, area: 10 }) == null, "price≤1 dropped");

    console.log("bazacoop self-check ok");
}
