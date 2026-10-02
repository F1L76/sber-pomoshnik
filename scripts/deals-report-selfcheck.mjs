import { normalizePeriods, sortKeyToPeriod } from "../lib/deals-lookup.mjs";
import { normalizeRegionCode, regionCodeVariants } from "../lib/rf-regions.mjs";

const keys = normalizePeriods(["2025-3", "2026q1", { year: 2025, quarter: 4 }, "2026-2"]);
console.assert(keys.join(",") === "202602,202601,202504,202503", keys.join(","));
console.assert(sortKeyToPeriod(202503).label === "3 кв 2025");
console.assert(normalizeRegionCode("15") === 15);
console.assert(regionCodeVariants(1).join(",") === "1,01");
console.assert(regionCodeVariants(15).join(",") === "15");

let threw = false;
try {
    normalizePeriods([]);
} catch {
    threw = true;
}
console.assert(threw, "empty periods must fail");
console.log("deals-report-selfcheck: ok");
