/**
 * График отсутствий ГЛ ЦООП на 2026.
 * Ключ — фамилия (первое слово ФИО из столбца Y).
 */

const YEAR = 2026;

/** «12.03-14.03; 14.08; 02.07.» → периоды YYYY-MM-DD. */
export function parseVacCell(text, year = YEAR) {
    const out = [];
    for (const part of String(text || "").split(";")) {
        const s = part.trim();
        if (!s) continue;
        const range = s.match(/^(\d{1,2})\.(\d{1,2})\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.?$/);
        if (range) {
            const from = `${year}-${String(range[2]).padStart(2, "0")}-${String(range[1]).padStart(2, "0")}`;
            const to = `${year}-${String(range[4]).padStart(2, "0")}-${String(range[3]).padStart(2, "0")}`;
            out.push({ from, to });
            continue;
        }
        const one = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
        if (one) {
            const d = `${year}-${String(one[2]).padStart(2, "0")}-${String(one[1]).padStart(2, "0")}`;
            out.push({ from: d, to: d });
        }
    }
    return out;
}

function periods(...cells) {
    return cells.flatMap((c) => parseVacCell(c));
}

export function vacationSurname(fio) {
    return String(fio || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")[0]
        .replace(/ё/g, "е");
}

export const BUILTIN_VACATIONS = {
    Горчагова: periods("12.03-14.03", "22.04-30.04", "05.08-07.08; 14.08; 17.08-30.08", "16.11-22.11", "14.12-18.12"),
    Вавинова: periods("13.02-15.02", "04.05-11.05", "26.06-30.06", "01.07-12.07", "12.10-18.10"),
    Филинюк: periods("09.03-22.03; 26.03-27.03", "23.04-24.04", "01.06-02.06; 10.06; 24.06", "02.07.", "10.08-15.08", "09.11-22.11"),
    Пасхина: periods("03.08-10.08", "04.09.", "05.10-11.10", "28.12-30.12"),
    Пирогова: periods("25.05.", "26.06.", "15.07-17.07; 20.07-31.07", "01.08-02.08", "19.10-31.10", "01.11."),
    Сироткина: periods("06.04.-19.04", "22.06.", "21.08-31.08", "01.09-06.09"),
    Волчкова: periods("24.02-28.02", "01.03-06.03", "17.04; 20.04-30.04", "17.08-31.08", "01.09-04.09", "29.10-31.10", "01.11-03.11"),
    Волков: periods("16.09-29.09", "16.11-29.11")
};

function asList(vacation) {
    if (!vacation) return [];
    const list = Array.isArray(vacation) ? vacation : [vacation];
    return list.filter((p) => p?.from && p?.to);
}

/** overrides[полное ФИО] перекрывает системный график (в т.ч. пустой массив). */
export function resolveVacations(fio, overrides = {}) {
    if (Object.prototype.hasOwnProperty.call(overrides, fio)) return asList(overrides[fio]);
    const key = vacationSurname(fio);
    return BUILTIN_VACATIONS[key] ? BUILTIN_VACATIONS[key].map((p) => ({ ...p })) : [];
}
