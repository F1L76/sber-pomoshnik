#!/usr/bin/env node
/**
 * Строит индекс: какие кадастровые кварталы есть в каждом датасете.
 * Поиск читает только файлы, где квартал присутствует в индексе.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEALS_DIR = path.join(__dirname, "..", "data", "deals");
const INDEX_DIR = path.join(DEALS_DIR, "index");

function openDatasetStream(filePath) {
    const stream = fs.createReadStream(filePath);
    if (filePath.endsWith(".gz")) {
        return stream.pipe(zlib.createGunzip());
    }
    return stream;
}

function detectDelimiter(headerLine) {
    const semi = (headerLine.match(/;/g) || []).length;
    const tilde = (headerLine.match(/~/g) || []).length;
    return semi > tilde ? ";" : "~";
}

async function collectQuarters(filePath) {
    const quarters = new Set();
    const rl = readline.createInterface({
        input: openDatasetStream(filePath),
        crlfDelay: Infinity
    });
    let isHeader = true;
    let delimiter = "~";
    for await (const line of rl) {
        if (!line.trim()) continue;
        if (isHeader) {
            delimiter = detectDelimiter(line);
            isHeader = false;
            continue;
        }
        const parts = line.split(delimiter);
        if (parts.length < 6) continue;
        let q = parts[5] ?? "";
        if (q === '""' || q === "") continue;
        q = q.replace(/^"(.*)"$/, "$1");
        if (q) quarters.add(q);
    }
    return [...quarters].sort();
}

async function main() {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
    const files = fs
        .readdirSync(DEALS_DIR)
        .filter((f) => /^dataset_.*\.csv\.gz$/i.test(f))
        .sort();

    for (const file of files) {
        const src = path.join(DEALS_DIR, file);
        const base = file.replace(/\.gz$/i, "");
        const out = path.join(INDEX_DIR, `${base}.quarters.json.gz`);
        console.log(`индекс ${file}…`);
        const quarters = await collectQuarters(src);
        const json = JSON.stringify(quarters);
        fs.writeFileSync(out, zlib.gzipSync(json, { level: 9 }));
        const mb = (fs.statSync(out).size / (1024 * 1024)).toFixed(2);
        console.log(`  ${quarters.length} кварталов -> ${path.basename(out)} (${mb} MB)`);
    }
    console.log("готово");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
