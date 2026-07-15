import { httpsFetch, BROWSER_HEADERS } from "./https-fetch.mjs";
import { geometryToGeoJsonWgs84, geometryToSvgPreview } from "./geo-utils.mjs";

const NSPD_HEADERS = {
    ...BROWSER_HEADERS,
    Accept: "application/json, text/plain, */*",
    Referer: "https://nspd.gov.ru/map?thematic=PKK"
};

function parseTabGroups(json) {
    const groups = {};
    for (const item of json?.object || []) {
        const title = String(item?.title || "")
            .replace(/:\s*$/u, "")
            .trim();
        const values = (item?.value || []).filter(Boolean);
        if (title && values.length) groups[title] = values;
    }
    return groups;
}

async function fetchTabGroupData(feature, tabClass) {
    const categoryId = feature?.properties?.category;
    const geomId = feature?.id;
    const opts = feature?.properties?.options || {};

    if (!categoryId || geomId == null) return null;

    const params = new URLSearchParams({ tabClass, categoryId: String(categoryId), geomId: String(geomId) });

    if (opts.no_coords && opts.objdoc_id && opts.registers_id) {
        params.delete("categoryId");
        params.delete("geomId");
        params.set("objdocId", String(opts.objdoc_id));
        params.set("registersId", String(opts.registers_id));
    }

    const bases = ["https://nspd.gov.ru", "https://nspd.rosreestr.gov.ru"];
    for (const base of bases) {
        try {
            const res = await httpsFetch(`${base}/api/geoportal/v1/tab-group-data?${params}`, {
                headers: NSPD_HEADERS,
                timeoutMs: 10_000
            });
            if (!res.ok) continue;
            const json = await res.json();
            return parseTabGroups(json);
        } catch {
            /* try next host */
        }
    }
    return null;
}

function buildNspdMapUrl(cadastralNumber, location) {
    const lat = location?.lat;
    const lon = location?.lon;
    const coords =
        Number.isFinite(lat) && Number.isFinite(lon)
            ? `&zoom=18&lat=${lat}&lon=${lon}`
            : "";
    return `https://nspd.gov.ru/map?thematic=PKK${coords}&cadastralNumber=${encodeURIComponent(cadastralNumber)}`;
}

/**
 * Расширение карточки НСПД по идеям pynspd / NSPD-request: границы, связанные объекты, доп. поля.
 */
export async function enrichNspdFeature(feature, cadastralNumber, location = null) {
    const geometry = geometryToGeoJsonWgs84(feature?.geometry);
    const [objectsList, landLinks] = await Promise.all([
        fetchTabGroupData(feature, "objectsList"),
        fetchTabGroupData(feature, "landLinks")
    ]);

    const relatedObjects = [];
    const seen = new Set();
    for (const groups of [objectsList, landLinks]) {
        if (!groups) continue;
        for (const [groupTitle, values] of Object.entries(groups)) {
            for (const cadNum of values) {
                if (seen.has(cadNum)) continue;
                seen.add(cadNum);
                relatedObjects.push({ cadastralNumber: cadNum, group: groupTitle });
            }
        }
    }

    const boundaryPreview = geometryToSvgPreview(geometry);

    return {
        geomId: feature?.id ?? null,
        categoryId: feature?.properties?.category ?? null,
        geometry,
        boundaryPreview,
        relatedObjects,
        tabs: {
            objectsList: objectsList || null,
            landLinks: landLinks || null
        },
        mapUrl: buildNspdMapUrl(cadastralNumber, location)
    };
}
