import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { httpsFetch, httpsFetchBuffer, BROWSER_HEADERS } from "./https-fetch.mjs";
import { parseAddressParts } from "./cadastral-lookup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache", "place-photos");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// ponytail: публичный ключ веб-клиента 2ГИС для api.photo; catalog API без своего ключа недоступен
const PHOTO_API_KEY = process.env.DGIS_PHOTO_KEY?.trim() || "gYu1s9N1wP";
const MOBILE_UA = "2GIS/6.0.0 (iPhone; iOS 17.0)";
const CACHE_VERSION = "v5-photos-local";

const CITY_SLUG_BY_REGION = {
    77: "moscow",
    50: "moscow",
    78: "spb",
    47: "spb"
};

function cacheKey(cadastralNumber, suffix) {
    const hash = crypto
        .createHash("sha256")
        .update(`${CACHE_VERSION}:dgis:${cadastralNumber}`)
        .digest("hex")
        .slice(0, 24);
    return `${hash}${suffix}`;
}

function readCachedFile(basename) {
    const file = path.join(CACHE_DIR, basename);
    if (!fs.existsSync(file)) return null;
    if (Date.now() - fs.statSync(file).mtimeMs > CACHE_TTL_MS) return null;
    return file;
}

function getDgisCitySlug(cadastralNumber, address) {
    const code = Number(String(cadastralNumber || "").split(":")[0]);
    if (CITY_SLUG_BY_REGION[code]) return CITY_SLUG_BY_REGION[code];

    const { city } = parseAddressParts(address || "");
    if (/москва/i.test(city || "")) return "moscow";
    if (/петербург/i.test(city || address || "")) return "spb";
    return "moscow";
}

function buildDgisGeoUrl(citySlug, lat, lon, objectId = null) {
    const ll = `${lon},${lat}`;
    if (objectId) {
        return `https://2gis.ru/${citySlug}/geo/${objectId}/${encodeURIComponent(ll)}?m=${encodeURIComponent(ll)}/17`;
    }
    return `https://2gis.ru/${citySlug}/geo/${encodeURIComponent(ll)}?m=${encodeURIComponent(ll)}/17`;
}

function buildDgisSearchUrl(citySlug, query) {
    return `https://2gis.ru/${citySlug}/search/${encodeURIComponent(query)}`;
}

function buildDgisStaticMapUrl(lat, lon) {
    return `https://static.maps.2gis.com/1.0?s=650x400&c=${lat},${lon}&z=17&pt=${lat},${lon}`;
}

async function downloadToCache(url, cacheBasename) {
    const res = await httpsFetchBuffer(url, { headers: BROWSER_HEADERS, timeoutMs: 15000 });
    if (!res.ok) return null;

    const contentType = res.headers?.["content-type"] || "image/jpeg";
    const buffer = res.buffer;
    if (!buffer || buffer.length < 1000) return null;

    const ext = contentType.includes("png") ? ".png" : ".jpg";
    const filename = cacheBasename.endsWith(ext)
        ? cacheBasename
        : `${cacheBasename.replace(/\.[^.]+$/, "")}${ext}`;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, filename), buffer);
    return { filename, contentType };
}

/** ponytail: мобильный UA + m=lon,lat/z даёт локальный geo id; без m — слишком крупный adm_div */
async function resolveDgisObjectId(citySlug, lat, lon) {
    const url = `https://2gis.ru/${citySlug}/geo/${lon},${lat}?m=${lon},${lat}/17`;
    const res = await httpsFetch(url, {
        headers: {
            ...BROWSER_HEADERS,
            "User-Agent": MOBILE_UA,
            Accept: "text/html"
        },
        timeoutMs: 12000
    });
    const loc = res.headers?.location || "";
    const fromLoc = (loc.match(/\/geo\/(\d{10,})\//) || [])[1];
    if (fromLoc) return fromLoc;

    const body = await res.text();
    return (body.match(/\/geo\/(\d{10,})\//) || [])[1] || null;
}

async function fetchObjectPhotoUrls(objectId) {
    const params = new URLSearchParams({
        key: PHOTO_API_KEY,
        page_size: "10",
        locale: "ru_RU",
        preview_size: "656x340,328x170"
    });
    const url = `https://api.photo.2gis.com/3.0/objects/${objectId}/albums/all/media?${params}`;
    const res = await httpsFetch(url, {
        headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: "https://2gis.ru/" },
        timeoutMs: 12000
    });
    const json = await res.json();
    if (!Array.isArray(json?.items)) return [];

    const urls = [];
    for (const item of json.items) {
        const photo = item?.photo;
        if (!photo) continue;
        const best =
            photo.preview_urls?.["656x340"] ||
            photo.url ||
            photo.preview_urls?.["328x170"] ||
            null;
        if (best) urls.push(best);
    }
    return [...new Set(urls)];
}

/**
 * Фото объекта из 2ГИС (api.photo) по координатам; запасной вариант — статичная карта.
 */
export async function fetchDgisPlacePhoto({ cadastralNumber, address, lat, lon }) {
    if (!cadastralNumber) return null;

    const citySlug = getDgisCitySlug(cadastralNumber, address);
    let pageUrl =
        Number.isFinite(lat) && Number.isFinite(lon)
            ? buildDgisGeoUrl(citySlug, lat, lon)
            : buildDgisSearchUrl(citySlug, address || cadastralNumber);

    for (const ext of [".jpg", ".png"]) {
        const cached = readCachedFile(cacheKey(cadastralNumber, ext));
        if (cached) {
            const kind = path.extname(cached).toLowerCase();
            return {
                imageUrl: `/api/cadastral/photo/${path.basename(cached)}`,
                imageSource: kind === ".jpg" || kind === ".jpeg" ? "2gis-photo" : "2gis-map",
                pageUrl,
                cached: true
            };
        }
    }

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        try {
            const objectId = await resolveDgisObjectId(citySlug, lat, lon);
            if (objectId) {
                pageUrl = buildDgisGeoUrl(citySlug, lat, lon, objectId);
                const photoUrls = await fetchObjectPhotoUrls(objectId);
                for (const photoUrl of photoUrls.slice(0, 3)) {
                    const saved = await downloadToCache(photoUrl, cacheKey(cadastralNumber, ".jpg"));
                    if (saved) {
                        return {
                            imageUrl: `/api/cadastral/photo/${saved.filename}`,
                            imageSource: "2gis-photo",
                            pageUrl,
                            title: address || null,
                            objectId,
                            cached: false
                        };
                    }
                }
            }
        } catch {
            /* ниже — статичная карта */
        }

        const saved = await downloadToCache(
            buildDgisStaticMapUrl(lat, lon),
            cacheKey(cadastralNumber, ".png")
        );
        if (saved) {
            return {
                imageUrl: `/api/cadastral/photo/${saved.filename}`,
                imageSource: "2gis-map",
                pageUrl,
                title: address || null,
                cached: false
            };
        }
    }

    return null;
}

export function getPlacePhotoCachePath(filename) {
    if (!/^[a-f0-9]{24}\.(png|jpg|jpeg)$/i.test(filename)) return null;
    const file = path.join(CACHE_DIR, filename);
    if (!fs.existsSync(file)) return null;
    return file;
}

/** ponytail: runnable self-check — node lib/dgis-photos.mjs */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const id = await resolveDgisObjectId("moscow", 55.638976, 37.379372);
    console.assert(/^\d{10,}$/.test(id || ""), `resolve id: ${id}`);
    const urls = await fetchObjectPhotoUrls(id);
    console.assert(urls.length > 0, "photos for resolved object");
    console.log("dgis-photos self-check ok", id, urls[0]);
}
