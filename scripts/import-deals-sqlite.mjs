#!/usr/bin/env node
/**
 * Импорт CSV/GZ датасетов в SQLite для быстрого поиска по кварталу.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveDatasetPathsForImport, iterDatasetRows } from "../lib/deals-import-utils.mjs";
import { DEALS_DB_PATH, initDealsDbSchema, openWritableDb } from "../lib/deals-sqlite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(path.dirname(DEALS_DB_PATH), ".deals-import-manifest.json");

function currentManifest(datasets) {
    const files = {};
    for (const ds of datasets) {
        const stat = fs.statSync(ds.path);
        files[ds.path] = `${stat.size}:${stat.mtimeMs}`;
    }
    return { files, builtAt: new Date().toISOString() };
}

function manifestMatches(datasets) {
    if (!fs.existsSync(MANIFEST_PATH) || !fs.existsSync(DEALS_DB_PATH)) return false;
    try {
        const saved = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
        const current = currentManifest(datasets);
        return JSON.stringify(saved.files) === JSON.stringify(current.files);
    } catch {
        return false;
    }
}

async function main() {
    const force = process.argv.includes("--force");
    const datasets = resolveDatasetPathsForImport();

    if (!datasets.length) {
        console.error("Нет датасетов в data/deals/");
        process.exit(1);
    }

    if (!force && manifestMatches(datasets)) {
        console.log("SQLite актуален:", DEALS_DB_PATH);
        return;
    }

    console.log(`Импорт ${datasets.length} датасетов в SQLite…`);
    fs.mkdirSync(path.dirname(DEALS_DB_PATH), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
        const p = `${DEALS_DB_PATH}${suffix}`;
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const db = openWritableDb();
    initDealsDbSchema(db);
    const insert = db.prepare(
        `INSERT INTO deals (quarter_cad_number, sort_key, deal_price, payload)
         VALUES (?, ?, ?, ?)`
    );

    const BATCH_SIZE = 5000;
    let batch = 0;

    for (const datasetMeta of datasets) {
        const t0 = Date.now();
        let fileCount = 0;
        db.exec("BEGIN");
        for await (const deal of iterDatasetRows(datasetMeta)) {
            if (!deal.quarter_cad_number) continue;
            insert.run(
                deal.quarter_cad_number,
                datasetMeta.sortKey,
                deal.deal_price ?? null,
                JSON.stringify(deal)
            );
            fileCount++;
            batch++;
            if (batch >= BATCH_SIZE) {
                db.exec("COMMIT");
                db.exec("BEGIN");
                batch = 0;
            }
        }
        db.exec("COMMIT");
        console.log(
            `  ${datasetMeta.fileName}: ${fileCount.toLocaleString("ru-RU")} строк за ${((Date.now() - t0) / 1000).toFixed(1)} с`
        );
    }

    db.exec("ANALYZE");
    const totalRows = Number(db.prepare("SELECT COUNT(*) AS c FROM deals").get().c);
    db.close();

    const mb = (fs.statSync(DEALS_DB_PATH).size / (1024 * 1024)).toFixed(1);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(currentManifest(datasets), null, 2));
    console.log(`Готово: ${totalRows.toLocaleString("ru-RU")} записей, ${mb} MB → ${DEALS_DB_PATH}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
