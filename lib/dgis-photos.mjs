import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { httpsFetch, httpsFetchBuffer, BROWSER_HEADERS } from "./https-fetch.mjs";
import { parseAddressParts } from "./cadastral-lookup.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache", "place-photos");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_API = "https://catalog.api.2gis.com/3.0";
// ponytail: Playwright на 2gis.ru ловит /museum («обновите браузер») — static map без ключа
const CACHE_VERSION = "v3-static";

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

function buildDgisGeoUrl(citySlug, lat, lon) {
    const ll = `${lon},${lat}`;
    return `https://2gis.ru/${citySlug}/geo/${encodeURIComponent(ll)}?m=${encodeURIComponent(ll)}/17`;
}

function buildDgisSearchUrl(citySlug, query) {
    return `https://2gis.ru/${citySlug}/search/${encodeURIComponent(query)}`;
}

function buildDgisStaticMapUrl(lat, lon) {
    return `https://static.maps.2gis.com/1.0?s=650x400&c=${lat},${lon}&z=17&pt=${lat},${lon}`;
}

function getDgisApiKey() {
    return process.env.DGIS_API_KEY?.trim() || "demo";
}

function extractPhotoUrls(item) {
    const urls = [];
    const external = item?.external_content;
    if (Array.isArray(external)) {
        for (const entry of external) {
            if (entry?.main_photo_url) urls.push(entry.main_photo_url);
            if (Array.isArray(entry?.photos)) {
                for (const photo of entry.photos) {
                    if (typeof photo === "string" && photo.startsWith("http")) urls.push(photo);
                    if (photo?.url) urls.push(photo.url);
                }
            }
        }
    }
    const media = item?.media;
    if (Array.isArray(media)) {
        for (const entry of media) {
            if (typeof entry === "string" && entry.startsWith("http")) urls.push(entry);
            if (entry?.url) urls.push(entry.url);
            if (entry?.src) urls.push(entry.src);
        }
    } else if (media && typeof media === "object") {
        for (const value of Object.values(media)) {
            if (typeof value === "string" && value.startsWith("http")) urls.push(value);
            if (Array.isArray(value)) {
                for (const v of value) {
                    if (typeof v === "string" && v.startsWith("http")) urls.push(v);
                    if (v?.url) urls.push(v.url);
                }
            }
        }
    }
    if (item?.photo_url) urls.push(item.photo_url);
    return [...new Set(urls.filter((u) => /2gis|disk\.|photo/i.test(u)))];
}

function pickBestItem(items, lat, lon) {
    if (!items?.length) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return items.find((i) => extractPhotoUrls(i).length) || items[0];
    }

    return [...items]
        .map((item) => {
            const point = item?.point || item?.geometry?.centroid;
            let dist = 9999;
            if (point && typeof point === "string") {
                const m = point.match(/([\d.]+)\s+([\d.]+)/);
                if (m) {
                    const dLon = Number(m[1]) - lon;
                    const dLat = Number(m[2]) - lat;
                    dist = Math.hypot(dLon, dLat);
                }
            } else if (point?.lat != null && point?.lon != null) {
                dist = Math.hypot(point.lon - lon, point.lat - lat);
            }
            return { item, dist, photos: extractPhotoUrls(item).length };
        })
        .sort((a, b) => {
            if (a.photos !== b.photos) return b.photos - a.photos;
            return a.dist - b.dist;
        })[0]?.item;
}

async function fetchItemById(apiKey, itemId) {
    if (!itemId) return null;
    const params = new URLSearchParams();
    params.set("key", apiKey);
    params.set("id", itemId);
    params.set(
        "fields",
        "items.id,items.name,items.full_name,items.address_name,items.point,items.type,items.media,items.external_content,items.links"
    );
    const url = `${CATALOG_API}/items/byid?${params.toString()}`;
    const res = await httpsFetch(url, { headers: BROWSER_HEADERS });
    const json = await res.json();
    if (json?.meta?.code !== 200) return null;
    return json?.result?.items?.[0] || null;
}

async function searchDgisCatalog({ apiKey, address, lat, lon }) {
    const params = new URLSearchParams();
    params.set("key", apiKey);
    params.set("page_size", "5");
    params.set(
        "fields",
        "items.id,items.name,items.full_name,items.address_name,items.point,items.type,items.media,items.external_content,items.links"
    );

    if (address) {
        params.set("q", address.replace(/^Российская Федерация,\s*/i, "").trim());
    }
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        params.set("location", `${lon},${lat}`);
        params.set("radius", "80");
    }
    params.set("type", "building");

    const url = `${CATALOG_API}/items?${params.toString()}`;
    const res = await httpsFetch(url, { headers: BROWSER_HEADERS });
    const json = await res.json();
    if (json?.meta?.code !== 200) {
        return { error: json?.meta?.error?.message || `2ГИС API HTTP ${res.status}` };
    }
    let item = pickBestItem(json?.result?.items, lat, lon);
    if (item && !extractPhotoUrls(item).length && item.id) {
        const detailed = await fetchItemById(apiKey, item.id);
        if (detailed) item = detailed;
    }
    return { item };
}

async function geocodeDgisCatalog({ apiKey, lat, lon }) {
    const params = new URLSearchParams();
    params.set("key", apiKey);
    params.set("lat", String(lat));
    params.set("lon", String(lon));
    params.set(
        "fields",
        "items.id,items.name,items.address_name,items.point,items.type,items.media,items.external_content,items.links"
    );

    const url = `${CATALOG_API}/items/geocode?${params.toString()}`;
    const res = await httpsFetch(url, { headers: BROWSER_HEADERS });
    const json = await res.json();
    if (json?.meta?.code !== 200) return null;
    return pickBestItem(json?.result?.items, lat, lon);
}

async function downloadPhotoToCache(url, cacheBasename) {
    const res = await httpsFetchBuffer(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;

    const contentType = res.headers?.["content-type"] || "image/jpeg";
    const buffer = res.buffer;
    if (!buffer || buffer.length < 1000) return null;

    const ext = contentType.includes("png") ? ".png" : ".jpg";
    const filename = cacheBasename.endsWith(ext) ? cacheBasename : `${cacheBasename.replace(/\.[^.]+$/, "")}${ext}`;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, filename);
    fs.writeFileSync(file, buffer);
    return { file, filename, contentType };
}

async function fetchDgisStaticMap({ lat, lon, cadastralNumber }) {
    const url = buildDgisStaticMapUrl(lat, lon);
    const saved = await downloadPhotoToCache(url, cacheKey(cadastralNumber, ".png"));
    return saved;
}

/**
 * Фото здания (Catalog API) или статичная карта 2ГИС по координатам.
 * @returns {Promise<{ imageUrl: string, imageSource: string, pageUrl: string, title?: string, cached?: boolean } | null>}
 */
export async function fetchDgisPlacePhoto({ cadastralNumber, address, lat, lon }) {
    if (!cadastralNumber) return null;

    const citySlug = getDgisCitySlug(cadastralNumber, address);
    const pageUrl =
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
        const apiKeys = [...new Set([getDgisApiKey(), "demo"].filter(Boolean))];
        let item = null;

        for (const apiKey of apiKeys) {
            let catalog = await searchDgisCatalog({ apiKey, address, lat, lon });
            if (catalog.error && apiKey !== "demo") continue;
            item = catalog.item;
            if (!item) {
                item = await geocodeDgisCatalog({ apiKey, lat, lon });
            }
            if (item && !extractPhotoUrls(item).length && item.id) {
                const detailed = await fetchItemById(apiKey, item.id);
                if (detailed) item = detailed;
            }
            if (extractPhotoUrls(item).length) break;
        }

        const photoUrls = extractPhotoUrls(item);
        if (photoUrls.length) {
            const saved = await downloadPhotoToCache(photoUrls[0], cacheKey(cadastralNumber, ".jpg"));
            if (saved) {
                return {
                    imageUrl: `/api/cadastral/photo/${saved.filename}`,
                    imageSource: "2gis-photo",
                    pageUrl: item?.links?.entity?.[0]?.href || pageUrl,
                    title: item?.name || item?.address_name || item?.full_name || null,
                    cached: false
                };
            }
        }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const saved = await fetchDgisStaticMap({ lat, lon, cadastralNumber });
    if (!saved) return null;

    return {
        imageUrl: `/api/cadastral/photo/${saved.filename}`,
        imageSource: "2gis-map",
        pageUrl,
        title: address || null,
        cached: false
    };
}

export function getPlacePhotoCachePath(filename) {
    if (!/^[a-f0-9]{24}\.(png|jpg|jpeg)$/i.test(filename)) return null;
    const file = path.join(CACHE_DIR, filename);
    if (!fs.existsSync(file)) return null;
    return file;
}

/** ponytail: runnable self-check — node lib/dgis-photos.mjs */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const url = buildDgisStaticMapUrl(55.638976, 37.379372);
    console.assert(/static\.maps\.2gis\.com/.test(url), "static map url");
    console.assert(cacheKey("77:07:0015009:12", ".png") !== cacheKey("x", ".png"), "cache keys differ");
    console.log("dgis-photos self-check ok");
}
