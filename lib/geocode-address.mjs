import { httpsFetch } from "./https-fetch.mjs";
import { lookupKadbaseObject } from "./kadbase-lookup.mjs";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const TIMEOUT_MS = 6_000;
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
        .replace(/город\s+Москва/gi, "Москва")
        .replace(/город\s+Санкт-Петербург/gi, "Санкт-Петербург")
        .replace(/\bг\.\s*/gi, "")
        .replace(/,\s*(помещение|кв\.?|квартира|машино-?место|комната|офис|этаж)\s+[^,]*/gi, "")
        .replace(/,\s*земельный участок\s+/gi, ", ")
        .replace(/пер\.\s*/gi, "переулок ")
        .replace(/ул\.\s*/gi, "улица ")
        .replace(/пр-?т\.\s*/gi, "проспект ")
        .replace(/дом\s+/gi, "")
        .replace(/(^|,\s*)д\.\s*/gi, "$1")
        .replace(/корпус\s+/gi, "к")
        .replace(/строение\s+/gi, "с")
        .replace(/стр\.\s*/gi, "с")
        .replace(/\s+/g, " ")
        .replace(/,\s*,/g, ",")
        .replace(/^[,\s]+|[,\s]+$/g, "")
        .trim();
    if (!s) return [];
    // Nominatim лучше ест «Зорге 9А к6», чем «Зорге, 9А, корпус 6»
    const squeezed = s.replace(/,\s+(?=\d)/g, " ").replace(/,\s+(?=к\d)/gi, " ").replace(/,\s+(?=с\d)/gi, " ");
    const variants = [squeezed, s];
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
    return { lat, lon, displayName: hit.display_name || query };
}

/**
 * Геокод адреса → WGS84 (Nominatim). С Render работает; точность ~улица/дом, не контур участка.
 * @returns {{ lat: number, lon: number, displayName?: string } | null}
 */
export async function geocodeAddress(address) {
    for (const query of uniqueQueries(address)) {
        try {
            const hit = await nominatimSearch(query);
            if (hit) return hit;
        } catch {
            /* следующий вариант */
        }
    }
    return null;
}

/** КН нет в НСПД → адрес с kadbase.ru → точка OSM. Приблизительно. */
export async function geocodeCadastralByKadbase(kn) {
    const cadastralNumber = String(kn || "").trim();
    if (!cadastralNumber) return { found: false, message: "пустой номер" };
    let kadbase;
    try {
        kadbase = await lookupKadbaseObject(cadastralNumber);
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
            message: "есть адрес kadbase, OSM не нашёл точку"
        };
    }
    return {
        found: true,
        cadastralNumber,
        lat: coords.lat,
        lon: coords.lon,
        address: kadbase.address,
        objectType: kadbase.objectType || "",
        source: "kadbase",
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
    console.log("geocode-address ok", r);
}
