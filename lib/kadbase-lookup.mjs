import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { httpsFetchFollow, BROWSER_HEADERS } from "./https-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "..", ".cache", "kadbase-paths.json");

const KADBASE_ORIGIN = "https://kadbase.ru";

/** Известные пути карточек (поиск kadbase.ru часто отдаёт 302 на /lk/) */
const SEED_OBJECT_PATHS = {
    "77:05:0001005:19":
        "/object-77:05:0001005:19-rossijskaya-federaciya-gorod-moskva-vnterg-municipalnyj-okrug-danilovskij-ulica-bolshaya-serpuhovskaya-zemelnyj-uchastok-58/",
    "77:01:0001001:1000":
        "/object-77:01:0001001:1000-rossijskaya-federaciya-gorod-moskva-vnterg-municipalnyj-okrug-tverskoj-ulica-manezhnaya-zemelnyj-uchastok-2a/"
};
const KADBASE_HEADERS = {
    ...BROWSER_HEADERS,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Транслитерация адреса в slug kadbase.ru (латиница, дефисы) */
const CYRILLIC_MAP = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "j",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya"
};

function transliterateRu(text) {
    return String(text || "")
        .toLowerCase()
        .split("")
        .map((ch) => {
            if (CYRILLIC_MAP[ch] != null) return CYRILLIC_MAP[ch];
            if (/[a-z0-9]/.test(ch)) return ch;
            return " ";
        })
        .join("");
}

function slugifyTransliterated(text) {
    return transliterateRu(text)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

/** Полный slug адреса для URL /object-{KN}-{slug}/ на kadbase.ru */
function normalizeAddressForKadbaseSlug(address) {
    return String(address)
        .replace(/\s+/g, " ")
        .replace(/вн\.?\s*тер\.?\s*г\.?/gi, "внтерг")
        .replace(/\bг\.\s*/gi, "город ")
        .replace(/\bул\.\s*/gi, "улица ")
        .replace(/\bпер\.\s*/gi, "переулок ")
        .replace(/\bпр\.\s*/gi, "проспект ")
        .replace(/\bд\.\s*/gi, "")
        .trim();
}

export function buildKadbaseSlugFromAddress(address) {
    if (!address) return null;
    const slug = slugifyTransliterated(normalizeAddressForKadbaseSlug(address));
    return slug || null;
}

/** Сокращённый slug: город + улица/участок + номер (без «Российская Федерация» и округа) */
function buildShortKadbaseSlugFromAddress(address) {
    if (!address) return null;
    const parts = String(address)
        .split(/[,;]+/)
        .map((p) => p.trim())
        .filter(Boolean);

    const skipRe =
        /^(российская федерация|рф|россия|федеральный округ|федеральная территория)/i;
    const districtRe = /(муниципальный округ|внутригородск|район|округ)/i;

    const meaningful = parts.filter((p) => !skipRe.test(p) && !districtRe.test(p));
    const picked = meaningful.length >= 2 ? meaningful.slice(-3) : meaningful;
    if (!picked.length) return null;

    const slug = slugifyTransliterated(picked.join(" "));
    return slug || null;
}

function buildObjectPathFromSlug(cadastralNumber, slug) {
    if (slug) return `/object-${cadastralNumber}-${slug}/`;
    return `/object-${cadastralNumber}/`;
}

/** Варианты прямых путей карточки (кэш → полный slug → короткий → только КН) */
export function buildKadbaseObjectPathVariants(cadastralNumber, address) {
    const variants = [];
    const full = buildKadbaseSlugFromAddress(address);
    const short = buildShortKadbaseSlugFromAddress(address);

    if (full) variants.push(buildObjectPathFromSlug(cadastralNumber, full));
    if (short && short !== full) variants.push(buildObjectPathFromSlug(cadastralNumber, short));
    variants.push(buildObjectPathFromSlug(cadastralNumber, null));

    return [...new Set(variants)];
}

function annotateWithoutSearch(result, loadMethod) {
    if (!result) return null;
    return {
        ...result,
        loadedWithoutSearch: true,
        loadMethod,
        loadedFromCache: loadMethod === "cache"
    };
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Путь карточки объекта из HTML ответа поиска kadbase.ru */
export function extractObjectPathFromSearchHtml(html, cadastralNumber) {
    if (!html) return null;

    const kn = escapeRegExp(cadastralNumber);
    const byKn = html.match(new RegExp(`(/object-${kn}[^"'\\s]*)`, "i"));
    if (byKn?.[1]) {
        const path = byKn[1].split(/[<"']/)[0];
        return path.endsWith("/") ? path : `${path}/`;
    }

    const replaceMatches = [
        ...html.matchAll(/window\.location\.replace\("(\/object-[^"]+)"\)/gi)
    ];
    if (replaceMatches.length) {
        const path = replaceMatches[replaceMatches.length - 1][1];
        return path.endsWith("/") ? path : `${path}/`;
    }

    const hrefMatch = html.match(/href="(\/object-\d{2}:\d{2}:[^"]+)"/i);
    if (hrefMatch?.[1]) {
        const path = hrefMatch[1];
        return path.endsWith("/") ? path : `${path}/`;
    }

    return null;
}

function isLoginRedirect(url) {
    return /\/lk\/?($|\?)/i.test(String(url || ""));
}

function buildAccessLimitedMessage() {
    return "kadbase.ru временно ограничил автоматический доступ (лимит запросов или требуется вход). Откройте карточку вручную на сайте или повторите позже.";
}

async function readPathCache() {
    try {
        const raw = await fs.readFile(CACHE_PATH, "utf8");
        return { ...SEED_OBJECT_PATHS, ...JSON.parse(raw) };
    } catch {
        return { ...SEED_OBJECT_PATHS };
    }
}

async function savePathCache(cadastralNumber, objectPath) {
    if (!cadastralNumber || !objectPath) return;
    const cache = await readPathCache();
    cache[cadastralNumber] = objectPath;
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function fetchKadbaseObjectPage(objectPath, normalized, cookieJar) {
    const objectRes = await kadbaseFetch(objectPath, { cookieJar });
    const objectHtml = await objectRes.text();
    const objectUrl = objectPath.startsWith("http") ? objectPath : `${KADBASE_ORIGIN}${objectPath}`;

    if (/такого адреса нет/i.test(objectHtml)) {
        return null;
    }
    if (!objectHtml.includes('id="cadnump"') && !objectHtml.includes("Общая информация по объекту")) {
        return null;
    }

    return mapKadbaseObject(objectHtml, normalized, objectUrl);
}

async function kadbaseFetch(path, { method = "GET", body, cookieJar } = {}) {
    return httpsFetchFollow(`${KADBASE_ORIGIN}${path}`, {
        method,
        body,
        cookieJar,
        headers: {
            ...KADBASE_HEADERS,
            ...(body
                ? {
                      "Content-Type": "application/x-www-form-urlencoded",
                      Referer: `${KADBASE_ORIGIN}/`
                  }
                : { Referer: `${KADBASE_ORIGIN}/` })
        }
    });
}

function stripHtml(html) {
    return String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseRowFields(html) {
    const fields = {};
    const rowRe =
        /<div class="row_sser">[\s\S]*?<div class="left left_sser">([\s\S]*?)<\/div>[\s\S]*?<div class="tx_sser[^"]*">([\s\S]*?)<\/div>/gi;

    let match;
    while ((match = rowRe.exec(html))) {
        const label = stripHtml(match[1]);
        const value = stripHtml(match[2]);
        if (label && value && !value.includes("доступно в платной версии")) {
            fields[label] = value;
        }
    }
    return fields;
}

function parseNumericValue(raw) {
    if (!raw) return null;
    const num = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(num) ? num : null;
}

function parseShortInfo(html, cadastralNumber) {
    const briefBlock =
        html.match(
            /Краткая информация по объекту[\s\S]*?<div class="lable_2 short_info">([\s\S]*?)<\/div>\s*<div class="clear">/i
        )?.[1] || "";
    const text = stripHtml(briefBlock || html);

    let areaMatch =
        text.match(/Кадастровая площадь[^.]*составляет\s+([\d\s,.]+)\s*кв\.?\s*м/i) ||
        html.match(/<meta name="description"[^>]*Content="[^"]*площад[ья]:\s*([\d\s,.]+)\s*кв/i);
    const costMatch = text.match(/Кадастровая стоимость[^.]*составляет\s+([\d\s,.]+)\s*руб/i);

    if (!areaMatch && cadastralNumber) {
        areaMatch = html.match(
            new RegExp(
                `Кадастровая площадь объекта\\s+${cadastralNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.]*составляет\\s+([\\d\\s,.]+)\\s*кв`,
                "i"
            )
        );
    }

    return {
        area: parseNumericValue(areaMatch?.[1]),
        cadastralValue: parseNumericValue(costMatch?.[1])
    };
}

function extractRnbBlock(html) {
    const start = html.search(/id="rnb"/i);
    if (start < 0) return "";
    const end = html.indexOf('id="pay_lk_service"', start);
    return end > start ? html.slice(start, end) : html.slice(start);
}

function parseStatusLine(block, label) {
    const re = new RegExp(
        `${label}\\s*-\\s*(?:<[^>]+>\\s*)*([^<]+(?:<[^>]+>[^<]+</[^>]+>)?[^<]*)`,
        "i"
    );
    const match = block.match(re);
    if (!match) {
        const fallback = block.match(
            new RegExp(`${label}\\s*-\\s*[\\s\\S]*?(найдено\\s+\\d+|не обнаружены)`, "i")
        );
        return fallback?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
    }
    return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

function parseStatusCount(statusText) {
    if (!statusText) return null;
    const match = statusText.match(/найдено\s+(\d+)/i);
    return match ? Number(match[1]) : statusText.toLowerCase().includes("не обнаруж") ? 0 : null;
}

function parseEncumbranceRecords(section) {
    const parts = section.split("&#128994;").slice(1);
    const records = [];

    for (const part of parts) {
        if (!part.includes("вид") && !part.includes("дата")) continue;

        const dateMatch = part.match(/дата\s*<\/span>[\s\S]*?(\d{2}\.\d{2}\.)/i);
        const datePartial = dateMatch?.[1] || null;
        const kindHidden = /вид[\s\S]*?доступно в платной версии/i.test(part);
        const numberHidden = /№[\s\S]*?доступно в платной версии/i.test(part);

        records.push({
            kind: kindHidden ? null : stripHtml(part.match(/вид[\s\S]*?<\/div>([^<]+)/i)?.[1]),
            number: numberHidden ? null : stripHtml(part.match(/№[\s\S]*?<\/div>([^<]+)/i)?.[1]),
            datePartial,
            detailsHidden: kindHidden || numberHidden
        });
    }

    return records;
}

function parseRecordsBetween(block, startLabel, endLabel) {
    const startIdx = block.search(new RegExp(startLabel, "i"));
    if (startIdx < 0) return [];
    let endIdx = endLabel ? block.search(new RegExp(endLabel, "i")) : -1;
    if (endIdx < 0 || endIdx <= startIdx) endIdx = block.length;
    return parseEncumbranceRecords(block.slice(startIdx, endIdx));
}

function parseRightsBlock(html) {
    const block = extractRnbBlock(html);
    const rights = parseStatusLine(block, "Зарегистрированные права");
    const restrictions = parseStatusLine(block, "Зарегистрированные ограничения");
    const checkedAt =
        html.match(/на момент последней проверки\s*-\s*([^)<]+)/i)?.[1]?.trim() || null;

    const rightsRecords = parseRecordsBetween(
        block,
        "Зарегистрированные права",
        "Зарегистрированные ограничения"
    );
    const restrictionRecords = parseRecordsBetween(block, "Зарегистрированные ограничения", 'class="services_bl"');

    return {
        rights,
        restrictions,
        rightsCount: parseStatusCount(rights),
        restrictionsCount: parseStatusCount(restrictions),
        rightsRecords,
        restrictionRecords,
        encumbrances: restrictionRecords,
        checkedAt
    };
}

function parseRelatedObjects(html) {
    const countMatch = html.match(/Связи с другими объектами[\s\S]*?Найдено\s*-\s*(\d+)/i);
    return countMatch ? Number(countMatch[1]) : null;
}

function mapKadbaseObject(html, cadastralNumber, objectUrl) {
    const fields = parseRowFields(html);
    const shortInfo = parseShortInfo(html, cadastralNumber);
    const rightsBlock = parseRightsBlock(html);

    const areaRaw = fields["Площадь"] || null;
    const areaFromShort = shortInfo.area;
    const area =
        areaFromShort ??
        (areaRaw ? Number(String(areaRaw).replace(/[^\d.,]/g, "").replace(",", ".")) : null);

    const cadastralValue = shortInfo.cadastralValue;

    return {
        found: true,
        cadastralNumber: fields["Кадастровый номер"] || cadastralNumber,
        address: fields["Адрес"] || null,
        objectType: fields["Тип"] || null,
        status: fields["Статус объекта"] || null,
        area,
        areaUnit: area != null ? "кв. м" : null,
        cadastralValue,
        cadastralValueDate: fields["Дата внесения стоимости"] || null,
        landCategory: fields["Категория земель"] || null,
        permittedUse: fields["Разрешенное использование (ВРИ)"] || fields["Разрешенное использование"] || null,
        permittedUseDocument: fields["Разрешенное использование по документам"] || null,
        zouit: fields["Объект входит в ЗОУИТ по данным"] || fields["Объект входит в ЗОУИТ"] || null,
        boundaries: fields["Границы"] || null,
        fiasId: fields["ФИАС ID"] || null,
        updatedAt: fields["Дата обновления информации по объекту в"] || rightsBlock.checkedAt,
        rights: rightsBlock.rights,
        restrictions: rightsBlock.restrictions,
        rightsCount: rightsBlock.rightsCount,
        restrictionsCount: rightsBlock.restrictionsCount,
        rightsRecords: rightsBlock.rightsRecords,
        restrictionRecords: rightsBlock.restrictionRecords,
        encumbrances: rightsBlock.restrictionRecords,
        encumbrancesSummary: rightsBlock.restrictions,
        checkedAt: rightsBlock.checkedAt,
        relatedObjectsCount: parseRelatedObjects(html),
        objectUrl,
        source: "kadbase.ru"
    };
}

export function buildKadbaseSearchUrl(cadastralNumber) {
    return `${KADBASE_ORIGIN}/search/`;
}

export function buildKadbaseObjectUrl(cadastralNumber) {
    return `${KADBASE_ORIGIN}/search/?q=${encodeURIComponent(cadastralNumber)}`;
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeNumber(value) {
    if (value == null || value === "") return null;
    const num = Number(String(value).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(num) ? num : null;
}

/** Сверка открытых полей НСПД и kadbase.ru */
export function compareKadbaseRosreestr(kadbase, rosreestr) {
    if (!kadbase?.found || !rosreestr?.found) {
        return { status: "partial", checks: [], summary: "Недостаточно данных для сверки" };
    }

    const rr = rosreestr.object || {};
    const checks = [];

    const addressK = normalizeText(kadbase.address);
    const addressR = normalizeText(rr.address);
    if (addressK && addressR) {
        const match =
            addressK === addressR ||
            addressK.includes(addressR.slice(0, 40)) ||
            addressR.includes(addressK.slice(0, 40));
        checks.push({
            field: "address",
            label: "Адрес",
            match,
            kadbase: kadbase.address,
            rosreestr: rr.address
        });
    }

    const areaK = normalizeNumber(kadbase.area);
    const areaR = normalizeNumber(rr.area);
    if (areaK != null && areaR != null) {
        checks.push({
            field: "area",
            label: "Площадь",
            match: Math.abs(areaK - areaR) < 0.01,
            kadbase: `${areaK} кв. м`,
            rosreestr: `${areaR} ${rr.areaUnit || "кв. м"}`
        });
    }

    const costK = normalizeNumber(kadbase.cadastralValue);
    const costR = normalizeNumber(rr.cadastralValue);
    if (costK != null && costR != null) {
        checks.push({
            field: "cadastralValue",
            label: "Кадастровая стоимость",
            match: Math.abs(costK - costR) < 1,
            kadbase: costK,
            rosreestr: costR
        });
    }

    const typeK = normalizeText(kadbase.objectType);
    const typeR = normalizeText(rr.objectType || rr.category);
    if (typeK && typeR) {
        checks.push({
            field: "objectType",
            label: "Тип объекта",
            match: typeK.includes(typeR) || typeR.includes(typeK),
            kadbase: kadbase.objectType,
            rosreestr: rr.objectType || rr.category
        });
    }

    const matched = checks.filter((c) => c.match).length;
    const total = checks.length;
    let status = "ok";
    if (total === 0) status = "partial";
    else if (matched < total) status = "warning";
    else if (matched === total) status = "ok";

    const summary =
        total === 0
            ? "Сверка по открытым полям недоступна"
            : matched === total
              ? `Данные НСПД и kadbase.ru совпадают (${matched}/${total})`
              : `Есть расхождения: совпало ${matched} из ${total}`;

    return { status, checks, summary, matched, total };
}

async function tryLoadObjectPaths(objectPaths, normalized, cookieJar, loadMethod) {
    for (const objectPath of objectPaths) {
        const mapped = await fetchKadbaseObjectPage(objectPath, normalized, cookieJar);
        if (mapped) {
            await savePathCache(normalized, objectPath);
            return annotateWithoutSearch(mapped, loadMethod);
        }
    }
    return null;
}

export async function lookupKadbaseObject(cadastralNumber, options = {}) {
    const normalized = String(cadastralNumber || "").trim();
    const rosreestrAddress = options.address || options.rosreestrAddress || null;
    const cookieJar = new Map();
    let lastError = null;

    try {
        await kadbaseFetch("/", { cookieJar });

        const cache = await readPathCache();
        const cachedPath = cache[normalized];
        if (cachedPath) {
            const fromCache = await tryLoadObjectPaths([cachedPath], normalized, cookieJar, "cache");
            if (fromCache) return fromCache;
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) {
                await sleep(800 * attempt);
                await kadbaseFetch("/", { cookieJar });
            }

            const searchRes = await kadbaseFetch("/search/", {
                method: "POST",
                body: `searchline=${encodeURIComponent(normalized)}`,
                cookieJar
            });

            const searchHtml = await searchRes.text();
            const finalUrl = searchRes.finalUrl || "";

            if (isLoginRedirect(finalUrl) && !searchHtml.includes("/object-")) {
                lastError = buildAccessLimitedMessage();
                continue;
            }

            if (/такого адреса нет/i.test(searchHtml)) {
                return {
                    found: false,
                    cadastralNumber: normalized,
                    message: "Объект не найден в ИАС «База N» (kadbase.ru)",
                    searchUrl: buildKadbaseSearchUrl(normalized),
                    source: "kadbase.ru"
                };
            }

            if (finalUrl.includes("/object-")) {
                const objectUrl = finalUrl.split("?")[0];
                const objectPath = new URL(objectUrl).pathname;
                if (!/такого адреса нет/i.test(searchHtml)) {
                    await savePathCache(normalized, objectPath);
                    return mapKadbaseObject(searchHtml, normalized, objectUrl);
                }
            }

            const objectPath = extractObjectPathFromSearchHtml(searchHtml, normalized);
            if (!objectPath) {
                lastError =
                    searchRes.status >= 500
                        ? "kadbase.ru вернул ошибку сервера (HTTP 500). Повторите поиск позже."
                        : isLoginRedirect(finalUrl)
                          ? buildAccessLimitedMessage()
                          : "Не удалось определить карточку объекта на kadbase.ru (нет ссылки в ответе поиска)";
                continue;
            }

            const mapped = await fetchKadbaseObjectPage(objectPath, normalized, cookieJar);
            if (mapped) {
                await savePathCache(normalized, objectPath);
                return mapped;
            }

            lastError = "kadbase.ru не отдал карточку объекта";
        }

        if (rosreestrAddress) {
            const directPaths = buildKadbaseObjectPathVariants(normalized, rosreestrAddress);
            const fromDirect = await tryLoadObjectPaths(directPaths, normalized, cookieJar, "direct-url");
            if (fromDirect) return fromDirect;
        }

        if (cachedPath) {
            const fromCache = await tryLoadObjectPaths([cachedPath], normalized, cookieJar, "cache");
            if (fromCache) return fromCache;
        }

        return {
            found: false,
            cadastralNumber: normalized,
            message: lastError || buildAccessLimitedMessage(),
            searchUrl: buildKadbaseSearchUrl(normalized),
            source: "kadbase.ru",
            accessLimited: true
        };
    } catch (err) {
        return {
            found: false,
            cadastralNumber: normalized,
            message: err.message || "Ошибка запроса к kadbase.ru",
            searchUrl: buildKadbaseSearchUrl(normalized),
            source: "kadbase.ru"
        };
    }
}
