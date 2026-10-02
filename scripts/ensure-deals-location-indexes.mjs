import fs from "fs";
import { DEALS_DB_PATH, ensureDealsLocationIndexes, isSqliteSupported, openWritableDb } from "../lib/deals-sqlite.mjs";

if (!isSqliteSupported()) {
    console.error("Нужен Node.js 22+");
    process.exit(1);
}
if (!fs.existsSync(DEALS_DB_PATH)) {
    console.error(`Нет базы: ${DEALS_DB_PATH}`);
    process.exit(1);
}

console.log(`индексы город/регион: ${DEALS_DB_PATH}`);
const started = Date.now();
const db = openWritableDb();
ensureDealsLocationIndexes(db);
db.close();
console.log(`готово за ${Math.round((Date.now() - started) / 1000)} с`);
