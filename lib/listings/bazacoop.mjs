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

function isLandObject(objectType, category) {
    const blob = `${objectType || ""} ${category || ""}`.toLowerCase();
    return /земел|участ|land|parcel/i.test(blob) || !blob.trim();
}

function regionFromAddress(address) {
    if (!address) return null;
    const obl = address.match(/([А-Яа-яЁё-]+)\s+обл(?:асть|\.)?/i);
    if (obl) return `${obl[1]} область`;
    const krai = address.match(/([А-Яа-яЁё-]+)\s+край/i);
    if (krai) return `${krai[1]} край`;
    const resp = address.match(/респ(?:ублика|\.)?\s+([А-Яа-яЁё\s-]+)/i);
    if (resp) return resp[1].trim();
    if (/Москва/i.test(address)) return "Москва";
    if (/Санкт-Петербург|Петербург/i.test(address)) return "Санкт-Петербург";
    return null;
}

function regionForSearch(cadastralNumber, address) {
    const fromAddr = regionFromAddress(address);
    if (fromAddr && REGION_BY_CODE[Number(cadastralNumber?.split(":")[0])]) {
        // предпочитаем каноническое имя из справочника, если код совпал
        const code = Number(cadastralNumber.split(":")[0]);
        const byCode = REGION_BY_CODE[code];
        if (byCode && fromAddr.toLowerCase().includes(byCode.split(" ")[0].toLowerCase())) {
            return byCode;
        }
        return byCode || fromAddr;
    }
    const code = Number(String(cadastralNumber || "").split(":")[0]);
    return REGION_BY_CODE[code] || fromAddr;
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
            matchedBy,
            area: areaText,
            distance,
            suitable
        });
    }

    return listings;
}

async function fetchHtml(url, options = {}) {
    const res = await httpsFetch(url, {
        timeoutMs: TIMEOUT_MS,
        headers: {
            ...BROWSER_HEADERS,
            Accept: "text/html,application/xhtml+xml",
            ...(options.headers || {})
        },
        ...options
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

async function searchCatalog({ cadastralNumber, address, objectType, category, area }) {
    const land = isLandObject(objectType, category);
    const path = land ? "/re/zemelnye-uchastki" : "/re/kommercheskaya-nedvizhimost";
    const region = regionForSearch(cadastralNumber, address);
    const { city } = parseAddressParts(address);
    const params = new URLSearchParams({
        sort_by: "parsed_at",
        sort_order: "desc",
        ...(region ? { region } : {}),
        ...(city ? { location: city } : {}),
        ...Object.fromEntries(
            Object.entries(areaRange(area, land)).map(([k, v]) => [k, String(v)])
        )
    });
    if (land) params.set("suitability_status", "suitable");

    const url = `${BASE}${path}?${params}`;
    const { res, html } = await fetchHtml(url, {
        headers: { Referer: `${BASE}/re` }
    });
    if (!res.ok) {
        throw new Error(`БазаЦООП каталог HTTP ${res.status}`);
    }
    return parseAdsTable(html, "region");
}

/**
 * Поиск объявлений на bazacoop.ru: сначала аналоги по КН, иначе каталог по региону/городу.
 */
export async function searchBazacoop({
    cadastralNumber,
    address,
    objectType,
    category,
    area
}) {
    const errors = [];
    let listings = [];

    try {
        const byCad = await searchByCadastral(cadastralNumber);
        listings = byCad.listings;
        if (!listings.length && byCad.notice) {
            errors.push(byCad.notice);
        }
    } catch (e) {
        errors.push(e.message || String(e));
    }

    if (!listings.length) {
        try {
            listings = await searchCatalog({
                cadastralNumber,
                address,
                objectType,
                category,
                area
            });
        } catch (e) {
            errors.push(e.message || String(e));
        }
    }

    return { listings, errors: [...new Set(errors)] };
}
