#!/usr/bin/env node
/**
 * Для КН без точки НСПД: адрес соседа по кварталу → геокодер (Яндекс/OSM).
 * Если геокодер не нашёл — координаты соседа по тому же кварталу (приблизительно).
 *
 *   node scripts/geocode-fallback-list.mjs
 *   GEOCODE_FALLBACK_KADBASE=1 — без адреса квартала спросить kadbase
 */
import fs from "fs";
import {
    geocodeCadastralByKadbase,
    geocodeCadastralByKnownAddress
} from "../lib/geocode-address.mjs";
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

function quarterOf(kn) {
    return String(kn || "").split(":").slice(0, 3).join(":");
}

function quarterBest(last) {
    /** @type {Map<string, { addr: string, lat: number, lon: number, t: string }>} */
    const out = new Map();
    /** @type {Map<string, Map<string, { n: number, lat: number, lon: number, t: string }>>} */
    const byQ = new Map();
    for (const [kn, row] of last) {
        const point = compactPoint(row);
        if (!point) continue;
        const addr = String(row.addr || "").trim();
        const q = quarterOf(kn);
        if (!byQ.has(q)) byQ.set(q, new Map());
        const m = byQ.get(q);
        const key = addr || `__point__:${point.lat},${point.lon}`;
        const prev = m.get(key);
        if (!prev) m.set(key, { n: 1, lat: point.lat, lon: point.lon, t: point.t || "", addr });
        else prev.n += 1;
    }
    for (const [q, m] of byQ) {
        let best = null;
        for (const v of m.values()) {
            if (!best || v.n > best.n || (v.addr && !best.addr)) best = v;
        }
        if (best) {
            out.set(q, {
                addr: best.addr || "",
                lat: best.lat,
                lon: best.lon,
                t: best.t || ""
            });
        }
    }
    return out;
}

function missesWithoutPoint(last) {
    const out = [];
    for (const [kn, row] of last) {
        if (compactPoint(row)) continue;
        if (!/не найден в НСПД|нет координат/i.test(String(row.err || ""))) continue;
        out.push(kn);
    }
    return out;
}

async function main() {
    ensureGeocodeDir();
    const last = lastRowByKn();
    const kns = missesWithoutPoint(last);
    const qBest = quarterBest(last);
    const useKadbase = /^(1|true|yes)$/i.test(String(process.env.GEOCODE_FALLBACK_KADBASE || ""));
    const withQ = kns.filter((kn) => qBest.has(quarterOf(kn))).length;
    console.log(
        `без точки НСПД: ${kns.length}, с данными квартала: ${withQ}, геокодер: ${
            process.env.YANDEX_MAPS_API_KEY ? "Яндекс+OSM" : "OSM"
        }${useKadbase ? ", kadbase вкл." : ""}`
    );

    const jsonl = fs.createWriteStream(COORDS_JSONL_PATH, { flags: "a" });
    let ok = 0;
    let fail = 0;
    let byGeocode = 0;
    let byQuarter = 0;

    for (const kn of kns) {
        const q = quarterOf(kn);
        const neighbor = qBest.get(q);
        let result = { found: false, message: "нет данных" };

        if (neighbor?.addr) {
            result = await geocodeCadastralByKnownAddress(kn, neighbor.addr, {
                objectType: neighbor.t || ""
            });
        } else if (useKadbase) {
            result = await geocodeCadastralByKadbase(kn);
        }

        // ponytail: OSM/Яндекс часто не едят кадастровый адрес — берём точку соседа по кварталу
        if (!result.found && neighbor && Number.isFinite(neighbor.lat) && Number.isFinite(neighbor.lon)) {
            result = {
                found: true,
                cadastralNumber: kn,
                lat: neighbor.lat,
                lon: neighbor.lon,
                address: neighbor.addr || "",
                objectType: neighbor.t || "",
                source: "quarter",
                approximate: true
            };
        }

        let line;
        if (result.found) {
            ok += 1;
            if (result.source === "quarter") byQuarter += 1;
            else byGeocode += 1;
            jsonl.write(
                JSON.stringify({
                    kn: result.cadastralNumber || kn,
                    ok: true,
                    lat: result.lat,
                    lon: result.lon,
                    t: result.objectType || "",
                    addr: result.address || neighbor?.addr || "",
                    src: result.source || "addr"
                }) + "\n"
            );
            line = `a+ ${kn}  ${result.lat.toFixed(6)}  ${result.lon.toFixed(6)}  ${result.source || "addr"}`.trim();
        } else {
            fail += 1;
            line = `a− ${kn}  ${result.message || "нет точки"}`;
        }
        fs.appendFile(PROGRESS_LOG_PATH, line + "\n", () => {});
        console.log(`${ok + fail}/${kns.length} ${line}`);
        if (useKadbase && /ограничил автоматический доступ/i.test(result.message || "")) {
            console.log("kadbase упёрся в лимит — останавливаюсь");
            break;
        }
    }
    await new Promise((resolve) => jsonl.end(resolve));
    console.log(`готово: ${ok} точек (геокодер ${byGeocode}, квартал ${byQuarter}), ${fail} без точки`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
