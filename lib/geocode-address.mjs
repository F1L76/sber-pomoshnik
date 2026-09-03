import { httpsFetch } from "./https-fetch.mjs";
import { lookupKadbaseObject } from "./kadbase-lookup.mjs";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const YANDEX_GEOCODE_URL = "https://geocode-maps.yandex.ru/1.x/";
const TIMEOUT_MS = 8_000;
const NOMINATIM_GAP_MS = 1_100;

/** ponytail: та же чистка, что для Яндекс-панорамы — короче запрос, лучше попадание */
function shortenForGeocode(address) {
    return String(address || "")
        .replace(/^Почтовый адрес ориентира:\s*/i, "")
        .replace(/^Российская Федерация,\s*/i, "")
        .replace(/^[А-Яа-яЁё\s-]+\s+область,\s*/i, "")
        .replace(/вн\.?тер\.?г\.\s*муниципальный округ\s+[^,]+,\s*/i, "")
        .replace(/,\s*земельный участок\s+/i, ", ")
        .replace(/,\s*д\.\s*/i, ", ")
        .replace(/,\s*улица\s+/i, ", ")
        .replace(/город\s+Москва/i, "Москва")
        .replace(/город\s+Санкт-Петербург/i, "Санкт-Петербург")
        .replace(/^город\s+/i, "")
        .trim();
}

/** Адрес дома без квартиры/помещения — Nominatim так находит чаще. */
export function buildingQueryVariants(address) {
    let s = String(address || "")
        .replace(/^Почтовый адрес ориентира:\s*/i, "")
        .replace(/^Российская Федерация,\s*/gi, "")
        .replace(/вн\.?\s*тер\.?\s*г\.?\s*/gi, "")
        .replace(/муниципальный округ\s+[^,]+,\s*/gi, "")
        .replace(/городской округ\s+[^,]+,\s*/gi, "")
        .replace(/г\.?\s*о\.\s*/gi, "")
        .replace(/муниципальный район\s+[^,]+,\s*/gi, "")
        .replace(/сельское поселение\s+[^,]+,\s*/gi, "")
        .replace(/город\s+Москва/gi, "Москва")
        .replace(/город\s+Санкт-Петербург/gi, "Санкт-Петербург")
        .replace(/(^|,\s*)г\.\s*/gi, "$1")
        .replace(/,\s*(помещение|кв\.?|квартира|машино-?место|комната|офис|этаж)\s+[^,]*/gi, "")
        .replace(/,\s*земельный участок\s+/gi, ", ")
        .replace(/переулок\s+/gi, "пер. ")
        .replace(/пер\.\s*/gi, "пер. ")
        .replace(/улица\s+/gi, "ул. ")
        .replace(/ул\.\s*/gi, "ул. ")
        .replace(/проспект\s+/gi, "пр-т ")
        .replace(/пр-?т\.\s*/gi, "пр-т ")
        .replace(/владение\s+/gi, "")
        .replace(/вл\.\s*/gi, "")
        .replace(/дом\s+/gi, "")
        .replace(/(^|,\s*)д\.\s*/gi, "$1")
        .replace(/корпус\s+/gi, "к")
        .replace(/строение\s+/gi, "с")
        .replace(/стр\.\s*/gi, "с")
        .replace(/[;]+/g, ",")
        .replace(/\s+/g, " ")
        .replace(/,\s*,/g, ",")
        .replace(/^[,\s]+|[,\s]+$/g, "")
        .trim();
    if (!s) return [];
    const squeezed = s.replace(/,\s+(?=\d)/g, " ").replace(/,\s+(?=к\d)/gi, " ").replace(/,\s+(?=с\d)/gi, " ");
    const variants = [squeezed, s];
    // город + улица + дом без области/края
    const parts = squeezed.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        const short = parts.slice(-2).join(", ");
        if (short && short !== squeezed) variants.push(short);
        if (parts.length >= 3) {
            const shorter = parts.slice(-3).join(", ");
            if (shorter !== squeezed) variants.push(shorter);
        }
    }
    const noCorp = squeezed.replace(/\s*к\d+\S*/gi, "").replace(/\s*с\d+\S*/gi, "").replace(/,\s*$/g, "").trim();
    if (noCorp && noCorp !== squeezed) variants.push(noCorp);
    return [...new Set(variants.filter(Boolean))];
}

function uniqueQueries(address) {
    const out = [];
    const seen = new Set();
    for (const q of [...buildingQueryVariants(address), shortenForGeocode(address)]) {
        const key = String(q || "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastNominatimAt = 0;
const addressCache = new Map();

function yandexKey() {
    return String(process.env.YANDEX_MAPS_API_KEY || "").trim();
}

async function yandexSearch(query) {
    const key = yandexKey();
    if (!key) return null;
    const params = new URLSearchParams({
        apikey: key,
        geocode: query,
        format: "json",
        results: "1",
        lang: "ru_RU"
    });
    const res = await httpsFetch(`${YANDEX_GEOCODE_URL}?${params}`, {
        headers: { Accept: "application/json" },
        timeoutMs: TIMEOUT_MS
    });
    if (!res.ok) return null;
    const json = await res.json();
    const member = json?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const pos = String(member?.Point?.pos || "").trim().split(/\s+/);
    const lon = Number(pos[0]);
    const lat = Number(pos[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
        lat,
        lon,
        displayName: member?.metaDataProperty?.GeocoderMetaData?.text || query,
        source: "yandex"
    };
}

async function nominatimSearch(query) {
    const wait = NOMINATIM_GAP_MS - (Date.now() - lastNominatimAt);
    if (wait > 0) await sleep(wait);
    lastNominatimAt = Date.now();
    const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "1",
        countrycodes: "ru"
    });
    const res = await httpsFetch(`${NOMINATIM_URL}?${params}`, {
        headers: {
            "User-Agent": "sber-pomoshnik/1.0 (cadastral geocode fallback)",
            Accept: "application/json"
        },
        timeoutMs: TIMEOUT_MS
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const hit = rows?.[0];
    const lat = Number(hit?.lat);
    const lon = Number(hit?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, displayName: hit.display_name || query, source: "osm" };
}

/**
 * Геокод адреса → WGS84. Яндекс (если есть ключ), иначе Nominatim.
 * @returns {{ lat: number, lon: number, displayName?: string, source?: string } | null}
 */
export async function geocodeAddress(address) {
    const cacheKey = String(address || "").trim().toLowerCase();
    if (!cacheKey) return null;
    if (addressCache.has(cacheKey)) return addressCache.get(cacheKey);

    let hit = null;
    for (const query of uniqueQueries(address)) {
        try {
            hit = (await yandexSearch(query)) || (await nominatimSearch(query));
            if (hit) break;
        } catch {
            /* следующий вариант */
        }
    }
    addressCache.set(cacheKey, hit);
    return hit;
}

/** КН нет в НСПД → адрес с kadbase.ru → точка OSM/Яндекс. Приблизительно. */
export async function geocodeCadastralByKadbase(kn) {
    const cadastralNumber = String(kn || "").trim();
    if (!cadastralNumber) return { found: false, message: "пустой номер" };
    let kadbase;
    try {
        kadbase = await lookupKadbaseObject(cadastralNumber, { attempts: 1 });
    } catch (e) {
        return { found: false, cadastralNumber, message: e.message || "kadbase.ru недоступен" };
    }
    if (!kadbase?.found || !kadbase.address) {
        return {
            found: false,
            cadastralNumber,
            message: kadbase?.message || "нет адреса в kadbase.ru"
        };
    }
    const coords = await geocodeAddress(kadbase.address);
    if (!coords) {
        return {
            found: false,
            cadastralNumber,
            address: kadbase.address,
            message: "есть адрес kadbase, геокодер не нашёл точку"
        };
    }
    return {
        found: true,
        cadastralNumber,
        lat: coords.lat,
        lon: coords.lon,
        address: kadbase.address,
        objectType: kadbase.objectType || "",
        source: coords.source === "yandex" ? "yandex" : "kadbase",
        approximate: true
    };
}

/** Адрес уже есть (например сосед по кварталу) → точка геокодера. */
export async function geocodeCadastralByKnownAddress(kn, address, { objectType = "" } = {}) {
    const cadastralNumber = String(kn || "").trim();
    const addr = String(address || "").trim();
    if (!cadastralNumber || !addr) return { found: false, message: "нет адреса" };
    const coords = await geocodeAddress(addr);
    if (!coords) {
        return { found: false, cadastralNumber, address: addr, message: "геокодер не нашёл точку" };
    }
    return {
        found: true,
        cadastralNumber,
        lat: coords.lat,
        lon: coords.lon,
        address: addr,
        objectType,
        source: coords.source === "yandex" ? "yandex" : "addr",
        approximate: true
    };
}

/** Point GeoJSON + метаданные для карты, когда НСПД недоступен. */
export function pointMapFallback(location, { source = "geocode", label } = {}) {
    const lat = Number(location?.lat);
    const lon = Number(location?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
        geometry: { type: "Point", coordinates: [lon, lat] },
        location: { lat, lon },
        source,
        approximate: true,
        label:
            label ||
            "Приблизительная точка по адресу — контур границ участка доступен только через НСПД"
    };
}

if (process.argv[1]?.endsWith("geocode-address.mjs")) {
    const zorge = buildingQueryVariants(
        "Российская Федерация, город Москва, вн.тер.г. муниципальный округ Хорошевский, улица Зорге, дом 9А, корпус 6, помещение 305"
    );
    console.assert(zorge[0]?.includes("Зорге") && zorge[0]?.includes("9А") && !/помещение/i.test(zorge[0]), zorge);
    const r = await geocodeAddress(
        "Российская Федерация, город Москва, улица Большая Серпуховская, земельный участок 58"
    );
    console.assert(r && r.lat > 55 && r.lat < 56 && r.lon > 37 && r.lon < 38, "geocode moscow", r);
    const cached = await geocodeAddress(
        "Российская Федерация, город Москва, улица Большая Серпуховская, земельный участок 58"
    );
    console.assert(cached === r, "address cache");
    console.log("geocode-address ok", r);
}
