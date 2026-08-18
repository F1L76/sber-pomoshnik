import {
    fioFromCell,
    startOfQuarter,
    countWorkdays,
    parseExcelDate,
    findDateColumn,
    findFioColumn,
    isWorkday,
    aggregateEmployeeLoad,
    PLAN_APPS_PER_WORKDAY,
    FIO_COL
} from "../lib/gl-load.mjs";

const now = new Date(2026, 7, 18); // 18 авг 2026
const q = startOfQuarter(now);
if (q.getFullYear() !== 2026 || q.getMonth() !== 6 || q.getDate() !== 1) {
    throw new Error(`startOfQuarter: ${q.toISOString()}`);
}
if (fioFromCell("Иванов И. И. (620620)") !== "Иванов И. И.") {
    throw new Error("fioFromCell paren");
}
if (fioFromCell("  Петров П.П.  ") !== "Петров П.П.") throw new Error("fioFromCell trim");

const d = parseExcelDate("15.07.2026");
if (!d || d.getFullYear() !== 2026 || d.getMonth() !== 6 || d.getDate() !== 15) {
    throw new Error("parseExcelDate ru");
}

const headers = Array(25).fill("");
headers[0] = "ID";
headers[3] = "Дата создания";
headers[FIO_COL] = "Исполнитель";
const sample = [
    ["1", "", "", "01.07.2026"],
    ["2", "", "", "02.07.2026"],
    ["3", "", "", "03.07.2026"],
    ["4", "", "", "04.07.2026"],
    ["5", "", "", "07.07.2026"]
].map((r) => {
    const row = Array(25).fill("");
    r.forEach((v, i) => {
        row[i] = v;
    });
    return row;
});
if (!isWorkday(new Date(2026, 0, 9))) {
    /* 9 янв 2026 — перенос с 3 января */
} else {
    throw new Error("Jan 9 2026 should be off");
}
if (isWorkday(new Date(2026, 0, 12)) !== true) throw new Error("Jan 12 2026 should work");
if (findDateColumn(headers, sample) !== 3) throw new Error("findDateColumn header");
if (findFioColumn(headers, sample) !== FIO_COL) throw new Error("findFioColumn");

const rows = [];
for (let i = 0; i < 48; i++) {
    const row = Array(25).fill("");
    row[3] = "10.07.2026";
    row[FIO_COL] = "Сидоров С.С. (111)";
    rows.push(row);
}
const out = aggregateEmployeeLoad([{ file: "a.xlsx", sheet: "S", headers, rows }], now);
const workdays = countWorkdays(q, now);
if (out.workdays !== workdays) throw new Error(`workdays ${out.workdays} != ${workdays}`);
if (out.plan !== PLAN_APPS_PER_WORKDAY * workdays) throw new Error("plan");
if (out.employees.length !== 1 || out.employees[0].apps !== 48) throw new Error("apps");
const expectPct = (48 / out.plan) * 100;
if (Math.abs(out.employees[0].loadPct - expectPct) > 1e-9) throw new Error("pct");

console.log("gl-load selfcheck ok", {
    workdays,
    plan: out.plan,
    loadPct: Number(expectPct.toFixed(2))
});
