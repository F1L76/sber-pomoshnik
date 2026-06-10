import { buildPanoramaInfo } from "./yandex-maps.mjs";
import { captureYandexPanorama } from "./yandex-panorama-screenshot.mjs";
import { fetchDgisPlacePhoto } from "./dgis-photos.mjs";

const SOURCE_LABELS = {
    "2gis-photo": "2ГИС",
    "2gis-map": "2ГИС",
    "2gis": "2ГИС",
    "yandex-panorama": "Яндекс Карты"
};

/**
 * Фото 2ГИС и панорама/скрин Яндекс Карт — оба источника параллельно.
 */
export async function buildPlacePhotoResult({ cadastralNumber, address, lat, lon }) {
    const base = buildPanoramaInfo(lat, lon);
    if (!base && !address) return null;

    const [dgisSettled, yandexSettled] = await Promise.allSettled([
        fetchDgisPlacePhoto({ cadastralNumber, address, lat, lon }),
        captureYandexPanorama({ cadastralNumber, address, lat, lon })
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
                    : "Карта 2ГИС — объект на местности",
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
