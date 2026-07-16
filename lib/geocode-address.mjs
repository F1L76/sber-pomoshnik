import { httpsFetch } from "./https-fetch.mjs";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const TIMEOUT_MS = 6_000;

/** ponytail: та же чистка, что для Яндекс-панорамы — короче запрос, лучше попадание */
function shortenForGeocode(address) {
    return String(address || "")
        .replace(/^Почтовый адрес ориентира:\s*/i, "")
        .replace(/^Российская Федерация,\s*/i, "")
        .replace(/^[А-Яа-яЁё\s-]+\s+область,\s*/i, "")
        .replace(/вн\.?тер\.?г\.\s*муниципальный округ\s+[^,]+,\s*/i, "")
        .replace(/,\s*земельный участок\s+/i, ", ")
        .replace(/,\s*д\.?\s*/i, ", ")
        .replace(/,\s*улица\s+/i, ", ")
        .replace(/город\s+Москва/i, "Москва")
        .replace(/город\s+Санкт-Петербург/i, "Санкт-Петербург")
        .replace(/^город\s+/i, "")
        .trim();
}

/**
 * Геокод адреса → WGS84 (Nominatim). С Render работает; точность ~улица, не контур участка.
 * @returns {{ lat: number, lon: number, displayName?: string } | null}
 */
export async function geocodeAddress(address) {
    const query = shortenForGeocode(address);
    if (!query) return null;

    const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "1",
        countrycodes: "ru"
    });

    try {
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
    } catch {
        return null;
    }
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
    const r = await geocodeAddress(
        "Российская Федерация, город Москва, улица Большая Серпуховская, земельный участок 58"
    );
    console.assert(r && r.lat > 55 && r.lat < 56 && r.lon > 37 && r.lon < 38, "geocode moscow", r);
    console.log("geocode-address ok", r);
}
