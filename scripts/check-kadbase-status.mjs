#!/usr/bin/env node
/**
 * Статус объектов без точки НСПД через kadbase.ru (снят с учёта / учтён / не найден).
 * Resume: data/nspd-geocode/kadbase-status.jsonl
 *
 *   node scripts/check-kadbase-status.mjs
 *   KADBASE_STATUS_DELAY_MS=15000 node scripts/check-kadbase-status.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { lookupKadbaseObject } from "../lib/kadbase-lookup.mjs";
import { COORDS_JSONL_PATH, GEOCODE_DIR, ensureGeocodeDir } from "../lib/nspd-geocode-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_JSONL = path.join(GEOCODE_DIR, "kadbase-status.jsonl");
const STATUS_XLSX = path.join(GEOCODE_DIR, "kadbase-status.xlsx");
const MISS_TXT = path.join(GEOCODE_DIR, "bez-tochki-nspd.txt");
const DELAY_MS = Math.max(2000, Number(process.env.KADBASE_STATUS_DELAY_MS) || 12_000);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDone() {
    const done = new Map();
    if (!fs.existsSync(STATUS_JSONL)) return done;
    for (const line of fs.readFileSync(STATUS_JSONL, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
            const row = JSON.parse(line);
            const kn = String(row.kn || "").trim();
            if (kn) done.set(kn, row);
        } catch {
            /* skip */
        }
    }
    return done;
}

function loadMissList() {
    if (fs.existsSync(MISS_TXT)) {
        return fs
            .readFileSync(MISS_TXT, "utf8")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    // fallback: без точки в coords.jsonl
    const last = new Map();
    if (!fs.existsSync(COORDS_JSONL_PATH)) return [];
    for (const line of fs.readFileSync(COORDS_JSONL_PATH, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
            const row = JSON.parse(line);
            const kn = String(row.kn || "").trim();
            if (kn) last.set(kn, row);
        } catch {
            /* skip */
        }
    }
    return [...last.entries()]
        .filter(([, r]) => !(r.ok && r.lat != null && r.lon != null))
        .map(([kn]) => kn);
}

function classify(row) {
    const status = String(row.status || "").toLowerCase();
    if (!row.found) return "не найден в kadbase";
    if (/снят/.test(status)) return "снят с учета";
    if (/учтен|учтён|времен/.test(status)) return "на учете";
    if (status) return status;
    return "найден, статус пуст";
}

async function writeXlsxSummary() {
    const { spawnSync } = await import("child_process");
    const py = `
import json, sys
from openpyxl import Workbook
from collections import Counter
from pathlib import Path
path, out, dl = sys.argv[1], sys.argv[2], sys.argv[3]
rows=[]
if Path(path).exists():
  for line in Path(path).read_text(encoding="utf-8").splitlines():
    if not line.strip(): continue
    try: rows.append(json.loads(line))
    except: pass
wb=Workbook()
ws=wb.active
ws.title="статусы"
ws.append(["кадастровый","класс","статус_kadbase","тип","адрес","найдено","ошибка"])
c=Counter()
for r in rows:
  cls=r.get("klass") or ""
  c[cls]+=1
  ws.append([r.get("kn"), cls, r.get("status") or "", r.get("type") or "", r.get("addr") or "", "да" if r.get("found") else "нет", r.get("err") or ""])
ws2=wb.create_sheet("сводка")
ws2.append(["класс","количество"])
for k,n in c.most_common():
  ws2.append([k,n])
wb.save(out)
wb.save(dl)
print("xlsx", len(rows), dict(c))
`;
    const dl = "/Users/avfilinyuk/Downloads/kadbase-status.xlsx";
    const r = spawnSync("python3", ["-c", py, STATUS_JSONL, STATUS_XLSX, dl], { encoding: "utf8" });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.status !== 0) console.error(r.stderr || "xlsx fail");
}

async function main() {
    ensureGeocodeDir();
    const all = loadMissList();
    const done = loadDone();
    const queue = all.filter((kn) => !done.has(kn));
    console.log(
        `к проверке ${queue.length} (уже есть ${done.size} из ${all.length}), пауза ${DELAY_MS}мс`
    );
    if (!queue.length) {
        await writeXlsxSummary();
        return;
    }

    const stream = fs.createWriteStream(STATUS_JSONL, { flags: "a" });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < queue.length; i++) {
        const kn = queue[i];
        let row;
        try {
            const kb = await lookupKadbaseObject(kn, { attempts: 1 });
            if (/ограничил автоматический доступ/i.test(kb.message || "")) {
                console.log(`лимит kadbase на ${kn} — останавливаюсь, продолжите позже`);
                break;
            }
            row = {
                kn,
                found: Boolean(kb.found),
                status: kb.status || "",
                type: kb.objectType || "",
                addr: kb.address || "",
                err: kb.found ? "" : kb.message || "",
                at: new Date().toISOString()
            };
            row.klass = classify(row);
        } catch (e) {
            row = {
                kn,
                found: false,
                status: "",
                type: "",
                addr: "",
                err: e.message || String(e),
                klass: "ошибка",
                at: new Date().toISOString()
            };
        }
        if (row.found) ok += 1;
        else fail += 1;
        stream.write(JSON.stringify(row) + "\n");
        console.log(`${i + 1}/${queue.length} ${row.klass}  ${kn}  ${row.status || row.err || ""}`.trim());
        if (i < queue.length - 1) await sleep(DELAY_MS);
        if ((i + 1) % 25 === 0) await writeXlsxSummary();
    }
    await new Promise((resolve) => stream.end(resolve));
    await writeXlsxSummary();
    console.log(`готово за этот заход: найдено ${ok}, не найдено ${fail}`);
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
