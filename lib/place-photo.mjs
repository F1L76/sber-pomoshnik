import { buildPanoramaInfo } from "./yandex-maps.mjs";
import { captureYandexPanorama } from "./yandex-panorama-screenshot.mjs";
import { fetchDgisPlacePhoto } from "./dgis-photos.mjs";

const SOURCE_LABELS = {
    "2gis-photo": "2ГИС · фото объекта",
    "2gis-map": "2ГИС · карта",
    "2gis": "2ГИС",
    "yandex-panorama": "Яндекс · панорама"
};

/**
 * Сначала 2ГИС (фото здания / карта), при неудаче — панорама Яндекса.
 */
export async function buildPlacePhotoResult({ cadastralNumber, address, lat, lon }) {
    const base = buildPanoramaInfo(lat, lon);
    if (!base && !address) return null;

    const errors = [];

    try {
        const dgis = await fetchDgisPlacePhoto({ cadastralNumber, address, lat, lon });
        if (dgis?.imageUrl) {
            return {
                ...base,
                imageUrl: dgis.imageUrl,
                imageSource: dgis.imageSource,
                sourceLabel: SOURCE_LABELS[dgis.imageSource] || "2ГИС",
                dgisUrl: dgis.pageUrl,
                mapsUrl: dgis.pageUrl || base?.mapsUrl,
                screenshotCached: dgis.cached ?? false,
                status: "ok",
                title: dgis.title || null
            };
        }
    } catch (err) {
        errors.push(`2ГИС: ${err.message || String(err)}`);
    }

    try {
        const shot = await captureYandexPanorama({ cadastralNumber, address, lat, lon });
        if (shot?.imageUrl) {
            return {
                ...base,
                imageUrl: shot.imageUrl,
                imageSource: "yandex-panorama",
                sourceLabel: SOURCE_LABELS["yandex-panorama"],
                dgisUrl: null,
                screenshotCached: shot.cached ?? false,
                status: "ok",
                fallbackNote: errors.length ? "2ГИС недоступен, показана панорама Яндекса" : null
            };
        }
    } catch (err) {
        errors.push(`Яндекс: ${err.message || String(err)}`);
    }

    return {
        ...base,
        imageUrl: null,
        imageSource: null,
        sourceLabel: null,
        status: "error",
        error: errors.join("; ") || "Не удалось получить фото объекта"
    };
}
