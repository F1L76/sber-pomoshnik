#!/usr/bin/env node
/**
 * Геокодирует кадастровые номера из xlsx через поиск НСПД (тот же API, что pynspd).
 * Кэш: data/nspd-geocode/coords.jsonl; широта/долгота пишутся в тот же xlsx.
 *
 *   node scripts/geocode-cadastral-list.mjs [xlsx]
 *   NSPD_GEOCODE_CONCURRENCY=10 node scripts/geocode-cadastral-list.mjs
 *   NSPD_GEOCODE_TIMEOUT_MS=30000 — таймаут одного запроса к НСПД (по умолчанию 30с)
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { geocodeCadastralCoords } from "../lib/cadastral-lookup.mjs";
import {
    COORDS_JSONL_PATH,
    GEOCODE_DIR,
    KN_LIST_PATH,
    PROGRESS_LOG_PATH,
    STATUS_PATH,
    compactPoint,
    ensureGeocodeDir
} from "../lib/nspd-geocode-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_XLSX = "/Users/avfilinyuk/Downloads/Список.xlsx";
const WRITE_XLSX_PY = path.join(__dirname, "write-coords-to-xlsx.py");

function parseArgs(argv) {
    let xlsx = DEFAULT_XLSX;
    let limit = 0;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--limit") {
            limit = Number(argv[++i]) || 0;
        } else if (!a.startsWith("-")) {
            xlsx = a;
        }
    }
    return { xlsx, limit };
}

function extractKnList(xlsxPath, outPath) {
    const py = `
import openpyxl, re, sys
xlsx, out = sys.argv[1], sys.argv[2]
cad_re = re.compile(r"^\\d{1,2}:\\d{1,3}:\\d+:\\d+")
wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
ws = wb.active
seen = set()
nums = []
for row in ws.iter_rows(min_row=2, values_only=True):
    v = str(row[0] or "").strip()
    if not v or v in seen:
        continue
    if v.split(":")[0] in ("0", "кадастровый"):
        continue
    if not cad_re.match(v) and not re.match(r"^\\d+:\\d+:\\d+", v):
        continue
    seen.add(v)
    nums.append(v)
open(out, "w", encoding="utf-8").write("\\n".join(nums) + "\\n")
print(len(nums))
`.trim();
    const result = spawnSync("python3", ["-c", py, xlsxPath, outPath], { encoding: "utf8" });
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || "не удалось прочитать xlsx");
    }
    return Number(String(result.stdout || "").trim()) || 0;
}

function isPermanentFail(err) {
    return /не найден в НСПД|нет координат|пустой номер/i.test(String(err || ""));
}

function pruneRetryableFails() {
    if (!fs.existsSync(COORDS_JSONL_PATH)) return { kept: 0, dropped: 0 };
    const raw = fs.readFileSync(COORDS_JSONL_PATH, "utf8");
    const keep = [];
    let dropped = 0;
    for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
            const row = JSON.parse(line);
            if (row.ok || isPermanentFail(row.err)) keep.push(line);
            else dropped += 1;
        } catch {
            dropped += 1;
        }
    }
    fs.writeFileSync(COORDS_JSONL_PATH, keep.length ? keep.join("\n") + "\n" : "");
    return { kept: keep.length, dropped };
}

function loadDoneKn() {
    const done = new Set();
    if (!fs.existsSync(COORDS_JSONL_PATH)) return done;
    const raw = fs.readFileSync(COORDS_JSONL_PATH, "utf8");
    for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
            const row = JSON.parse(line);
            const kn = row.kn || row.cadastralNumber;
            if (kn) done.add(String(kn));
        } catch {
            /* skip broken line */
        }
    }
    return done;
}

function writeStatus(status) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
}

function writeCoordsToXlsx(xlsxPath, { wait = false } = {}) {
    const args = ["python3", WRITE_XLSX_PY, xlsxPath, COORDS_JSONL_PATH];
    if (wait) {
        const result = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.status !== 0) {
            console.error(result.stderr || "не удалось записать координаты в xlsx");
        }
        return;
    }
    if (writeCoordsToXlsx.child) return;
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "inherit", "inherit"] });
    writeCoordsToXlsx.child = child;
    child.on("exit", () => {
        writeCoordsToXlsx.child = null;
    });
}

async function poolMap(items, concurrency, worker) {
    let index = 0;
    async function run() {
        while (index < items.length) {
            const i = index++;
            await worker(items[i], i);
        }
    }
    const n = Math.max(1, Math.min(concurrency, items.length || 1));
    await Promise.all(Array.from({ length: n }, run));
}

async function main() {
    const { xlsx, limit } = parseArgs(process.argv.slice(2));
    const concurrency = Math.max(1, Number(process.env.NSPD_GEOCODE_CONCURRENCY) || 10);
    ensureGeocodeDir();
    const pruned = pruneRetryableFails();
    if (pruned.dropped) console.log(`убрано ложных отказов НСПД: ${pruned.dropped}, осталось ${pruned.kept}`);

    if (!fs.existsSync(xlsx)) {
        throw new Error(`нет файла списка: ${xlsx}`);
    }
    console.log(`извлечение КН из ${xlsx}…`);
    const extracted = extractKnList(xlsx, KN_LIST_PATH);
    let kns = fs.readFileSync(KN_LIST_PATH, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    if (limit > 0) kns = kns.slice(0, limit);
    const done = loadDoneKn();
    const pending = kns.filter((kn) => !done.has(kn));
    const seenQuarter = new Set();
    const firstOfQuarter = [];
    const rest = [];
    for (const kn of pending) {
        const quarter = kn.split(":").slice(0, 3).join(":");
        if (seenQuarter.has(quarter)) rest.push(kn);
        else {
            seenQuarter.add(quarter);
            firstOfQuarter.push(kn);
        }
    }
    const queue = firstOfQuarter.concat(rest);
    console.log(
        `в списке ${extracted}, к обработке ${queue.length} (уже есть ${done.size}), сначала ${firstOfQuarter.length} кварталов, потоков ${concurrency}`
    );

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let ok = 0;
    let fail = 0;
    const recent = [];
    for (const kn of done) {
        /* already counted in file; recount ok/fail lazily via status only for this run */
        void kn;
    }
    if (fs.existsSync(COORDS_JSONL_PATH)) {
        for (const line of fs.readFileSync(COORDS_JSONL_PATH, "utf8").split("\n")) {
            if (!line) continue;
            try {
                const row = JSON.parse(line);
                if (compactPoint(row)) ok += 1;
                else fail += 1;
            } catch {
                fail += 1;
            }
        }
    }

    const jsonlStream = fs.createWriteStream(COORDS_JSONL_PATH, { flags: "a" });
    const appendRow = (row) => {
        jsonlStream.write(JSON.stringify(row) + "\n");
    };

    const total = kns.length;
    const processedAtStart = done.size;
    let processed = processedAtStart;

    const flushStatus = (running = true) => {
        const elapsedSec = (Date.now() - t0) / 1000;
        const newly = processed - processedAtStart;
        const rate = newly > 0 ? newly / Math.max(elapsedSec, 0.001) : 0;
        const left = total - processed;
        writeStatus({
            running,
            pid: process.pid,
            total,
            done: processed,
            ok,
            fail,
            concurrency,
            ratePerSec: Math.round(rate * 10) / 10,
            etaSec: rate > 0 ? Math.round(left / rate) : null,
            startedAt,
            updatedAt: new Date().toISOString(),
            source: path.basename(xlsx),
            recent
        });
    };
    flushStatus(true);

    await poolMap(queue, concurrency, async (kn) => {
        let result = { found: false, permanent: false, message: "ошибка" };
        for (let attempt = 0; attempt < 3; attempt++) {
            result = await geocodeCadastralCoords(kn, { retries: 1 });
            if (result.found || result.permanent) break;
            await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        }
        processed += 1;
        let line;
        if (result.found) {
            ok += 1;
            const knOut = result.cadastralNumber || kn;
            appendRow({
                kn: knOut,
                ok: true,
                lat: result.lat,
                lon: result.lon,
                t: result.objectType || "",
                addr: result.address || ""
            });
            line = `+ ${knOut}  ${result.lat.toFixed(6)}  ${result.lon.toFixed(6)}  ${result.objectType || ""}`.trim();
            recent.push({ kn: knOut, ok: true, lat: result.lat, lon: result.lon, t: result.objectType || "" });
        } else if (result.permanent) {
            fail += 1;
            appendRow({ kn, ok: false, err: result.message || "ошибка" });
            line = `− ${kn}  ${result.message || "ошибка"}`;
            recent.push({ kn, ok: false, err: result.message || "ошибка" });
        } else {
            fail += 1;
            line = `~ ${kn}  ${result.message || "НСПД временно недоступен, повторю позже"}`;
            recent.push({ kn, ok: false, err: result.message || "повтор" });
        }
        if (recent.length > 40) recent.shift();
        const full = `${processed}/${total} ${line}`;
        fs.appendFile(PROGRESS_LOG_PATH, full + "\n", () => {});
        console.log(full);
        if (processed % 10 === 0 || processed === total) flushStatus(true);
        if (processed % 200 === 0) writeCoordsToXlsx(xlsx);
    });

    await new Promise((resolve) => jsonlStream.end(resolve));
    flushStatus(false);
    writeCoordsToXlsx(xlsx, { wait: true });
    console.log(`готово: ${ok} координат, ${fail} без точки, файл ${xlsx}`);
}

main().catch((err) => {
    console.error(err.message || err);
    try {
        const prev = fs.existsSync(STATUS_PATH) ? JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) : {};
        fs.writeFileSync(
            STATUS_PATH,
            JSON.stringify({ ...prev, running: false, error: err.message || String(err), updatedAt: new Date().toISOString() }, null, 2)
        );
    } catch {
        /* ignore */
    }
    process.exit(1);
});
