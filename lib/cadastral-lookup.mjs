import { httpsFetch, BROWSER_HEADERS } from "./https-fetch.mjs";
import { extractCoordinates } from "./geo-utils.mjs";
import { enrichNspdFeature } from "./nspd-enrich.mjs";

const NSPD_BASES = ["https://nspd.gov.ru", "https://nspd.rosreestr.gov.ru"];
const NSPD_REFERER = "https://nspd.gov.ru/map?thematic=PKK";
// ponytail: зарубежные DC (Render) часто режут/вешают .gov.ru — без таймаута весь поиск молчит
const NSPD_TIMEOUT_MS = 8_000;

function buildNspdSearchUrl(base, query) {
    const params = new URLSearchParams({
        thematicSearchId: "1",
        query
    });
    return `${base}/api/geoportal/v2/search/geoportal?${params}`;
}

function isNspdNotFoundResponse(status, json) {
    if (status !== 404) return false;
    if (json?.code === 204) return true;
    return /no objects found|не найден/i.test(String(json?.message || ""));
}

/** Ответ поиска НСПД: "OK"/мусор → null (хост битый), JSON → объект. */
export function parseNspdSearchBody(text) {
    const raw = String(text || "").trim();
    if (!raw || raw === "OK") return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function requestNspdSearchOne(base, query, headers) {
    const url = buildNspdSearchUrl(base, query);
    const res = await httpsFetch(url, { headers, timeoutMs: NSPD_TIMEOUT_MS });
    const text = await res.text();
    const json = parseNspdSearchBody(text);

    if (isNspdNotFoundResponse(res.status, json)) {
        return { found: false, features: [], source: base, hostOk: true };
    }

    // пустой 200/"OK" без FeatureCollection — не результат, а битый хост
    if (res.ok && json?.data?.type === "FeatureCollection") {
        const features = json.data.features || [];
        return { found: features.length > 0, features, source: base, hostOk: true };
    }

    if (res.ok && Array.isArray(json?.data?.features)) {
        const features = json.data.features;
        return { found: features.length > 0, features, source: base, hostOk: true };
    }

    throw new Error(
        `НСПД (${new URL(base).hostname}) HTTP ${res.status}, тело не похоже на ответ поиска`
    );
}

async function requestNspdSearch(query) {
    const headers = {
        ...BROWSER_HEADERS,
        Accept: "application/json, text/plain, */*",
        Referer: NSPD_REFERER
    };

    // первый валидный ответ выигрывает; остальные таймаутятся в фоне
    return await new Promise((resolve, reject) => {
        let left = NSPD_BASES.length;
        const errors = [];
        let settled = false;

        for (const base of NSPD_BASES) {
            requestNspdSearchOne(base, query, headers).then(
                (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                },
                (err) => {
                    errors.push(`${new URL(base).hostname}: ${err.message || err}`);
                    left -= 1;
                    if (!settled && left === 0) {
                        reject(
                            new Error(
                                `Не удалось связаться с НСПД (${errors.join("; ")}). ` +
                                    "С зарубежных серверов (Render и т.п.) реестр часто недоступен — нужен хостинг в РФ."
                            )
                        );
                    }
                }
            );
        }
    });
}

export function normalizeCadastralNumber(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/[^\d:]/g, "");
    const parts = digits.split(":").filter(Boolean);
    if (parts.length !== 4) {
        throw new Error("Кадастровый номер должен быть в формате XX:XX:XXXXXXX:XXXX");
    }
    return parts.map((p, i) => (i < 2 ? p.padStart(2, "0") : p)).join(":");
}

function pickFeature(features, cadastralNumber) {
    if (!features?.length) return null;
    const exact = features.find(
        (f) =>
            f.properties?.options?.cad_num === cadastralNumber ||
            f.properties?.descr === cadastralNumber ||
            f.properties?.label === cadastralNumber
    );
    return exact || features[0];
}

function mapRosreestrObject(feature, cadastralNumber) {
    const props = feature?.properties || {};
    const opts = props.options || {};
    const location = extractCoordinates(feature?.geometry);
    return {
        cadastralNumber: opts.cad_num || props.descr || cadastralNumber,
        address: opts.readable_address || opts.address || null,
        objectType: opts.land_record_type || opts.build_record_type || props.categoryName || null,
        category: props.categoryName || null,
        area: opts.land_record_area ?? opts.specified_area ?? opts.area ?? opts.build_record_area ?? null,
        areaUnit: opts.land_record_area != null || opts.specified_area != null ? "кв. м" : null,
        cadastralValue: opts.cost_value ?? null,
        permittedUse: opts.permitted_use_established_by_document || opts.purpose || null,
        status: opts.status || null,
        quarterCadNumber: opts.quarter_cad_number || null,
        ownershipType: opts.ownership_type || null,
        registrationDate: opts.land_record_reg_date || opts.registration_date || null,
        regionCode: props.cadastralDistrictsCode ?? Number(cadastralNumber.split(":")[0]) ?? null,
        location
    };
}

export async function lookupCadastralObject(cadastralNumber) {
    const normalized = normalizeCadastralNumber(cadastralNumber);
    let features = [];
    try {
        ({ features } = await requestNspdSearch(normalized));
    } catch (e) {
        return {
            found: false,
            cadastralNumber: normalized,
            object: null,
            message: e.message || String(e)
        };
    }
    const feature = pickFeature(features, normalized);

    if (!feature) {
        return {
            found: false,
            cadastralNumber: normalized,
            object: null,
            message:
                "Объект не найден в публичной кадастровой карте (НСПД). Проверьте кадастровый номер на nspd.gov.ru"
        };
    }

    const object = mapRosreestrObject(feature, normalized);
    const nspd = await enrichNspdFeature(feature, normalized, object.location);

    return {
        found: true,
        cadastralNumber: normalized,
        object: { ...object, geometry: nspd.geometry },
        nspd,
        rawCategory: feature.properties?.category ?? null
    };
}

const STREET_TYPE_RE =
    /(?:улица|ул\.?|проспект|пр-?т|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-?р|площадь|пл\.?|аллея|ал\.?)\s+([^,]+)/i;
/** «Комсомольская улица» / «Ленина пр-т» — тип после имени (без \\b: кириллица не \w) */
const STREET_TYPE_AFTER_RE =
    /([^,]+?)\s+(?:улица|ул\.?|проспект|пр-?т|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-?р|площадь|пл\.?|аллея|ал\.?)(?=\s|,|$)/i;

/** Город и улица из адреса НСПД (без номера дома). */
export function parseAddressParts(address) {
    if (!address) return { city: null, street: null, streetLabel: null };

    let city =
        (address.match(/(?:г\.?|город)\s+([^,]+)/i) || [])[1]?.trim() || null;

    if (!city) {
        const afterRegion = address.match(/область,\s*([^,]+)/i);
        if (afterRegion && !/^(ул|улица|пр|пер|ш|наб|б-?р|пл)/i.test(afterRegion[1])) {
            city = afterRegion[1].replace(/^г\.?\s*/i, "").trim();
        }
    }

    if (!city && /^(г\.?\s*)?Москва/i.test(address)) city = "Москва";
    if (!city && /^(г\.?\s*)?Санкт-Петербург/i.test(address)) city = "Санкт-Петербург";

    const streetMatch = address.match(STREET_TYPE_RE);
    let streetLabel = streetMatch
        ? streetMatch[0].replace(/\s+/g, " ").trim()
        : null;
    let street = streetMatch?.[1]?.trim() || null;

    if (!street) {
        const after = address.match(STREET_TYPE_AFTER_RE);
        if (after) {
            street = after[1].replace(/^.*\b(?:мкр\.?|район|р-н|пос\.?)\s+/i, "").trim();
            streetLabel = after[0].replace(/\s+/g, " ").trim();
        }
    }

    return { city, street, streetLabel };
}

