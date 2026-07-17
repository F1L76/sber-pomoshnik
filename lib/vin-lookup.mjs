import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CLI_SCRIPT = path.join(ROOT, "scripts", "vin_lookup_cli.py");
const VIN_CHECKER_ROOT = path.join(ROOT, "vin_checker");
const MAX_VINS = 50;

function pythonEnv() {
    const parts = [VIN_CHECKER_ROOT, process.env.PYTHONPATH].filter(Boolean);
    return {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        ...(parts.length ? { PYTHONPATH: parts.join(path.delimiter) } : {})
    };
}

function findPython() {
    if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
    for (const bin of ["python3", "python"]) {
        const candidates = [bin, `/usr/bin/${bin}`, `/usr/local/bin/${bin}`, `/opt/homebrew/bin/${bin}`];
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
    }
    return "python3";
}

function lookupTimeoutMs(vinCount) {
    // drom may wait/retry on 429 (~50s+) + NHTSA
    if (vinCount <= 1) return 180_000;
    return Math.min(900_000, 60_000 + vinCount * 20_000);
}

function runVinLookup(python, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(python, [CLI_SCRIPT], {
            cwd: ROOT,
            env: pythonEnv(),
            stdio: ["pipe", "pipe", "pipe"]
        });
        const outChunks = [];
        const errChunks = [];
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGTERM");
            reject(new Error(`Превышено время ожидания (${Math.round(timeoutMs / 1000)} с)`));
        }, timeoutMs);

        child.stdout.on("data", (c) => outChunks.push(c));
        child.stderr.on("data", (c) => errChunks.push(c));
        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const stdout = Buffer.concat(outChunks).toString("utf8").trim();
            const stderr = Buffer.concat(errChunks).toString("utf8").trim();
            try {
                const parsed = JSON.parse(stdout || "{}");
                if (parsed.error) {
                    reject(new Error(parsed.error));
                    return;
                }
                if (code !== 0 && !parsed.results) {
                    reject(new Error(stderr || stdout || `Python exit ${code}`));
                    return;
                }
                resolve(parsed);
            } catch {
                reject(new Error(stderr || stdout || "Ошибка парсинга ответа VIN lookup"));
            }
        });

        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
    });
}

export function countVins({ vins = [], plates = [], queries = [], text = "", plate = "" } = {}) {
    if (String(plate || "").trim()) return 1;
    if (Array.isArray(queries) && queries.length) return Math.min(queries.length, MAX_VINS);
    if (Array.isArray(plates) && plates.length) return Math.min(plates.length, MAX_VINS);
    if (Array.isArray(vins) && vins.length) return Math.min(vins.length, MAX_VINS);
    const found = String(text || "").toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/g);
    if (found?.length) return Math.min(found.length, MAX_VINS);
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    return Math.min(Math.max(lines.length, 0), MAX_VINS);
}

export async function lookupVins({ vins = [], plates = [], queries = [], text = "", plate = "" } = {}) {
    let payload;
    if (Array.isArray(queries) && queries.length) {
        payload = { queries: queries.map((v) => String(v).trim()).filter(Boolean).slice(0, MAX_VINS) };
    } else if (Array.isArray(plates) && plates.length) {
        payload = { plates: plates.map((v) => String(v).trim()).filter(Boolean).slice(0, MAX_VINS) };
    } else if (Array.isArray(vins) && vins.length) {
        payload = { vins: vins.map((v) => String(v).trim()).filter(Boolean).slice(0, MAX_VINS) };
    } else if (plate) {
        payload = { plate: String(plate).trim() };
    } else {
        payload = { text: String(text || "") };
    }

    const n = countVins(payload);
    if (!n) {
        throw new Error("Укажите VIN или госномер");
    }
    if (n > MAX_VINS) {
        throw new Error(`Не более ${MAX_VINS} номеров за один запрос`);
    }

    const python = findPython();
    return runVinLookup(python, payload, lookupTimeoutMs(n));
}

export async function checkVinHealth() {
    const python = findPython();
    if (!fs.existsSync(CLI_SCRIPT)) {
        return { ok: false, python, error: "scripts/vin_lookup_cli.py не найден" };
    }
    try {
        const data = await runVinLookup(python, { vins: ["WMA58WZZ8JM786405"] }, 60_000);
        const sample = data.results?.[0];
        return {
            ok: Boolean(sample?.found || sample?.make),
            python,
            source: data.source || "drom",
            sampleTitle: sample?.title || null
        };
    } catch (err) {
        return { ok: false, python, error: err.message || String(err) };
    }
}
