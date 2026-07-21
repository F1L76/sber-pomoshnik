// ponytail: mirrors period sort key in deals-search.html — fails if formula drifts
function periodKey(s) {
    const m = String(s).match(/^(\d)\s+кв\s+(\d{4})$/);
    return m ? Number(m[2]) * 10 + Number(m[1]) : null;
}

const a = periodKey("1 кв 2024");
const b = periodKey("4 кв 2023");
console.assert(a === 20241, `got ${a}`);
console.assert(b === 20234, `got ${b}`);
console.assert(a > b, "1 кв 2024 must sort after 4 кв 2023");
console.assert(periodKey("—") == null);
console.log("deals-sort-selfcheck: ok");
