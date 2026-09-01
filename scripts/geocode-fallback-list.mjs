#!/usr/bin/env node
/**
 * Для КН без точки НСПД: адрес с kadbase.ru → координаты OSM (приблизительно).
 * Дописывает успех в coords.jsonl, не трогая текущий прогон НСПД.
 *
 *   node scripts/geocode-fallback-list.mjs
 */
import fs from "fs";
import { geocodeCadastralByKadbase } from "../lib/geocode-address.mjs";
import {
    COORDS_JSONL_PATH,
    PROGRESS_LOG_PATH,
    compactPoint,
    ensureGeocodeDir
} from "../lib/nspd-geocode-store.mjs";

function lastRowByKn() {
    const last = new Map();
    if (!fs.existsSync(COORDS_JSONL_PATH)) return last;
    for (const line of fs.readFileSync(COORDS_JSONL_PATH, "utf8").split("\n")) {
        if (!line) continue;
        try {
            const row = JSON.parse(line);
            const kn = String(row.kn || row.cadastralNumber || "").trim();
            if (kn) last.set(kn, row);
        } catch {
            /* skip */
        }
    }
    return last;
}

function missesWithoutPoint() {
    const out = [];
    for (const [kn, row] of lastRowByKn()) {
        if (compactPoint(row)) continue;
        if (!/не найден в НСПД|нет координат/i.test(String(row.err || ""))) continue;
        out.push(kn);
    }
    return out;
}

async function main() {
    ensureGeocodeDir();
    const kns = missesWithoutPoint();
    console.log(`без точки НСПД: ${kns.length}, пробую kadbase.ru + OSM`);
    const jsonl = fs.createWriteStream(COORDS_JSONL_PATH, { flags: "a" });
    let ok = 0;
    let fail = 0;
    for (const kn of kns) {
        const result = await geocodeCadastralByKadbase(kn);
        let line;
        if (result.found) {
            ok += 1;
            jsonl.write(
                JSON.stringify({
                    kn: result.cadastralNumber || kn,
                    ok: true,
                    lat: result.lat,
                    lon: result.lon,
                    t: result.objectType || "",
                    addr: result.address || "",
                    src: "kadbase"
                }) + "\n"
            );
            line = `k+ ${kn}  ${result.lat.toFixed(6)}  ${result.lon.toFixed(6)}  ${result.objectType || ""}`.trim();
        } else {
            fail += 1;
            line = `k− ${kn}  ${result.message || "нет точки"}`;
        }
        fs.appendFile(PROGRESS_LOG_PATH, line + "\n", () => {});
        console.log(`${ok + fail}/${kns.length} ${line}`);
        if (/ограничил автоматический доступ/i.test(result.message || "")) {
            console.log("kadbase упёрся в лимит запросов — останавливаюсь, чтобы не жечь дальше");
            break;
        }
    }
    await new Promise((resolve) => jsonl.end(resolve));
    console.log(`готово: ${ok} точек по адресу, ${fail} без точки`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
