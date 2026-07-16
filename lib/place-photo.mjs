import { fileURLToPath } from "url";
import { buildPanoramaInfo } from "./yandex-maps.mjs";
import { captureYandexPanorama } from "./yandex-panorama-screenshot.mjs";
import { fetchDgisPlacePhoto } from "./dgis-photos.mjs";

const SOURCE_LABELS = {
    "2gis-photo": "2ГИС",
    "2gis-map": "2ГИС",
    "2gis": "2ГИС",
    "yandex-panorama": "Яндекс Карты"
};

// ponytail: Playwright-панорама может занять 30+ с — общий 10 с таймаут отрезал и 2ГИС
const DGIS_TIMEOUT_MS = 12_000;
const YANDEX_TIMEOUT_MS = 35_000;

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label}: таймаут ${Math.round(ms / 1000)} с`)), ms);
        })
    ]);
}

function emptyPhotoResult(base, error) {
    const photos = [
        {
            imageUrl: null,
            imageSource: "2gis",
            sourceLabel: "2ГИС",
            pageUrl: null,
            caption: "2ГИС",
            status: "error",
            error
        },
        {
            imageUrl: null,
            imageSource: "yandex-panorama",
            sourceLabel: "Яндекс Карты",
            pageUrl: base?.mapsUrl || null,
            caption: "Яндекс Карты",
            status: "error",
            error
        }
    ];
    return {
        ...base,
        photos,
        imageUrl: null,
        imageSource: null,
        sourceLabel: null,
        dgisUrl: null,
        mapsUrl: base?.mapsUrl || null,
        screenshotCached: false,
        status: "error",
        error
    };
}

async function buildPlacePhotoResultInner({ cadastralNumber, address, lat, lon }) {
    const base = buildPanoramaInfo(lat, lon);
    if (!base && !address) return null;

    const [dgisSettled, yandexSettled] = await Promise.allSettled([
        withTimeout(
            fetchDgisPlacePhoto({ cadastralNumber, address, lat, lon }),
            DGIS_TIMEOUT_MS,
            "2ГИС"
        ),
        withTimeout(
            captureYandexPanorama({ cadastralNumber, address, lat, lon }),
            YANDEX_TIMEOUT_MS,
            "Яндекс Карты"
        )
    ]);

    const photos = [];

    const dgis = dgisSettled.status === "fulfilled" ? dgisSettled.value : null;
    if (dgis?.imageUrl) {
        photos.push({
            imageUrl: dgis.imageUrl,
            imageSource: dgis.imageSource || "2gis",
            sourceLabel: SOURCE_LABELS[dgis.imageSource] || "2ГИС",
            pageUrl: dgis.pageUrl,
            caption:
                dgis.imageSource === "2gis-photo"
                    ? "Фото здания из 2ГИС"
                    : "Карта 2ГИС по координатам объекта",
            screenshotCached: dgis.cached ?? false,
            status: "ok"
        });
    } else {
        const err =
            dgisSettled.status === "rejected"
                ? dgisSettled.reason?.message || String(dgisSettled.reason)
                : "Фото не получено";
        photos.push({
            imageUrl: null,
            imageSource: "2gis",
            sourceLabel: "2ГИС",
            pageUrl: dgis?.pageUrl || null,
            caption: "2ГИС",
            status: "error",
            error: err
        });
    }

    const yandex = yandexSettled.status === "fulfilled" ? yandexSettled.value : null;
    if (yandex?.imageUrl) {
        photos.push({
            imageUrl: yandex.imageUrl,
            imageSource: "yandex-panorama",
            sourceLabel: "Яндекс Карты",
            pageUrl: base?.mapsUrl || null,
            caption: "Панорама Яндекс Карт",
            screenshotCached: yandex.cached ?? false,
            status: "ok"
        });
    } else {
        const err =
            yandexSettled.status === "rejected"
                ? yandexSettled.reason?.message || String(yandexSettled.reason)
                : "Панорама не получена";
        photos.push({
            imageUrl: null,
            imageSource: "yandex-panorama",
            sourceLabel: "Яндекс Карты",
            pageUrl: base?.mapsUrl || null,
            caption: "Яндекс Карты",
            status: "error",
            error: err
        });
    }

    const primary = photos.find((p) => p.imageUrl) || photos[0];

    return {
        ...base,
        photos,
        imageUrl: primary?.imageUrl || null,
        imageSource: primary?.imageSource || null,
        sourceLabel: primary?.sourceLabel || null,
        dgisUrl: photos[0]?.pageUrl || null,
        mapsUrl: base?.mapsUrl || photos[1]?.pageUrl || null,
        screenshotCached: photos.some((p) => p.screenshotCached),
        status: photos.some((p) => p.imageUrl) ? "ok" : "error",
        error: photos.every((p) => !p.imageUrl)
            ? photos.map((p) => `${p.sourceLabel}: ${p.error || "нет"}`).join("; ")
            : null
    };
}

/**
 * Фото 2ГИС и панорама/скрин Яндекс Карт — оба источника параллельно, с отдельными таймаутами.
 */
export async function buildPlacePhotoResult(opts) {
    const base = buildPanoramaInfo(opts?.lat, opts?.lon);
    try {
        return await buildPlacePhotoResultInner(opts);
    } catch (err) {
        const message = err?.message || String(err);
        if (!base && !opts?.address) return null;
        return emptyPhotoResult(base, message);
    }
}

/** ponytail: runnable self-check — node lib/place-photo.mjs */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const empty = await buildPlacePhotoResult({});
    console.assert(empty === null, "no coords/address -> null");

    const slow = await Promise.allSettled([
        Promise.resolve({ imageUrl: "/api/test.jpg" }),
        withTimeout(new Promise(() => {}), 50, "slow")
    ]);
    console.assert(slow[0].status === "fulfilled" && slow[1].status === "rejected", "per-source timeout");

    console.log("place-photo self-check ok");
}
