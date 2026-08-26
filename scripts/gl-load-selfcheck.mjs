import {
    fioFromCell,
    startOfQuarter,
    countWorkdays,
    parseExcelDate,
    parseExcelDateTime,
    findDateColumn,
    findFioColumn,
    isWorkday,
    aggregateEmployeeLoad,
    employeePlan,
    withVacations,
    isFirstLineFile,
    fileKind,
    lineNameFromFile,
    lineNameFromZ,
    minutesForApp,
    isFzhCell,
    isVolkov,
    isVolchkova,
    findTagColumn,
    termHoursFromST,
    isOverdueCell,
    numberCell,
    csiScore,
    segmentFromAF,
    tbFromAF,
    isPriorityCell,
    TERR_BANKS,
    ARRIVAL_HOURS,
    WEEKDAYS,
    HOURS_PER_WORKDAY,
    FIO_COL,
    Z_COL,
    S_COL,
    T_COL,
    W_COL,
    AG_COL,
    AN_COL,
    AF_COL,
    AH_COL,
    AL_COL,
    AC_COL
} from "../lib/gl-load.mjs";
import { parseVacCell, resolveVacations, isGlEmployee } from "../lib/gl-vacations.mjs";

const APPS = 41;
const GL_FIO = "Филинюк А.А. (111)";
const Z_L1 = "1-я линия поддержки АС Залоги";
const Z_MDO = "Залоговая экспертиза MDO";
const Z_OO = "Работа с Онлайн-оценкой";
const Z_OSM = "Осмотры";

function withZ(row, z) {
    const copy = [...row];
    while (copy.length <= Z_COL) copy.push("");
    copy[Z_COL] = z;
    return copy;
}

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
for (let i = 0; i < APPS; i++) {
    const row = Array(25).fill("");
    row[3] = "10.07.2026";
    row[T_COL] = "10.07.2026";
    row[FIO_COL] = GL_FIO;
    rows.push(row);
}
const out = aggregateEmployeeLoad([{ file: "a.xlsx", sheet: "S", headers, rows }], now);
const workdays = countWorkdays(q, now);
if (out.workdays !== workdays) throw new Error(`workdays ${out.workdays} != ${workdays}`);
if (out.plan !== HOURS_PER_WORKDAY * workdays) throw new Error("plan hours");
if (out.employees.length !== 1 || out.employees[0].apps !== APPS) throw new Error("apps");
if (out.linesTotal !== APPS) throw new Error("linesTotal");
if (out.lines[0].name !== "Без группы") throw new Error("line from empty Z");
const expectPct = ((APPS) * 20) / (workdays * 8 * 60) * 100;
if (Math.abs(out.employees[0].loadPct - expectPct) > 1e-9) throw new Error("pct");

if (!isGlEmployee("Филинюк А.А. (111)")) throw new Error("gl filinyuk");
if (!isGlEmployee("волков артем")) throw new Error("gl volkov case");
if (isGlEmployee("Сидоров С.С. (111)")) throw new Error("gl sidorov");

const few = Array(25).fill("");
few[3] = "10.07.2026";
few[T_COL] = "10.07.2026";
few[FIO_COL] = "Сидоров С.С. (111)";
const outFew = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(few, APPS) }],
    now
);
if (outFew.employees.length !== 0) throw new Error("non-gl excluded");
if (outFew.skippedNotGl !== APPS) throw new Error("skippedNotGl");
if ((outFew.linesTotal || 0) !== 0 || (outFew.lines || []).length) throw new Error("non-gl lines");
const mixedLine = [
    ...repeatRow(Object.assign(Array(25).fill(""), { 3: "10.07.2026", [T_COL]: "10.07.2026", [FIO_COL]: GL_FIO }), 3),
    ...repeatRow(Object.assign(Array(25).fill(""), { 3: "10.07.2026", [T_COL]: "10.07.2026", [FIO_COL]: "Сидоров С.С. (111)" }), 10)
];
const outMixedLine = aggregateEmployeeLoad([{ file: "MDO.xlsx", sheet: "S", headers, rows: mixedLine }], now);
if (outMixedLine.employees.length !== 1 || outMixedLine.employees[0].apps !== 3) throw new Error("mixed gl apps");
if (outMixedLine.linesTotal !== 3) throw new Error("lines only gl");
if (outMixedLine.skippedNotGl !== 10) throw new Error("mixed skippedNotGl");
const glFew = Array(25).fill("");
glFew[3] = "10.07.2026";
glFew[T_COL] = "10.07.2026";
glFew[FIO_COL] = GL_FIO;
const outEnough = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(glFew, 3) }],
    now
);
if (outEnough.employees.length !== 1 || outEnough.employees[0].apps !== 3) throw new Error("gl few apps included");
const mix = Array(25).fill("");
mix[3] = "10.07.2026";
mix[T_COL] = "10.07.2026";
mix[FIO_COL] = GL_FIO;
const outMixFew = aggregateEmployeeLoad(
    [
        { file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(mix, 20) },
        { file: "1-я линия.xlsx", sheet: "S", headers, rows: repeatRow(mix, 10) }
    ],
    now
);
if (outMixFew.employees.length !== 1 || outMixFew.employees[0].apps !== 30) throw new Error("gl mix included");
const outMixOk = aggregateEmployeeLoad(
    [
        { file: "MDO.xlsx", sheet: "S", headers, rows: repeatRow(mix, 20) },
        { file: "1-я линия.xlsx", sheet: "S", headers, rows: repeatRow(mix, APPS - 20) }
    ],
    now
);
if (outMixOk.employees.length !== 1 || outMixOk.employees[0].apps !== APPS) throw new Error("mix across files included");

const arbRow = Array(34).fill("");
arbRow[3] = "10.07.2026";
arbRow[T_COL] = "10.07.2026";
arbRow[FIO_COL] = "Филинюк А.А. (111)";
arbRow[33] = "Арбитраж";
const outArb = aggregateEmployeeLoad(
    [{ file: "a.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: [...rows, arbRow] }],
    now
);
const expectArb = (((APPS) * 20 + 150) / (workdays * 8 * 60)) * 100;
if (outArb.employees[0].appsArb !== 1) throw new Error("appsArb");
if (Math.abs(outArb.employees[0].loadPct - expectArb) > 1e-6) throw new Error("arb pct");

const arbContainsRow = Array(34).fill("");
arbContainsRow[3] = "10.07.2026";
arbContainsRow[FIO_COL] = GL_FIO;
arbContainsRow[AH_COL] = "Арбитраж, срочно";
const outArbContains = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(arbContainsRow, APPS) }],
    now
);
if (outArbContains.employees[0].appsArb !== APPS) throw new Error("appsArb contains");
if (Math.abs(outArbContains.employees[0].minutes - 150 * (APPS)) > 1e-9) throw new Error("arb contains minutes");

const tagHeaders = Array(10).fill("");
tagHeaders[3] = "Дата создания";
tagHeaders[5] = "Тег";
tagHeaders[FIO_COL] = "Исполнитель";
const tagRow = Array(25).fill("");
tagRow[3] = "10.07.2026";
tagRow[5] = "foo Арбитраж bar";
tagRow[FIO_COL] = GL_FIO;
if (findTagColumn(tagHeaders) !== 5) throw new Error("findTagColumn");
const outTagCol = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: tagHeaders, rows: repeatRow(tagRow, APPS) }],
    now
);
if (outTagCol.employees[0].appsArb !== APPS) throw new Error("appsArb tag col");
if (Math.abs(outTagCol.employees[0].minutes - 150 * (APPS)) > 1e-9) throw new Error("tag col minutes");

if (!isFirstLineFile(Z_L1)) throw new Error("l1 name");
if (!isFirstLineFile("первая линия")) throw new Error("l1 первая");
if (isFirstLineFile("выгрузка")) throw new Error("l1 false positive");
if (fileKind(Z_MDO) !== "mdo") throw new Error("mdo kind");
if (fileKind("Работа с ОО") !== "oo") throw new Error("oo kind");
if (fileKind(Z_OO) !== "oo") throw new Error("oo online kind");
if (fileKind(Z_OSM) !== "osmotr") throw new Error("osmotr kind");
if (lineNameFromFile("Залоговая экспертиза MDO_07.26.xlsx") !== "Залоговая экспертиза MDO") throw new Error("line name");
if (lineNameFromFile("Работа с ОО.xlsx") !== "Работа с ОО") throw new Error("line name no _");
if (lineNameFromZ("  Залоговая экспертиза MDO ") !== Z_MDO) throw new Error("z trim");
if (lineNameFromZ("") !== "Без группы") throw new Error("z empty");
if (!isFzhCell("ФЖН, срочно")) throw new Error("fzh contains");
if (isFzhCell("Арбитраж")) throw new Error("fzh false");
if (!isVolkov("Волков Артем Анатольевич")) throw new Error("volkov");
if (isVolchkova("Волков Артем Анатольевич")) throw new Error("volchkova vs volkov");
if (!isVolchkova("Волчкова Анна Ивановна")) throw new Error("volchkova fio");
if (!isVolchkova("Волчкова А.И. (123)")) throw new Error("volchkova initials");
if (!isVolchkova("волчкова")) throw new Error("volchkova surname");
if (isVolchkova("Волочкова")) throw new Error("not volochkova");
if (isVolchkova("Волков")) throw new Error("not volkov");
if (isVolchkova("Волкова")) throw new Error("not volkova");
if (minutesForApp(Z_L1, "Иванов", "") !== 24) throw new Error("min l1");
if (minutesForApp(Z_OSM, "Иванов", "Арбитраж") !== 20) throw new Error("min osmotr ignores tag");
if (minutesForApp(Z_MDO, "Иванов", "Арбитраж") !== 150) throw new Error("min arb");
if (minutesForApp(Z_MDO, "Иванов", "Арбитраж, срочно") !== 150) throw new Error("min arb contains");
if (minutesForApp(Z_MDO, "Иванов", "foo Арбитраж bar") !== 150) throw new Error("min arb substring");
if (minutesForApp(Z_MDO, "Иванов", "ФЖН") !== 240) throw new Error("min fzh");
if (minutesForApp(Z_MDO, "Иванов", "Арбитраж, ФЖН") !== 240) throw new Error("min fzh over arb");
if (minutesForApp(Z_MDO, "Волков Артем Анатольевич", "") !== 20) throw new Error("min volkov now mdo default");
if (minutesForApp(Z_OO, "Иванов", "") !== 20) throw new Error("min oo");
if (minutesForApp(Z_OO, "Иванов", "Арбитраж") !== 210) throw new Error("min oo arb");
if (minutesForApp(Z_L1, "Волчкова А.А.", "") !== 24) throw new Error("min volchkova l1");
if (minutesForApp(Z_MDO, "Волчкова А.А.", "") !== 20) throw new Error("min volchkova mdo");
if (minutesForApp(Z_MDO, "Волчкова А.А.", "Арбитраж") !== 150) throw new Error("min volchkova arb");
if (minutesForApp(Z_OO, "Волчкова А.А.", "") !== 20) throw new Error("min volchkova oo");

const l1Row = Array(26).fill("");
l1Row[3] = "10.07.2026";
l1Row[FIO_COL] = "Филинюк А.А. (111)";
l1Row[Z_COL] = Z_L1;
const outL1 = aggregateEmployeeLoad(
    [{ file: "dump.xlsx", sheet: "S", headers, rows: repeatRow(l1Row, APPS) }],
    now
);
if (outL1.employees[0].appsL1 !== APPS) throw new Error("appsL1");
if (Math.abs(outL1.employees[0].loadPct - ((APPS) * 24 / (workdays * 8 * 60)) * 100) > 1e-6) throw new Error("l1 pct");

const l1Arb = Array(34).fill("");
l1Arb[3] = "10.07.2026";
l1Arb[FIO_COL] = "Филинюк А.А. (111)";
l1Arb[Z_COL] = Z_L1;
l1Arb[33] = "Арбитраж";
const outL1Arb = aggregateEmployeeLoad(
    [{ file: "dump.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(l1Arb, APPS) }],
    now
);
if (outL1Arb.employees[0].appsL1 !== APPS) throw new Error("l1 not arb file");
if (Math.abs(outL1Arb.employees[0].minutes - 24 * (APPS)) > 1e-9) throw new Error("l1 ignores ah");

const ooArb = Array(34).fill("");
ooArb[3] = "10.07.2026";
ooArb[T_COL] = "10.07.2026";
ooArb[FIO_COL] = "Филинюк А.А. (111)";
ooArb[Z_COL] = Z_OO;
ooArb[33] = "Арбитраж";
const outOoArb = aggregateEmployeeLoad(
    [{ file: "dump.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(ooArb, APPS) }],
    now
);
if (outOoArb.employees[0].appsOo !== APPS) throw new Error("oo apps");
if (outOoArb.employees[0].appsArb !== APPS) throw new Error("oo arb count");
if (Math.abs(outOoArb.employees[0].minutes - 210 * (APPS)) > 1e-9) throw new Error("oo arb minutes");

const fzhRow = Array(34).fill("");
fzhRow[3] = "10.07.2026";
fzhRow[T_COL] = "10.07.2026";
fzhRow[FIO_COL] = "Филинюк А.А. (111)";
fzhRow[Z_COL] = Z_MDO;
fzhRow[33] = "ФЖН";
const outFzh = aggregateEmployeeLoad(
    [{ file: "dump.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(fzhRow, APPS) }],
    now
);
if (outFzh.employees[0].appsFzh !== APPS) throw new Error("fzh count");
if (Math.abs(outFzh.employees[0].minutes - 240 * (APPS)) > 1e-9) throw new Error("fzh minutes");

const osmotrRow = Array(26).fill("");
osmotrRow[3] = "10.07.2026";
osmotrRow[T_COL] = "10.07.2026";
osmotrRow[FIO_COL] = "Филинюк А.А. (111)";
osmotrRow[Z_COL] = Z_OSM;
const outOsmotr = aggregateEmployeeLoad(
    [{ file: "dump.xlsx", sheet: "S", headers, rows: repeatRow(osmotrRow, APPS) }],
    now
);
if (Math.abs(outOsmotr.employees[0].minutes - 20 * (APPS)) > 1e-9) throw new Error("osmotr minutes");
if (outOsmotr.segments.mdo.Прочее) throw new Error("osmotr not mdo seg");

const vacPlan = employeePlan(q, now, { from: "2026-07-06", to: "2026-07-10" });
if (vacPlan.vacationDays !== 5) throw new Error(`vacationDays ${vacPlan.vacationDays}`);
if (vacPlan.plan !== HOURS_PER_WORKDAY * (workdays - 5)) throw new Error("vac plan hours");
const withV = withVacations(out, { "Филинюк А.А.": { from: "2026-07-06", to: "2026-07-10" } });
if (withV.employees[0].plan !== vacPlan.plan) throw new Error("withVacations plan");
const vacMulti = employeePlan(q, now, [
    { from: "2026-07-06", to: "2026-07-10" },
    { from: "2026-07-08", to: "2026-07-10" }
]);
if (vacMulti.vacationDays !== 5) throw new Error("vac overlap unique");
if (JSON.stringify(parseVacCell("06.04.-19.04")) !== JSON.stringify([{ from: "2026-04-06", to: "2026-04-19" }])) {
    throw new Error("parseVacCell range");
}
if (JSON.stringify(parseVacCell("02.07.")) !== JSON.stringify([{ from: "2026-07-02", to: "2026-07-02" }])) {
    throw new Error("parseVacCell day");
}
const filVac = resolveVacations("Филинюк Андрей Владимирович");
if (!filVac.some((p) => p.from === "2026-07-02" && p.to === "2026-07-02")) throw new Error("builtin filinyuk");
if (resolveVacations("Филинюк Андрей Владимирович", { "Филинюк Андрей Владимирович": [] }).length !== 0) {
    throw new Error("override empty");
}

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
metricRow[FIO_COL] = GL_FIO;
metricRow[S_COL] = "01.07.2026";
metricRow[T_COL] = "04.07.2026";
metricRow[W_COL] = 2;
metricRow[AG_COL] = "ДА";
metricRow[AN_COL] = 5;
metricRow[Z_COL] = Z_MDO;
const metricRows = repeatRow(metricRow, APPS);
metricRows[0][AG_COL] = "НЕТ";
metricRows[0][W_COL] = 0;
metricRows[0][T_COL] = "06.07.2026"; // 5 days
metricRows[0][AN_COL] = 1;
const outM = aggregateEmployeeLoad([{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: metricRows }], now);
if (outM.employees.length !== 1) throw new Error("metric emp");
if (Math.abs(outM.employees[0].avgTermHours - (120 + 72 * (APPS - 1)) / (APPS)) > 1e-9) throw new Error("avg term");
if (outM.employees[0].overdue !== (APPS - 1)) throw new Error("overdue emp");
if (outM.overdueTotal !== (APPS - 1)) throw new Error("overdue total");
if (Math.abs(outM.employees[0].returns - 2 * (APPS - 1)) > 1e-9) throw new Error("returns emp");
if (outM.returnsTotal !== 2 * (APPS - 1)) throw new Error("returns total");
if (JSON.stringify(outM.employees[0].csiCounts) !== JSON.stringify([1, 0, 0, 0, (APPS - 1)])) throw new Error("csi counts emp");
if (JSON.stringify(outM.csiCounts) !== JSON.stringify([1, 0, 0, 0, (APPS - 1)])) throw new Error("csi counts total");
if (outM.segments.mdo.Прочее !== APPS) throw new Error("seg mdo other");
if (!outM.files?.length || outM.files[0].file !== Z_MDO) throw new Error("files cut");

const lateT = Array(40).fill("");
lateT[FIO_COL] = GL_FIO;
lateT[T_COL] = "01.10.2026";
const outLate = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(9).fill("")], rows: repeatRow(lateT, APPS) }],
    now
);
if (outLate.employees.length !== 0) throw new Error("T after as-of excluded");
if (outLate.skippedOutOfQuarter !== APPS) throw new Error("T filter skip");

const segRow = Array(40).fill("");
segRow[3] = "10.07.2026";
segRow[FIO_COL] = GL_FIO;
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
    segRows.push(...repeatRow(r, APPS));
}
const outSeg = aggregateEmployeeLoad(
    [
        { file: "dump.xlsx", sheet: "S", headers, rows: segRows.slice(0, APPS).map((r) => withZ(r, Z_MDO)) },
        { file: "dump.xlsx", sheet: "S", headers, rows: segRows.slice(APPS, APPS * 2).map((r) => withZ(r, Z_L1)) },
        { file: "dump.xlsx", sheet: "S", headers, rows: segRows.slice(APPS * 2).map((r) => withZ(r, Z_OO)) }
    ],
    now
);
if (outSeg.segments.mdo.ММБ !== APPS) throw new Error("seg file mdo");
if (outSeg.segments.l1.КСБ !== APPS) throw new Error("seg file l1");
if (outSeg.segments.oo.ПМЗ !== APPS) throw new Error("seg file oo pmz");
if (outSeg.segments.oo.ЗС !== APPS) throw new Error("seg file oo zs");
if (outSeg.segments.oo.ПКД !== APPS) throw new Error("seg file oo pkd");
if (outSeg.segments.oo.Прочее !== APPS) throw new Error("seg file oo other");

const zMixL1 = withZ(
    Object.assign(Array(26).fill(""), { 3: "10.07.2026", [T_COL]: "10.07.2026", [FIO_COL]: GL_FIO }),
    Z_L1
);
const zMixMdo = withZ(
    Object.assign(Array(26).fill(""), { 3: "10.07.2026", [T_COL]: "10.07.2026", [FIO_COL]: GL_FIO }),
    Z_MDO
);
const outZMix = aggregateEmployeeLoad(
    [{ file: "один.xlsx", sheet: "S", headers, rows: [...repeatRow(zMixL1, 2), ...repeatRow(zMixMdo, 3)] }],
    now
);
if (outZMix.lines.length !== 2) throw new Error("z mix lines");
if (outZMix.employees[0].appsL1 !== 2) throw new Error("z mix l1");
if (Math.abs(outZMix.employees[0].minutes - (2 * 24 + 3 * 20)) > 1e-9) throw new Error("z mix minutes");
if (outZMix.lines.some((l) => l.name === "один")) throw new Error("z mix not filename");
if (!outZMix.lines.some((l) => l.name === Z_L1) || !outZMix.lines.some((l) => l.name === Z_MDO)) {
    throw new Error("z mix names");
}

if (tbFromAF("Московский банк") !== "МБ") throw new Error("tb mb");
if (tbFromAF("Среднерусский банк") !== "СРБ") throw new Error("tb srb");
if (tbFromAF("Волго-Вятский банк") !== "ВВБ") throw new Error("tb vvb");
if (tbFromAF("Поволжский банк") !== "ПБ") throw new Error("tb pb");
if (tbFromAF("Уральский банк") !== "УБ") throw new Error("tb ub");
if (tbFromAF("Сибирский банк") !== "СБ") throw new Error("tb sb");
if (tbFromAF("Байкальский банк") !== "ББ") throw new Error("tb bb");
if (tbFromAF("Дальневосточный банк") !== "ДВБ") throw new Error("tb dvb");
if (tbFromAF("Северо-Западный банк") !== "СЗБ") throw new Error("tb szb");
if (tbFromAF("Юго-Западный банк") !== "ЮЗБ") throw new Error("tb yuzb");
if (tbFromAF("Центрально-Черноземный банк") !== "ЦЧБ") throw new Error("tb cchb");
if (tbFromAF("Подразделение центрального подчинения") !== "ТМ") throw new Error("tb tm");
if (tbFromAF("нет банка") != null) throw new Error("tb none");
if (!isPriorityCell("Срочный приоритет")) throw new Error("prio cell");
if (isPriorityCell("обычная")) throw new Error("prio false");
if (TERR_BANKS.length !== 12) throw new Error("tb list");
if (segmentFromAF("Московский банк, ММБ") !== "ММБ") throw new Error("seg mmb code");
if (segmentFromAF("Среднерусский банк КСБ") !== "КСБ") throw new Error("seg ksb code");

const prioRow = Array(40).fill("");
prioRow[3] = "10.07.2026";
prioRow[T_COL] = "10.07.2026";
prioRow[FIO_COL] = GL_FIO;
prioRow[AF_COL] = "Московский банк, малое и среднее / малого бизнеса";
prioRow[AL_COL] = "приоритет";
const prioRow2 = [...prioRow];
prioRow2[AF_COL] = "Среднерусский банк, корпоративный блок";
prioRow2[AL_COL] = "Приоритет 1";
const prioSkip = [...prioRow];
prioSkip[AL_COL] = "";
const outPrio = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(20).fill("")], rows: [prioRow, prioRow, prioRow2, prioSkip] }],
    now
);
if (outPrio.priorityTotals.ММБ !== 2) throw new Error("prio mmb total");
if (outPrio.priorityTotals.КСБ !== 1) throw new Error("prio ksb total");
if (outPrio.priorities.ММБ.МБ !== 2) throw new Error("prio mmb mb");
if (outPrio.priorities.КСБ.СРБ !== 1) throw new Error("prio ksb srb");
if (outPrio.priorities.ММБ.СРБ !== 0) throw new Error("prio mmb srb empty");
const prioBb = [...prioRow];
prioBb[AF_COL] = "Байкальский банк|Блок корпоративный";
const outBb = aggregateEmployeeLoad(
    [{ file: "MDO.xlsx", sheet: "S", headers: [...headers, ...Array(20).fill("")], rows: [prioBb] }],
    now
);
if (outBb.priorityTotals.КСБ !== 1) throw new Error("prio bb ksb");
if (outBb.priorities.КСБ.ББ !== 1) throw new Error("prio bb bar");

if (ARRIVAL_HOURS.length !== 24 || ARRIVAL_HOURS[9] !== "09") throw new Error("hours labels");
if (WEEKDAYS.join("") !== "пнвтсрчтптсбвс") throw new Error("weekdays");
const arrivedAt = parseExcelDateTime("08.07.2026 14:30:00");
if (!arrivedAt || arrivedAt.getHours() !== 14 || arrivedAt.getDay() !== 3) throw new Error("ac parse wed 14");
const arrRow = Array(40).fill("");
arrRow[T_COL] = "10.07.2026";
arrRow[FIO_COL] = GL_FIO;
arrRow[AC_COL] = "08.07.2026 14:30:00";
const arrFri = [...arrRow];
arrFri[AC_COL] = "10.07.2026 09:15:00";
const arrEmpty = [...arrRow];
arrEmpty[AC_COL] = "";
const outArr = aggregateEmployeeLoad(
    [{ file: "dump.xlsx", sheet: "S", headers: [...headers, ...Array(20).fill("")], rows: [arrRow, arrRow, arrFri, arrEmpty] }],
    now
);
if (outArr.byHour["14"] !== 2) throw new Error("byHour 14");
if (outArr.byHour["09"] !== 1) throw new Error("byHour 09");
if (outArr.byWeekday["ср"] !== 2) throw new Error("byWeekday wed");
if (outArr.byWeekday["пт"] !== 1) throw new Error("byWeekday fri");
if (outArr.used !== 4) throw new Error("arrival still counted");

console.log("gl-load selfcheck ok", {
    workdays,
    plan: out.plan,
    loadPct: Number(expectPct.toFixed(2)),
    vacDays: vacPlan.vacationDays
});
