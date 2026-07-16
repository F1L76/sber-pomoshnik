import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { buildPanoramaInfo } from "./yandex-maps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache", "yandex-panorama");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PANORAMA_CACHE_VERSION = "v4-map-widget";
const MAP_ZOOM = 16;
const PANORAMA_SPAN = "115,75";
// ponytail: полный yandex.ru/maps в headless часто без canvas; widget открывает панораму
const OFFSET_DISTANCES_M = [0, 40, 70];
const OFFSET_BEARINGS_DEG = [0, 90, 180, 270];
const PANO_READY_SELECTOR = ".panorama-player, .map-widget-panorama-player-app, .pano-engine-v2";

function cacheKey(cadastralNumber) {
    return crypto
        .createHash("sha256")
        .update(`${PANORAMA_CACHE_VERSION}:${cadastralNumber}`)
        .digest("hex")
        .slice(0, 24);
}

function cachePath(key) {
    return path.join(CACHE_DIR, `${key}.png`);
}

function readCached(key) {
    const file = cachePath(key);
    if (!fs.existsSync(file)) return null;
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    return file;
}

function shortenAddress(address) {
    if (!address) return "";
    return address
        .replace(/^Почтовый адрес ориентира:\s*/i, "")
        .replace(/^Российская Федерация,\s*/i, "")
        .replace(/^[А-Яа-яЁё\s-]+\s+область,\s*/i, "")
        .replace(/^область\s+[^,]+,\s*/i, "")
        .replace(/^муниципальный округ\s+[^,]+,\s*/i, "")
        .replace(/вн\.?тер\.?г\.\s*муниципальный округ\s+[^,]+,\s*/i, "")
        .replace(/городской округ\s+[^,]+,\s*/i, "")
        .replace(/^г\.?\s+/i, "")
        .replace(/,\s*д\.?\s*/i, ", ")
        .trim();
}

function bearingDeg(lat1, lon1, lat2, lon2) {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180) / Math.PI;
}

function offsetCoordinate(lat, lon, bearingDegValue, distanceM) {
    const R = 6371000;
    const br = (bearingDegValue * Math.PI) / 180;
    const dLat = ((distanceM * Math.cos(br)) / R) * (180 / Math.PI);
    const dLon = ((distanceM * Math.sin(br)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
    return { lat: lat + dLat, lon: lon + dLon };
}

function buildPanoramaWidgetUrl(lat, lon, { lookAtLat, lookAtLon } = {}) {
    const point = `${lon},${lat}`;
    const params = new URLSearchParams();
    params.set("ll", point);
    params.set("z", String(MAP_ZOOM));
    params.set("panorama[point]", point);
    params.set("panorama[span]", PANORAMA_SPAN);

    if (lookAtLat != null && lookAtLon != null) {
        const bearing = bearingDeg(lat, lon, lookAtLat, lookAtLon);
        params.set("panorama[direction]", `${Math.round(bearing)},5`);
    } else {
        params.set("panorama[direction]", "auto");
    }

    return `https://yandex.ru/map-widget/v1/?${params.toString()}`;
}

async function loadChromium() {
    try {
        const { chromium } = await import("playwright-core");
        return chromium;
    } catch {
        throw new Error(
            "playwright-core не установлен. Выполните: npm install && npx playwright install chromium"
        );
    }
}

async function prepareDistantPanoramaView(page) {
    const canvas = page.locator("canvas").first();
    if (!(await canvas.count())) return false;

    try {
        await canvas.waitFor({ state: "visible", timeout: 12000 });
    } catch {
        return false;
    }

    // ponytail: лёгкий отъезд — агрессивный wheel раньше смотрел в землю
    await page.waitForTimeout(1500);
    const box = await canvas.boundingBox();
    if (!box?.width || !box?.height) return false;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    return true;
}

async function screenshotPanoramaPage(page) {
    await prepareDistantPanoramaView(page);
    const canvas = page.locator("canvas").first();
    if (await canvas.count()) {
        const box = await canvas.boundingBox();
        if (box?.width && box?.height) {
            return page.screenshot({
                type: "png",
                clip: {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: Math.min(box.height, 650)
                }
            });
        }
    }
    return page.screenshot({ type: "png", fullPage: false });
}

function panoramaCandidatePoints(lat, lon) {
    const target = { lat, lon };
    const candidates = [];
    const seen = new Set();

    for (const distance of OFFSET_DISTANCES_M) {
        for (const bearing of OFFSET_BEARINGS_DEG) {
            const point =
                distance === 0
                    ? target
                    : offsetCoordinate(lat, lon, bearing, distance);
            const key = `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({
                ...point,
                lookAtLat: lat,
                lookAtLon: lon,
                fromOffset: distance
            });
        }
    }

    return candidates;
}

async function tryCapturePanoramaAt(page, lat, lon, lookAtLat, lookAtLon) {
    const url = buildPanoramaWidgetUrl(lat, lon, { lookAtLat, lookAtLon });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
        await page.waitForSelector(PANO_READY_SELECTOR, { timeout: 15000 });
    } catch {
        return null;
    }
    await page.waitForTimeout(2500);

    const canvas = page.locator(`${PANO_READY_SELECTOR} canvas, canvas`).first();
    if (!(await canvas.count())) return null;

    return screenshotPanoramaPage(page);
}

/** ponytail: NSPD centroid wins — геокод адреса только если lat/lon нет */
function resolvePanoramaCoords({ address, lat, lon }) {
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, searchAddress: "" };
    }
    return { lat, lon, searchAddress: shortenAddress(address) };
}

async function captureWithBrowser({ address, lat, lon }) {
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        locale: "ru-RU"
    });

    try {
        let buffer = null;
        const { searchAddress } = resolvePanoramaCoords({ address, lat, lon });

        if (searchAddress) {
            await page.goto(`https://yandex.ru/maps/?text=${encodeURIComponent(searchAddress)}`, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
            await page.waitForURL(/yandex\.ru\/maps\//, { timeout: 30000 });
            await page.waitForTimeout(4000);

            const currentUrl = page.url();
            const ll = new URL(currentUrl).searchParams.get("ll");
            if (ll) {
                const [geoLon, geoLat] = ll.split(",").map(Number);
                if (Number.isFinite(geoLat) && Number.isFinite(geoLon)) {
                    lat = geoLat;
                    lon = geoLon;
                }
            }
        }

        if (!buffer && Number.isFinite(lat) && Number.isFinite(lon)) {
            // сначала точка объекта, потом смещения по улице
            const candidates = panoramaCandidatePoints(lat, lon);

            for (const point of candidates) {
                try {
                    const shot = await tryCapturePanoramaAt(
                        page,
                        point.lat,
                        point.lon,
                        point.lookAtLat,
                        point.lookAtLon
                    );
                    if (shot) {
                        buffer = shot;
                        break;
                    }
                } catch {
                    /* следующая точка */
                }
            }
        }

        if (!buffer) {
            throw new Error("Нет адреса и координат для панорамы");
        }

        return buffer;
    } finally {
        await browser.close();
    }
}

/**
 * Делает скриншот панорамы Яндекс Карт: поиск по адресу → режим панорамы → снимок.
 * @returns {{ imagePath: string, imageUrl: string, cached: boolean } | null}
 */
export async function captureYandexPanorama({ cadastralNumber, address, lat, lon }) {
    if (!cadastralNumber) return null;

    const key = cacheKey(cadastralNumber);
    const cachedFile = readCached(key);
    if (cachedFile) {
        return {
            imagePath: cachedFile,
            imageUrl: `/api/cadastral/panorama/${key}.png`,
            cached: true
        };
    }

    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const buffer = await captureWithBrowser({ address, lat, lon });
    const out = cachePath(key);
    fs.writeFileSync(out, buffer);

    return {
        imagePath: out,
        imageUrl: `/api/cadastral/panorama/${key}.png`,
        cached: false
    };
}

export function getPanoramaCachePath(filename) {
    if (!/^[a-f0-9]{24}\.png$/.test(filename)) return null;
    const file = path.join(CACHE_DIR, filename);
    if (!fs.existsSync(file)) return null;
    return file;
}

export async function buildPanoramaResult({ cadastralNumber, address, lat, lon }) {
    const base = buildPanoramaInfo(lat, lon);
    if (!base && !address) return null;

    try {
        const shot = await captureYandexPanorama({ cadastralNumber, address, lat, lon });
        return {
            ...base,
            imageUrl: shot?.imageUrl || null,
            screenshotCached: shot?.cached ?? false,
            status: shot?.imageUrl ? "ok" : "unavailable"
        };
    } catch (err) {
        return {
            ...base,
            imageUrl: null,
            status: "error",
            error: err.message || String(err)
        };
    }
}

/** ponytail: runnable self-check — node lib/yandex-panorama-screenshot.mjs */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const nspd = resolvePanoramaCoords({
        address: "Москва, Родниковая, участок 2Б",
        lat: 55.638976,
        lon: 37.379372
    });
    console.assert(nspd.searchAddress === "", "NSPD coords -> skip address geocode");

    const noCoords = resolvePanoramaCoords({
        address: "Почтовый адрес ориентира: Москва, Родниковая",
        lat: null,
        lon: undefined
    });
    console.assert(noCoords.searchAddress === "Москва, Родниковая", "strip orientir prefix for geocode");

    console.log("yandex-panorama self-check ok");
}
