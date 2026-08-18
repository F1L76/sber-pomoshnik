/**
 * Нагрузка сотрудников ГЛ ЦООП.
 * ponytail: рабочие дни = пн–пт минус ТК ст. 112 и переносы Правительства (2025–2026).
 */

export const HOURS_PER_WORKDAY = 8;
export const MINUTES_PER_HOUR = 60;
export const MIN_L1 = 24; // файл 1-я линия поддержки
export const MIN_MDO = 20; // файл Залоговая экспертиза MDO
export const MIN_ARB = 150; // тег Арбитраж в MDO
export const MIN_VOLKOV = 240; // Волков Артём Анатольевич, MDO
export const MIN_OO = 210; // файл Работа с ОО
export const MIN_VOLCHKOVA = 210; // Волчкова — любая заявка
export const MIN_APPS_FOR_LOAD = 30; // в таблице только сотрудники с заявками сверх этого
export const FIO_COL = 24; // Excel Y
export const AH_COL = 33; // Excel AH

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

export function fileKind(filename) {
    const n = String(filename || "").toLowerCase();
    if (/1[-\s]?я\s*линия|первая\s*линия|линия\s*поддержк/.test(n)) return "l1";
    if (/работа\s*с\s*оо/.test(n)) return "oo";
    if (/залогов|экспертиз|\bmdo\b/.test(n)) return "mdo";
    return "mdo";
}

export function isFirstLineFile(filename) {
    return fileKind(filename) === "l1";
}

/** Минуты на заявку по файлу / тегу / сотруднику. */
export function minutesForApp(filename, fio, ahValue) {
    if (isVolchkova(fio)) return MIN_VOLCHKOVA;
    const kind = fileKind(filename);
    if (kind === "l1") return MIN_L1;
    if (kind === "oo") return MIN_OO;
    if (isVolkov(fio)) return MIN_VOLKOV;
    if (isArbitrationCell(ahValue)) return MIN_ARB;
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

export function parseExcelDate(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        // Excel serial (Windows 1900)
        const ms = Math.round((value - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return null;
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const ru = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));
    return null;
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
    let skippedOutOfQuarter = 0;
    let used = 0;
    let usedArb = 0;
    let usedL1 = 0;
    let dateCol = -1;
    let dateHeader = "";

    for (const table of tables) {
        const sample = table.rows.slice(0, 40);
        const fioCol = table.fioCol >= 0 ? table.fioCol : findFioColumn(table.headers, sample);
        const col = findDateColumn(table.headers, sample);
        if (dateCol < 0 && col >= 0) {
            dateCol = col;
            dateHeader = String(table.headers[col] ?? `столбец ${col + 1}`);
        }
        const useCol = col >= 0 ? col : dateCol;
        const kind = fileKind(table.file);
        const tagCol = findTagColumn(table.headers);
        for (const row of table.rows) {
            const fio = fioFromCell(fioCol >= 0 ? row[fioCol] : row[FIO_COL]);
            if (!fio) {
                skippedNoFio += 1;
                continue;
            }
            if (useCol >= 0) {
                const dt = parseExcelDate(row[useCol]);
                if (dt && (dt < qStart || dt > today)) {
                    skippedOutOfQuarter += 1;
                    continue;
                }
            }
            const tagVal = row[tagCol];
            const mins = minutesForApp(table.file, fio, tagVal);
            const arb = kind === "mdo" && isArbitrationCell(tagVal);
            const cur = counts.get(fio) || {
                apps: 0,
                minutes: 0,
                appsArb: 0,
                appsL1: 0,
                appsOo: 0
            };
            cur.apps += 1;
            cur.minutes += mins;
            if (kind === "l1") cur.appsL1 += 1;
            else if (kind === "oo") cur.appsOo += 1;
            else if (arb) cur.appsArb += 1;
            if (arb) usedArb += 1;
            if (kind === "l1") usedL1 += 1;
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
                appsL1: c.appsL1,
                appsOo: c.appsOo,
                minutes: c.minutes,
                workUnits: c.minutes / (HOURS_PER_WORKDAY * MINUTES_PER_HOUR),
                plan: planHours,
                planHours,
                loadPct
            };
        })
        .filter((e) => e.apps > MIN_APPS_FOR_LOAD)
        .sort((a, b) => b.loadPct - a.loadPct || a.fio.localeCompare(b.fio, "ru"));
    const skippedLowVolume = counts.size - employees.length;

    return {
        qStart,
        today,
        workdays,
        hoursPerDay: HOURS_PER_WORKDAY,
        plan: planHours,
        planHours,
        employees,
        used,
        skippedNoFio,
        skippedOutOfQuarter,
        skippedLowVolume,
        usedArb,
        usedL1,
        dateCol,
        dateHeader,
        hasDateFilter: dateCol >= 0
    };
}

function asDay(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    return parseExcelDate(value);
}

/** Отработанные часы: 8 ч × рабочие дни квартала минус отпуск. */
export function employeePlan(qStart, today, vacation) {
    const total = countWorkdays(qStart, today);
    let off = 0;
    if (vacation?.from && vacation?.to) {
        const from = asDay(vacation.from);
        const to = asDay(vacation.to);
        if (from && to && to >= from) {
            const a = from < qStart ? qStart : from;
            const b = to > today ? today : to;
            if (b >= a) off = countWorkdays(a, b);
        }
    }
    const days = Math.max(total - off, 0);
    const planHours = HOURS_PER_WORKDAY * days;
    return { workdays: days, plan: planHours, planHours, vacationDays: off };
}

export function withVacations(agg, vacationsByFio) {
    const map = vacationsByFio || {};
    const employees = agg.employees
        .map((e) => {
            const v = map[e.fio];
            if (!v) return { ...e, vacationDays: 0 };
            const p = employeePlan(agg.qStart, agg.today, v);
            const loadPct = loadPctFromMinutes(e.minutes, p.planHours);
            return {
                ...e,
                plan: p.planHours,
                planHours: p.planHours,
                workdays: p.workdays,
                loadPct,
                vacationDays: p.vacationDays,
                vacation: v
            };
        })
        .sort((a, b) => b.loadPct - a.loadPct || a.fio.localeCompare(b.fio, "ru"));
    return { ...agg, employees };
}
