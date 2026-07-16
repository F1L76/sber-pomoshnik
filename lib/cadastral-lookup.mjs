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

/** Код субъекта РФ (первый блок КН) → region id Циан (rest-app.net/api-cian) */
const CIAN_REGION_BY_CADASTRAL = {
    77: 1,
    78: 2,
    47: 4588,
    50: 4593,
    16: 4777,
    23: 4827,
    52: 4596,
    54: 4598,
    55: 4599,
    61: 4605,
    66: 4743,
    76: 4636,
    36: 4750,
    34: 4741,
    63: 4607,
    59: 4602,
    24: 4828,
    38: 4835,
    25: 4830,
    27: 4832,
    41: 4847,
    14: 4775,
    49: 4592,
    65: 4742,
    79: 4839,
    75: 4635,
    26: 4831,
    30: 4836,
    32: 4853,
    33: 4854,
    35: 4856,
    37: 4858,
    40: 4861,
    42: 4863,
    43: 4864,
    44: 4865,
    45: 4866,
    46: 4867,
    48: 4869,
    51: 4872,
    53: 4874,
    56: 4877,
    57: 4878,
    58: 4879,
    62: 4883,
    67: 4888,
    68: 4889,
    69: 4890,
    70: 4891,
    71: 4892,
    72: 4893,
    73: 4894,
    74: 4895
};

export function normalizeCadastralNumber(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/[^\d:]/g, "");
    const parts = digits.split(":").filter(Boolean);
    if (parts.length !== 4) {
        throw new Error("Кадастровый номер должен быть в формате XX:XX:XXXXXXX:XXXX");
    }
    return parts.map((p, i) => (i < 2 ? p.padStart(2, "0") : p)).join(":");
}

export function getCianRegionId(cadastralNumber) {
    const code = Number(cadastralNumber.split(":")[0]);
    return CIAN_REGION_BY_CADASTRAL[code] || 1;
}

/** Код субъекта РФ → locationId Авито (регион поиска) */
const AVITO_LOCATION_BY_CADASTRAL = {
    77: 637640,
    78: 653240,
    47: 637640,
    50: 637640,
    76: 662810,
    16: 650130,
    23: 623130,
    52: 640860,
    54: 644200,
    55: 644560,
    61: 656350,
    66: 654070,
    36: 625670,
    34: 624840,
    63: 653140,
    59: 648760,
    24: 635320,
    38: 628780,
    25: 644090,
    27: 648920,
    41: 629430,
    14: 649820,
    49: 648070,
    65: 653580,
    79: 649000,
    75: 661100,
    26: 655100,
    30: 629990,
    32: 623410,
    33: 625390,
    35: 625810,
    37: 626470,
    40: 630270,
    42: 631270,
    43: 631430,
    44: 631570,
    45: 631860,
    46: 632020,
    48: 632390,
    51: 640000,
    53: 641240,
    56: 642320,
    57: 642480,
    58: 643030,
    62: 645530,
    67: 653700,
    68: 653860,
    69: 654230,
    70: 654390,
    71: 654550,
    72: 654710,
    73: 654870,
    74: 655030
};

/** Город → locationId Авито (запасной вариант) */
const AVITO_LOCATION_BY_CITY = {
    Москва: 637640,
    "Санкт-Петербург": 653240,
    Ярославль: 662810,
    Новосибирск: 641780,
    Казань: 650130,
    "Нижний Новгород": 640860,
    Екатеринбург: 654070,
    Краснодар: 623130,
    Воронеж: 625670,
    Ростов: 623130,
    Самара: 653140,
    Уфа: 646600,
    Красноярск: 635320,
    Пермь: 648760,
    Волгоград: 624840
};

export function getAvitoLocationId(cadastralNumber, address) {
    const code = Number(cadastralNumber.split(":")[0]);
    if (AVITO_LOCATION_BY_CADASTRAL[code]) {
        return AVITO_LOCATION_BY_CADASTRAL[code];
    }
    const { city } = parseAddressParts(address);
    if (city && AVITO_LOCATION_BY_CITY[city]) {
        return AVITO_LOCATION_BY_CITY[city];
    }
    return 637640;
}

function extractHouseOrPlotNumber(address) {
    if (!address) return null;
    return (
        (address.match(/(?:д\.?|дом|участок|з\/у|зу|вл\.?|владение)\s*([\d/]+)/i) || [])[1] ||
        (address.match(/земельный\s+участок\s*([\d/]+)/i) || [])[1] ||
        null
    );
}

function shortenAddressForSearch(address) {
    if (!address) return null;
    const short = address
        .replace(/^Российская Федерация,\s*/i, "")
        .replace(/^[А-Яа-яЁё\s-]+\s+область,\s*/i, "")
        .replace(/вн\.?тер\.?г\.\s*муниципальный округ\s+[^,]+,\s*/gi, "")
        .replace(/городской округ\s+[^,]+,\s*/gi, "")
        .trim();
    return short.length > 8 ? short : null;
}

/**
 * Запросы для Авито и Домклик: только адрес, без кадастрового номера.
 * exactQueries — точный адрес (с домом/участком), streetQueries — улица без номера.
 */
export function buildAvitoDomclickQueries(objectInfo) {
    const addr = objectInfo.object?.address;
    const exactQueries = new Set();
    if (!addr) {
        return { exactQueries: [], streetQueries: [] };
    }

    const { city, street, streetLabel } = parseAddressParts(addr);
    const house = extractHouseOrPlotNumber(addr);
    const short = shortenAddressForSearch(addr);
    if (short) exactQueries.add(short);

    if (city && street && house) {
        exactQueries.add(`${city} ${streetLabel || `ул ${street}`} ${house}`);
        exactQueries.add(`${city}, ${street}, ${house}`);
        exactQueries.add(`${street} ${house} ${city}`);
        const streetName = streetLabel?.replace(
            /^(?:улица|ул\.?|проспект|пр-?т|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-?р|площадь|пл\.?)\s*/i,
            ""
        ).trim();
        if (streetName) {
            exactQueries.add(`${city} ул ${streetName} ${house}`);
            exactQueries.add(`ул ${streetName} ${house} ${city}`);
        }
    } else if (city && streetLabel) {
        exactQueries.add(`${city} ${streetLabel}`);
    }

    const streetQueries = buildStreetAreaQueries(objectInfo);
    const streetSet = new Set(streetQueries);
    const exact = [...exactQueries].filter((q) => !streetSet.has(q) && !q.includes(":"));

    return { exactQueries: exact, streetQueries };
}

/** @deprecated Используйте buildAvitoDomclickQueries */
export function buildMarketplaceQueries(objectInfo) {
    return buildAvitoDomclickQueries(objectInfo).exactQueries;
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
    const streetLabel = streetMatch
        ? streetMatch[0].replace(/\s+/g, " ").trim()
        : null;
    const street = streetMatch?.[1]?.trim() || null;

    return { city, street, streetLabel };
}

/** Запросы «город + улица» без номера дома — для поиска объявлений рядом на Авито и Домклик. */
export function buildStreetAreaQueries(objectInfo) {
    const addr = objectInfo.object?.address;
    if (!addr) return [];

    const { city, street, streetLabel } = parseAddressParts(addr);
    if (!city || !street) return [];

    const queries = new Set();
    queries.add(`${city} ${streetLabel}`);
    queries.add(`${city} ${street}`);
    queries.add(`${city}, ${street}`);
    if (streetLabel) {
        queries.add(`${streetLabel} ${city}`);
    }

    return [...queries];
}

/** Короткий адрес для текстового поиска на площадках */
export function buildSearchQueries(objectInfo) {
    const queries = new Set();
    const cad = objectInfo.cadastralNumber;
    const addr = objectInfo.object?.address;

    if (cad) queries.add(cad);

    if (addr) {
        queries.add(addr);
        const { streetLabel } = parseAddressParts(addr);
        if (streetLabel) queries.add(streetLabel);
        const houseMatch = addr.match(/(?:д\.?|дом)\s*([\d/]+)/i);
        const streetName = streetLabel?.replace(
            /^(?:улица|ул\.?|проспект|пр-?т|переулок|пер\.?|шоссе|ш\.?|набережная|наб\.?|бульвар|б-?р|площадь|пл\.?)\s*/i,
            ""
        ).trim();
        if (streetName && houseMatch) {
            queries.add(`${streetName} ${houseMatch[1]}`);
            queries.add(`ул ${streetName} ${houseMatch[1]}`);
        }
        const short = addr
            .replace(/^Российская Федерация,\s*/i, "")
            .replace(/^Ярославская область,\s*/i, "")
            .replace(/^(?:г\.?|город)\s+/i, "")
            .replace(/вн\.?тер\.?г\.\s*муниципальный округ\s+[^,]+,\s*/i, "")
            .trim();
        if (short.length > 8) queries.add(short);
    }

    return [...queries];
}
