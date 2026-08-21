import {
    fioFromCell,
    startOfQuarter,
    countWorkdays,
    parseExcelDate,
    findDateColumn,
    findFioColumn,
    isWorkday,
    aggregateEmployeeLoad,
    employeePlan,
    withVacations,
    isFirstLineFile,
    fileKind,
    minutesForApp,
    isVolkov,
    isVolchkova,
    findTagColumn,
    termHoursFromST,
    isOverdueCell,
    numberCell,
    csiScore,
    segmentFromAF,
    HOURS_PER_WORKDAY,
    MIN_APPS_FOR_LOAD,
    FIO_COL,
    S_COL,
    T_COL,
    W_COL,
    AG_COL,
    AN_COL,
    AF_COL,
    AH_COL
} from "../lib/gl-load.mjs";

function repeatRow(row, n) {
    return Array.from({ length: n }, () => {
        const copy = [...row];
        if (!copy[T_COL]) copy[T_COL] = copy[3] || "10.07.2026";
        return copy;
    });
}

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
for (let i = 0; i < MIN_APPS_FOR_LOAD + 1; i++) {
    const row = Array(25).fill("");
    row[3] = "10.07.2026";
    row[T_COL] = "10.07.2026";
    row[FIO_COL] = "Сидоров С.С. (111)";
    rows.push(row);
}
const out = aggregateEmployeeLoad([{ file: "a.xlsx", sheet: "S", headers, rows }], now);
const workdays = countWorkdays(q, now);
if (out.workdays !== workdays) throw new Error(`workdays ${out.workdays} != ${workdays}`);
if (out.plan !== HOURS_PER_WORKDAY * workdays) throw new Error("plan hours");
if (out.employees.length !== 1 || out.employees[0].apps !== MIN_APPS_FOR_LOAD + 1) throw new Error("apps");
const expectPct = ((MIN_APPS_FOR_LOAD + 1) * 20) / (workdays * 8 * 60) * 100;
if (Math.abs(out.employees[0].loadPct - expectPct) > 1e-9) throw new Error("pct");

const few = Array(25).fill("");
few[3] = "10.07.2026";
few[T_COL] = "10.07.2026";
few[FIO_COL] = "Малозаявочный М.М. (1)";
const outFew = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(few, MIN_APPS_FOR_LOAD) }],
    now
);
if (outFew.employees.length !== 0) throw new Error("40 apps excluded");
if (outFew.skippedLowVolume !== 1) throw new Error("skippedLowVolume");
const outEnough = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(few, MIN_APPS_FOR_LOAD + 1) }],
    now
);
if (outEnough.employees.length !== 1 || outEnough.employees[0].apps !== MIN_APPS_FOR_LOAD + 1) throw new Error("41 apps included");
const mix = Array(25).fill("");
mix[3] = "10.07.2026";
mix[T_COL] = "10.07.2026";
mix[FIO_COL] = "Смешанный С.С. (9)";
const outMixFew = aggregateEmployeeLoad(
    [
        { file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(mix, 20) },
        { file: "1-я линия.xlsx", sheet: "S", headers, rows: repeatRow(mix, 10) }
    ],
    now
);
if (outMixFew.employees.length !== 0) throw new Error("20+10 across files excluded");
const outMixOk = aggregateEmployeeLoad(
    [
        { file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(mix, 20) },
        { file: "1-я линия.xlsx", sheet: "S", headers, rows: repeatRow(mix, MIN_APPS_FOR_LOAD + 1 - 20) }
    ],
    now
);
if (outMixOk.employees.length !== 1 || outMixOk.employees[0].apps !== MIN_APPS_FOR_LOAD + 1) throw new Error("mix across files included");

const arbRow = Array(34).fill("");
arbRow[3] = "10.07.2026";
arbRow[T_COL] = "10.07.2026";
arbRow[FIO_COL] = "Сидоров С.С. (111)";
arbRow[33] = "Арбитраж";
const outArb = aggregateEmployeeLoad(
    [{ file: "a.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: [...rows, arbRow] }],
    now
);
const expectArb = (((MIN_APPS_FOR_LOAD + 1) * 20 + 150) / (workdays * 8 * 60)) * 100;
if (outArb.employees[0].appsArb !== 1) throw new Error("appsArb");
if (Math.abs(outArb.employees[0].loadPct - expectArb) > 1e-6) throw new Error("arb pct");

const arbContainsRow = Array(34).fill("");
arbContainsRow[3] = "10.07.2026";
arbContainsRow[FIO_COL] = "Иванов И.И. (222)";
arbContainsRow[AH_COL] = "Арбитраж, срочно";
const outArbContains = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(arbContainsRow, MIN_APPS_FOR_LOAD + 1) }],
    now
);
if (outArbContains.employees[0].appsArb !== MIN_APPS_FOR_LOAD + 1) throw new Error("appsArb contains");
if (Math.abs(outArbContains.employees[0].minutes - 150 * (MIN_APPS_FOR_LOAD + 1)) > 1e-9) throw new Error("arb contains minutes");

const tagHeaders = Array(10).fill("");
tagHeaders[3] = "Дата создания";
tagHeaders[5] = "Тег";
tagHeaders[FIO_COL] = "Исполнитель";
const tagRow = Array(25).fill("");
tagRow[3] = "10.07.2026";
tagRow[5] = "foo Арбитраж bar";
tagRow[FIO_COL] = "Петров П.П. (333)";
if (findTagColumn(tagHeaders) !== 5) throw new Error("findTagColumn");
const outTagCol = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: tagHeaders, rows: repeatRow(tagRow, MIN_APPS_FOR_LOAD + 1) }],
    now
);
if (outTagCol.employees[0].appsArb !== MIN_APPS_FOR_LOAD + 1) throw new Error("appsArb tag col");
if (Math.abs(outTagCol.employees[0].minutes - 150 * (MIN_APPS_FOR_LOAD + 1)) > 1e-9) throw new Error("tag col minutes");

if (!isFirstLineFile("1-я линия поддержки АС Залоги.xlsx")) throw new Error("l1 name");
if (!isFirstLineFile("первая линия.xlsx")) throw new Error("l1 первая");
if (isFirstLineFile("выгрузка.xlsx")) throw new Error("l1 false positive");
if (fileKind("Залоговая экспертиза MDO.xlsx") !== "mdo") throw new Error("mdo kind");
if (fileKind("Работа с ОО.xlsx") !== "oo") throw new Error("oo kind");
if (fileKind("Работа с Онлайн Оценкой.xlsx") !== "oo") throw new Error("oo online kind");
if (!isVolkov("Волков Артем Анатольевич")) throw new Error("volkov");
if (isVolchkova("Волков Артем Анатольевич")) throw new Error("volchkova vs volkov");
if (!isVolchkova("Волчкова Анна Ивановна")) throw new Error("volchkova fio");
if (!isVolchkova("Волчкова А.И. (123)")) throw new Error("volchkova initials");
if (!isVolchkova("волчкова")) throw new Error("volchkova surname");
if (isVolchkova("Волочкова")) throw new Error("not volochkova");
if (isVolchkova("Волков")) throw new Error("not volkov");
if (isVolchkova("Волкова")) throw new Error("not volkova");
if (minutesForApp("1-я линия.xlsx", "Иванов", "") !== 24) throw new Error("min l1");
if (minutesForApp("Залоговая экспертиза MDO.xlsx", "Иванов", "Арбитраж") !== 150) throw new Error("min arb");
if (minutesForApp("MDO.xlsx", "Иванов", "Арбитраж, срочно") !== 150) throw new Error("min arb contains");
if (minutesForApp("MDO.xlsx", "Иванов", "foo Арбитраж bar") !== 150) throw new Error("min arb substring");
if (minutesForApp("MDO.xlsx", "Волков Артем Анатольевич", "") !== 240) throw new Error("min volkov");
if (minutesForApp("Работа с ОО.xlsx", "Иванов", "") !== 210) throw new Error("min oo");
if (minutesForApp("1-я линия.xlsx", "Волчкова А.А.", "") !== 210) throw new Error("min volchkova l1");
if (minutesForApp("MDO.xlsx", "Волчкова А.А.", "") !== 210) throw new Error("min volchkova mdo");
if (minutesForApp("MDO.xlsx", "Волчкова А.А.", "Арбитраж") !== 210) throw new Error("min volchkova arb");
if (minutesForApp("Работа с ОО.xlsx", "Волчкова А.А.", "") !== 210) throw new Error("min volchkova oo");

const l1Row = Array(25).fill("");
l1Row[3] = "10.07.2026";
l1Row[FIO_COL] = "Сидоров С.С. (111)";
const outL1 = aggregateEmployeeLoad(
    [{ file: "1-я линия поддержки АС Залоги.xlsx", sheet: "S", headers, rows: repeatRow(l1Row, MIN_APPS_FOR_LOAD + 1) }],
    now
);
if (outL1.employees[0].appsL1 !== MIN_APPS_FOR_LOAD + 1) throw new Error("appsL1");
if (Math.abs(outL1.employees[0].loadPct - ((MIN_APPS_FOR_LOAD + 1) * 24 / (workdays * 8 * 60)) * 100) > 1e-6) throw new Error("l1 pct");

const l1Arb = Array(34).fill("");
l1Arb[3] = "10.07.2026";
l1Arb[FIO_COL] = "Сидоров С.С. (111)";
l1Arb[33] = "Арбитраж";
const outL1Arb = aggregateEmployeeLoad(
    [{ file: "1-я линия.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(l1Arb, MIN_APPS_FOR_LOAD + 1) }],
    now
);
if (outL1Arb.employees[0].appsL1 !== MIN_APPS_FOR_LOAD + 1) throw new Error("l1 not arb file");
if (Math.abs(outL1Arb.employees[0].minutes - 24 * (MIN_APPS_FOR_LOAD + 1)) > 1e-9) throw new Error("l1 ignores ah");

const vacPlan = employeePlan(q, now, { from: "2026-07-06", to: "2026-07-10" });
if (vacPlan.vacationDays !== 5) throw new Error(`vacationDays ${vacPlan.vacationDays}`);
if (vacPlan.plan !== HOURS_PER_WORKDAY * (workdays - 5)) throw new Error("vac plan hours");
const withV = withVacations(out, { "Сидоров С.С.": { from: "2026-07-06", to: "2026-07-10" } });
if (withV.employees[0].plan !== vacPlan.plan) throw new Error("withVacations plan");
const vacMulti = employeePlan(q, now, [
    { from: "2026-07-06", to: "2026-07-10" },
    { from: "2026-07-08", to: "2026-07-10" }
]);
if (vacMulti.vacationDays !== 5) throw new Error("vac overlap unique");

if (termHoursFromST("01.07.2026", "04.07.2026") !== 72) throw new Error("termHours");
if (termHoursFromST("", "04.07.2026") != null) throw new Error("termHours empty");
if (!isOverdueCell("ДА") || !isOverdueCell("да") || isOverdueCell("нет")) throw new Error("overdue cell");
if (numberCell("1,5") !== 1.5 || numberCell("") !== 0) throw new Error("numberCell");
if (csiScore(5) !== 5 || csiScore("4") !== 4 || csiScore(0) != null || csiScore("") != null) throw new Error("csiScore");
if (segmentFromAF("клиент малого бизнеса") !== "ММБ") throw new Error("seg mmb");
if (segmentFromAF("работа с корпоративным блоком") !== "КСБ") throw new Error("seg ksb");
if (segmentFromAF("центр данных и аналитики") !== "ПМЗ") throw new Error("seg pmz");
if (segmentFromAF("служба документарных операций") !== "ПКД") throw new Error("seg pkd");
if (segmentFromAF("центр залоговой экспертизы") !== "ЗС") throw new Error("seg zs");
if (segmentFromAF("проблемными активами") !== "ПРПА") throw new Error("seg prpa");
if (segmentFromAF("прочее") !== "Прочее") throw new Error("seg other");
if (segmentFromAF("малого корпоративно") !== "ММБ") throw new Error("seg mmb wins kib");
if (segmentFromAF("залоговой экспертизы корпоративно") !== "ЗС") throw new Error("seg zs wins kib");
if (segmentFromAF("проблемными активами малого") !== "ММБ") throw new Error("seg mmb wins prpa");
if (segmentFromAF("документарных залоговой") !== "ПКД") throw new Error("seg pkd wins");

const metricRow = Array(40).fill("");
metricRow[3] = "10.07.2026";
metricRow[FIO_COL] = "Метриков М.М. (7)";
metricRow[S_COL] = "01.07.2026";
metricRow[T_COL] = "04.07.2026";
metricRow[W_COL] = 2;
metricRow[AG_COL] = "ДА";
metricRow[AN_COL] = 5;
const metricRows = repeatRow(metricRow, MIN_APPS_FOR_LOAD + 1);
metricRows[0][AG_COL] = "НЕТ";
metricRows[0][W_COL] = 0;
metricRows[0][T_COL] = "06.07.2026"; // 5 days
metricRows[0][AN_COL] = 1;
const outM = aggregateEmployeeLoad([{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: metricRows }], now);
if (outM.employees.length !== 1) throw new Error("metric emp");
if (Math.abs(outM.employees[0].avgTermHours - (120 + 72 * MIN_APPS_FOR_LOAD) / (MIN_APPS_FOR_LOAD + 1)) > 1e-9) throw new Error("avg term");
if (outM.employees[0].overdue !== MIN_APPS_FOR_LOAD) throw new Error("overdue emp");
if (outM.overdueTotal !== MIN_APPS_FOR_LOAD) throw new Error("overdue total");
if (Math.abs(outM.employees[0].returns - 2 * MIN_APPS_FOR_LOAD) > 1e-9) throw new Error("returns emp");
if (outM.returnsTotal !== 2 * MIN_APPS_FOR_LOAD) throw new Error("returns total");
if (JSON.stringify(outM.employees[0].csiCounts) !== JSON.stringify([1, 0, 0, 0, MIN_APPS_FOR_LOAD])) throw new Error("csi counts emp");
if (JSON.stringify(outM.csiCounts) !== JSON.stringify([1, 0, 0, 0, MIN_APPS_FOR_LOAD])) throw new Error("csi counts total");
if (outM.segments.mdo.Прочее !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg mdo other");
if (!outM.files?.length || outM.files[0].file !== "MDO.xlsx") throw new Error("files cut");

const lateT = Array(40).fill("");
lateT[FIO_COL] = "Поздний П.П. (1)";
lateT[T_COL] = "01.10.2026";
const outLate = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(lateT, MIN_APPS_FOR_LOAD + 1) }],
    now
);
if (outLate.employees.length !== 0) throw new Error("T after as-of excluded");
if (outLate.skippedOutOfQuarter !== MIN_APPS_FOR_LOAD + 1) throw new Error("T filter skip");

const segRow = Array(40).fill("");
segRow[3] = "10.07.2026";
segRow[FIO_COL] = "Сегментов С.С. (8)";
const segRows = [];
const afVals = [
    ["малого бизнеса", "ММБ"],
    ["с корпоративным клиентом", "КСБ"],
    ["центр данных и аналитики", "ПМЗ"],
    ["центр залоговой экспертизы", "ЗС"],
    ["служба документарных операций", "ПКД"],
    ["неизвестно", "Прочее"]
];
for (const [af] of afVals) {
    const r = [...segRow];
    r[AF_COL] = af;
    segRows.push(...repeatRow(r, MIN_APPS_FOR_LOAD + 1));
}
const outSeg = aggregateEmployeeLoad(
    [
        { file: "MDO.xlsx", sheet: "S", headers, rows: segRows.slice(0, MIN_APPS_FOR_LOAD + 1) },
        { file: "1-я линия поддержки АС Залоги.xlsx", sheet: "S", headers, rows: segRows.slice(MIN_APPS_FOR_LOAD + 1, (MIN_APPS_FOR_LOAD + 1) * 2) },
        { file: "Работа с Онлайн Оценкой.xlsx", sheet: "S", headers, rows: segRows.slice((MIN_APPS_FOR_LOAD + 1) * 2) }
    ],
    now
);
if (outSeg.segments.mdo.ММБ !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg file mdo");
if (outSeg.segments.l1.КСБ !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg file l1");
if (outSeg.segments.oo.ПМЗ !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg file oo pmz");
if (outSeg.segments.oo.ЗС !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg file oo zs");
if (outSeg.segments.oo.ПКД !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg file oo pkd");
if (outSeg.segments.oo.Прочее !== MIN_APPS_FOR_LOAD + 1) throw new Error("seg file oo other");

console.log("gl-load selfcheck ok", {
    workdays,
    plan: out.plan,
    loadPct: Number(expectPct.toFixed(2)),
    vacDays: vacPlan.vacationDays
});
