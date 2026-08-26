/**
 * Нагрузка сотрудников ГЛ ЦООП.
 * ponytail: рабочие дни = пн–пт минус ТК ст. 112 и переносы Правительства (2025–2026).
 */

import { isGlEmployee, resolveVacations } from "./gl-vacations.mjs";

export const HOURS_PER_WORKDAY = 8;
export const MINUTES_PER_HOUR = 60;
export const MIN_OSMOTR = 20; // Z Осмотры
export const MIN_L1 = 24; // Z 1-я линия поддержки
export const MIN_MDO = 20; // MDO без Арбитраж/ФЖН
export const MIN_ARB = 150; // тег Арбитраж в MDO
export const MIN_FZH = 240; // тег ФЖН в MDO
export const MIN_OO = 20; // ОО без Арбитраж
export const MIN_OO_ARB = 210; // тег Арбитраж в ОО
export const FIO_COL = 24; // Excel Y
export const Z_COL = 25; // Excel Z — рабочая группа / тип ГЛ
export const S_COL = 18; // Excel S — начало срока
export const T_COL = 19; // Excel T — конец срока
export const W_COL = 22; // Excel W — возвраты
export const AG_COL = 32; // Excel AG — просрочка
export const AH_COL = 33; // Excel AH
export const AF_COL = 31; // Excel AF — сегмент и ТБ
export const AN_COL = 39; // Excel AN — CSI 1–5
export const AL_COL = 37; // Excel AL — приоритет
export const AC_COL = 28; // Excel AC — дата создания / поступление
export const SEGMENTS = ["ММБ", "КСБ", "ПМЗ", "ЗС", "ПКД", "ПРПА", "Прочее"];
export const TERR_BANKS = ["МБ", "СРБ", "ВВБ", "ПБ", "УБ", "СБ", "ББ", "ДВБ", "СЗБ", "ЮЗБ", "ЦЧБ", "ТМ"];
export const ARRIVAL_HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Доп. нерабочие дни (переносы Правительства). Базовые праздники — ТК РФ ст. 112. */
const RU_EXTRA_OFF = new Set([
    "2026-01-09",
    "2026-03-09",
    "2026-05-11",
    "2026-12-31"
]);

function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function isTkHoliday(date) {
    const m = date.getMonth() + 1;
    const d = date.getDate();
    if (m === 1 && d >= 1 && d <= 8) return true;
    if (m === 2 && d === 23) return true;
    if (m === 3 && d === 8) return true;
    if (m === 5 && (d === 1 || d === 9)) return true;
    if (m === 6 && d === 12) return true;
    if (m === 11 && d === 4) return true;
    return false;
}

export function isArbitrationCell(value) {
    return /арбитраж/i.test(String(value ?? "").trim());
}

export function isFzhCell(value) {
    return /фжн/i.test(String(value ?? "").trim());
}

/** Столбец с заголовком «Тег»; иначе AH. */
export function findTagColumn(headers) {
    for (let i = 0; i < (headers?.length ?? 0); i++) {
        if (/^тег$/i.test(String(headers[i] ?? "").trim())) return i;
    }
    return AH_COL;
}

function normFio(fio) {
    return String(fio || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

export function isVolkov(fio) {
    return /волков\s+артем(\s+анатольевич|\s+а\.?|\s*$)/.test(normFio(fio));
}

export function isVolchkova(fio) {
    // ponytail: JS \b is ASCII-only even with /u; lookaround is the Cyrillic word match
    return /(?<!\p{L})волчкова(?!\p{L})/u.test(normFio(fio));
}

/** Тип ГЛ по рабочей группе (столбец Z), не по имени файла. */
export function fileKind(label) {
    const n = String(label || "")
        .toLowerCase()
        .replace(/ё/g, "е");
    if (/1[-\s]?я\s*линия|первая\s*линия|линия\s*поддержк/.test(n)) return "l1";
    if (/онлайн[-\s]*оценк|работа\s*с\s*оо(?![а-яa-z])/.test(n)) return "oo";
    if (/осмотр/.test(n)) return "osmotr";
    if (/залогов|экспертиз|\bmdo\b/.test(n)) return "mdo";
    return "mdo";
}

export function isFirstLineFile(label) {
    return fileKind(label) === "l1";
}

/** Имя линии: часть имени файла до «_», без расширения. Только для бейджей загрузки. */
export function lineNameFromFile(filename) {
    const base = String(filename || "").replace(/\.(xlsx|xls)$/i, "").trim();
    const i = base.indexOf("_");
    const name = (i >= 0 ? base.slice(0, i) : base).trim();
    return name || base;
}

export function lineNameFromZ(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim() || "Без группы";
}

/** Минуты на заявку по типу ГЛ (Z) и тегу. */
export function minutesForApp(line, _fio, ahValue) {
    const kind = fileKind(line);
    const arb = isArbitrationCell(ahValue);
    const fzh = isFzhCell(ahValue);
    if (kind === "l1") return MIN_L1;
    if (kind === "osmotr") return MIN_OSMOTR;
    if (kind === "oo") return arb ? MIN_OO_ARB : MIN_OO;
    if (fzh) return MIN_FZH;
    if (arb) return MIN_ARB;
    return MIN_MDO;
}

export function loadPctFromMinutes(factMinutes, planHours) {
    const planMin = planHours * MINUTES_PER_HOUR;
    if (planMin <= 0) return factMinutes > 0 ? 999 : 0;
    return (factMinutes / planMin) * 100;
}

export function fioFromCell(value) {
    const raw = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!raw || raw === "-" || raw === "—") return "";
    return raw.split("(")[0].trim();
}

export function findFioColumn(headers, sampleRows) {
    const cols = Math.max(headers.length, ...sampleRows.map((r) => r.length), 0);
    for (let i = 0; i < cols; i++) {
        if (/фио|сотрудник|исполнитель|эксперт|закрепл/i.test(String(headers[i] || ""))) return i;
    }
    if (cols > FIO_COL) return FIO_COL;
    for (let i = 0; i < cols; i++) {
        let hits = 0;
        let seen = 0;
        for (const row of sampleRows) {
            const v = row[i];
            if (v == null || v === "") continue;
            seen += 1;
            if (/\(.*\d/.test(String(v))) hits += 1;
        }
        if (seen >= 5 && hits / seen >= 0.5) return i;
    }
    return cols > FIO_COL ? FIO_COL : -1;
}

export function startOfQuarter(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const q = Math.floor(d.getMonth() / 3) * 3;
    return new Date(d.getFullYear(), q, 1);
}

export function isWorkday(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    if (isTkHoliday(date)) return false;
    if (RU_EXTRA_OFF.has(ymd(date))) return false;
    return true;
}

/** Inclusive [from, to] Monday–Friday count. */
export function countWorkdays(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    if (b < a) return 0;
    let n = 0;
    for (const cur = new Date(a); cur <= b; cur.setDate(cur.getDate() + 1)) {
        if (isWorkday(cur)) n += 1;
    }
    return n;
}

export function parseExcelDateTime(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value === "number" && Number.isFinite(value)) {
        const ms = Math.round((value - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return null;
        return new Date(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours(),
            d.getUTCMinutes(),
            d.getUTCSeconds()
        );
    }
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
        return new Date(
            Number(iso[1]),
            Number(iso[2]) - 1,
            Number(iso[3]),
            Number(iso[4] || 0),
            Number(iso[5] || 0),
            Number(iso[6] || 0)
        );
    }
    const ru = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ru) {
        return new Date(
            Number(ru[3]),
            Number(ru[2]) - 1,
            Number(ru[1]),
            Number(ru[4] || 0),
            Number(ru[5] || 0),
            Number(ru[6] || 0)
        );
    }
    return null;
}

export function parseExcelDate(value) {
    const d = parseExcelDateTime(value);
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** T − S в часах. */
export function termHoursFromST(sValue, tValue) {
    const s = parseExcelDateTime(sValue);
    const t = parseExcelDateTime(tValue);
    if (!s || !t) return null;
    return (t.getTime() - s.getTime()) / 3600000;
}

export function termDaysFromST(sValue, tValue) {
    const h = termHoursFromST(sValue, tValue);
    return h == null ? null : h / 24;
}

export function isOverdueCell(value) {
    return /^да$/i.test(String(value ?? "").trim());
}

export function numberCell(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const s = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

export function csiScore(value) {
    if (value == null || value === "") return null;
    const n = typeof value === "number" ? value : numberCell(value);
    if (!Number.isFinite(n) || n < 1 || n > 5) return null;
    return n;
}

export function csiBucket(value) {
    const n = csiScore(value);
    if (n == null) return null;
    const r = Math.round(n);
    return r >= 1 && r <= 5 ? r : null;
}

export function isPriorityCell(value) {
    return /приоритет/i.test(String(value ?? ""));
}

export function tbFromAF(value) {
    const s = String(value ?? "")
        .toLowerCase()
        .replace(/ё/g, "е");
    const rules = [
        [/центрально[-\s]?черноземн/, "ЦЧБ"],
        [/дальневосточн/, "ДВБ"],
        [/северо[-\s]?западн/, "СЗБ"],
        [/юго[-\s]?западн/, "ЮЗБ"],
        [/волго[-\s]?вятск/, "ВВБ"],
        [/среднерусск/, "СРБ"],
        [/поволжск/, "ПБ"],
        [/уральск/, "УБ"],
        [/байкальск/, "ББ"],
        [/сибирск/, "СБ"],
        [/московск/, "МБ"],
        [/центрального\s+подчинен|подразделен\w*\s+центральн/, "ТМ"]
    ];
    for (const [re, code] of rules) {
        if (re.test(s)) return code;
    }
    return null;
}

export function segmentFromAF(value) {
    const s = String(value ?? "")
        .toLowerCase()
        .replace(/ё/g, "е");
    // ponytail: порядок снимает пересечения (малого/залоговой раньше корпоративн).
    if (s.includes("малого") || /(^|[^а-яa-z])ммб([^а-яa-z]|$)/i.test(s)) return "ММБ";
    if (s.includes("данных")) return "ПМЗ";
    if (s.includes("документарных")) return "ПКД";
    if (s.includes("залоговой")) return "ЗС";
    if (s.includes("проблем")) return "ПРПА";
    if (s.includes("корпоративн") || /(^|[^а-яa-z])ксб([^а-яa-z]|$)/i.test(s)) return "КСБ";
    return "Прочее";
}

function emptySegCounts() {
    return { ММБ: 0, КСБ: 0, ПМЗ: 0, ЗС: 0, ПКД: 0, ПРПА: 0, Прочее: 0 };
}

function emptyCsiCounts() {
    return [0, 0, 0, 0, 0];
}

function emptyTbCounts() {
    return Object.fromEntries(TERR_BANKS.map((c) => [c, 0]));
}

function emptyHourCounts() {
    return Object.fromEntries(ARRIVAL_HOURS.map((h) => [h, 0]));
}

function emptyWeekdayCounts() {
    return Object.fromEntries(WEEKDAYS.map((d) => [d, 0]));
}

function emptyKpiBucket() {
    return { apps: 0, termSum: 0, termN: 0, overdue: 0, returns: 0, csiCounts: emptyCsiCounts() };
}

function addToBucket(dst, hours, overdue, returns, bucket) {
    dst.apps += 1;
    if (hours != null) {
        dst.termSum += hours;
        dst.termN += 1;
    }
    if (overdue) dst.overdue += 1;
    dst.returns += returns;
    if (bucket) dst.csiCounts[bucket - 1] += 1;
}

function headerLooksLikeDate(header) {
    return /дат|создан|регистр|поступ|завед/i.test(String(header || ""));
}

export function findDateColumn(headers, sampleRows) {
    const cols = Math.max(headers.length, ...sampleRows.map((r) => r.length), 0);
    for (let i = 0; i < cols; i++) {
        if (headerLooksLikeDate(headers[i])) return i;
    }
    let best = -1;
    let bestHits = 0;
    for (let i = 0; i < cols; i++) {
        if (i === FIO_COL) continue;
        let hits = 0;
        let seen = 0;
        for (const row of sampleRows) {
            const v = row[i];
            if (v == null || v === "") continue;
            seen += 1;
            if (parseExcelDate(v)) hits += 1;
        }
        if (seen >= 5 && hits / seen >= 0.6 && hits > bestHits) {
            best = i;
            bestHits = hits;
        }
    }
    return best;
}

/**
 * @param {Array<{file:string, sheet:string, headers:any[], rows:any[][]}>} tables
 * @param {Date} [now]
 */
export function aggregateEmployeeLoad(tables, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const qStart = startOfQuarter(today);
    const workdays = Math.max(countWorkdays(qStart, today), 1);
    const planHours = HOURS_PER_WORKDAY * workdays;
    const counts = new Map();
    let skippedNoFio = 0;
    let skippedNotGl = 0;
    let skippedOutOfQuarter = 0;
    let used = 0;
    let usedArb = 0;
    let usedL1 = 0;
    const dateCol = T_COL;
    const dateHeader = "T";
    const segments = { mdo: emptySegCounts(), l1: emptySegCounts(), oo: emptySegCounts() };
    const priorities = { КСБ: emptyTbCounts(), ММБ: emptyTbCounts() };
    const priorityTotals = { КСБ: 0, ММБ: 0 };
    const byHour = emptyHourCounts();
    const byWeekday = emptyWeekdayCounts();

    for (const table of tables) {
        const sample = table.rows.slice(0, 40);
        const fioCol = table.fioCol >= 0 ? table.fioCol : findFioColumn(table.headers, sample);
        const tagCol = findTagColumn(table.headers);
        for (const row of table.rows) {
            const fio = fioFromCell(fioCol >= 0 ? row[fioCol] : row[FIO_COL]);
            if (!fio) {
                skippedNoFio += 1;
                continue;
            }
            if (!isGlEmployee(fio)) {
                skippedNotGl += 1;
                continue;
            }
            const dt = parseExcelDate(row[T_COL]);
            if (!dt || dt < qStart || dt > today) {
                skippedOutOfQuarter += 1;
                continue;
            }
            const line = lineNameFromZ(row[Z_COL]);
            const kind = fileKind(line);
            const tagVal = row[tagCol];
            const mins = minutesForApp(line, fio, tagVal);
            const arb = isArbitrationCell(tagVal);
            const fzh = isFzhCell(tagVal);
            const cur = counts.get(fio) || {
                apps: 0,
                minutes: 0,
                appsArb: 0,
                appsFzh: 0,
                appsL1: 0,
                appsOo: 0,
                termSum: 0,
                termN: 0,
                overdue: 0,
                returns: 0,
                csiCounts: emptyCsiCounts(),
                files: {}
            };
            const hours = termHoursFromST(row[S_COL], row[T_COL]);
            const overdue = isOverdueCell(row[AG_COL]);
            const returns = numberCell(row[W_COL]);
            const bucket = csiBucket(row[AN_COL]);
            cur.minutes += mins;
            if (kind === "l1") cur.appsL1 += 1;
            else if (kind === "oo") {
                cur.appsOo += 1;
                if (arb) cur.appsArb += 1;
            } else if (kind === "mdo") {
                if (fzh) cur.appsFzh += 1;
                else if (arb) cur.appsArb += 1;
            }
            if (kind === "mdo" && (arb || fzh)) usedArb += 1;
            if (kind === "l1") usedL1 += 1;
            addToBucket(cur, hours, overdue, returns, bucket);
            const fb = cur.files[line] || emptyKpiBucket();
            addToBucket(fb, hours, overdue, returns, bucket);
            fb.kind = kind;
            cur.files[line] = fb;
            if (segments[kind]) segments[kind][segmentFromAF(row[AF_COL])] += 1;
            if (isPriorityCell(row[AL_COL])) {
                const seg = segmentFromAF(row[AF_COL]);
                const tb = tbFromAF(row[AF_COL]);
                if ((seg === "КСБ" || seg === "ММБ") && tb) {
                    priorities[seg][tb] += 1;
                    priorityTotals[seg] += 1;
                }
            }
            const arrived = parseExcelDateTime(row[AC_COL]);
            if (arrived) {
                byHour[ARRIVAL_HOURS[arrived.getHours()]] += 1;
                byWeekday[WEEKDAYS[(arrived.getDay() + 6) % 7]] += 1;
            }
            counts.set(fio, cur);
            used += 1;
        }
    }

    const employees = [...counts.entries()]
        .map(([fio, c]) => {
            const loadPct = loadPctFromMinutes(c.minutes, planHours);
            return {
                fio,
                apps: c.apps,
                appsArb: c.appsArb,
                appsFzh: c.appsFzh,
                appsL1: c.appsL1,
                appsOo: c.appsOo,
                minutes: c.minutes,
                plan: planHours,
                planHours,
                loadPct,
                termSum: c.termSum,
                termN: c.termN,
                avgTermHours: c.termN ? c.termSum / c.termN : null,
                overdue: c.overdue,
                returns: c.returns,
                csiCounts: [...c.csiCounts],
                files: c.files
            };
        })
        .sort((a, b) => b.loadPct - a.loadPct || a.fio.localeCompare(b.fio, "ru"));
    let termSum = 0;
    let termN = 0;
    let overdueTotal = 0;
    let returnsTotal = 0;
    const csiCounts = emptyCsiCounts();
    const fileMap = new Map();
    for (const e of employees) {
        termSum += e.termSum;
        termN += e.termN;
        overdueTotal += e.overdue;
        returnsTotal += e.returns;
        for (let i = 0; i < 5; i++) csiCounts[i] += e.csiCounts[i];
        for (const [file, b] of Object.entries(e.files || {})) {
            const cur = fileMap.get(file) || emptyKpiBucket();
            cur.apps += b.apps;
            cur.termSum += b.termSum;
            cur.termN += b.termN;
            cur.overdue += b.overdue;
            cur.returns += b.returns;
            for (let i = 0; i < 5; i++) cur.csiCounts[i] += b.csiCounts[i];
            if (b.kind) cur.kind = b.kind;
            fileMap.set(file, cur);
        }
    }
    const files = [...fileMap.entries()]
        .map(([file, c]) => ({
            file,
            kind: c.kind || fileKind(file),
            apps: c.apps,
            avgTermHours: c.termN ? c.termSum / c.termN : null,
            overdue: c.overdue,
            returns: c.returns,
            csiCounts: [...c.csiCounts]
        }))
        .sort((a, b) => b.apps - a.apps || a.file.localeCompare(b.file, "ru"));
    const lines = files.map((f) => ({ name: f.file, apps: f.apps }));
    const linesTotal = files.reduce((s, f) => s + f.apps, 0);

    return {
        qStart,
        today,
        workdays,
        hoursPerDay: HOURS_PER_WORKDAY,
        plan: planHours,
        planHours,
        employees,
        files,
        lines,
        linesTotal,
        used,
        skippedNoFio,
        skippedOutOfQuarter,
        skippedNotGl,
        usedArb,
        usedL1,
        avgTermHours: termN ? termSum / termN : null,
        overdueTotal,
        returnsTotal,
        csiCounts,
        segments,
        priorities,
        priorityTotals,
        byHour,
        byWeekday,
        dateCol,
        dateHeader,
        hasDateFilter: true
    };
}

function asDay(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    return parseExcelDate(value);
}

/** Старый формат {from,to} или список периодов. */
export function vacationsAsList(vacation) {
    if (!vacation) return [];
    const list = Array.isArray(vacation) ? vacation : [vacation];
    return list.filter((p) => p?.from && p?.to);
}

/** Отработанные часы: 8 ч × рабочие дни квартала минус отсутствия (без двойного счёта пересечений). */
export function employeePlan(qStart, today, vacation) {
    const total = countWorkdays(qStart, today);
    const off = new Set();
    for (const p of vacationsAsList(vacation)) {
        const from = asDay(p.from);
        const to = asDay(p.to);
        if (!from || !to || to < from) continue;
        const a = from < qStart ? qStart : from;
        const b = to > today ? today : to;
        if (b < a) continue;
        for (const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate()); cur <= b; cur.setDate(cur.getDate() + 1)) {
            if (isWorkday(cur)) off.add(ymd(cur));
        }
    }
    const days = Math.max(total - off.size, 0);
    const planHours = HOURS_PER_WORKDAY * days;
    return { workdays: days, plan: planHours, planHours, vacationDays: off.size };
}

export function withVacations(agg, vacationsByFio) {
    const map = vacationsByFio || {};
    const employees = agg.employees
        .map((e) => {
            const periods = resolveVacations(e.fio, map);
            if (!periods.length) return { ...e, vacationDays: 0, vacations: [] };
            const p = employeePlan(agg.qStart, agg.today, periods);
            const loadPct = loadPctFromMinutes(e.minutes, p.planHours);
            return {
                ...e,
                plan: p.planHours,
                planHours: p.planHours,
                workdays: p.workdays,
                loadPct,
                vacationDays: p.vacationDays,
                vacations: periods,
                vacation: periods[0]
            };
        })
        .sort((a, b) => b.loadPct - a.loadPct || a.fio.localeCompare(b.fio, "ru"));
    return { ...agg, employees };
}
