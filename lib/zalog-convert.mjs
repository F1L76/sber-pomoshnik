import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { parseMultipartFormData } from "./multipart-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CLI_SCRIPT = path.join(ROOT, "scripts", "zalog_convert_cli.py");
const PYTHON_DEPS = path.join(ROOT, "python-deps");
const MAX_UPLOAD_MB = 25;

function pythonEnv() {
    const parts = [PYTHON_DEPS, process.env.PYTHONPATH].filter(Boolean);
    return {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        ...(parts.length ? { PYTHONPATH: parts.join(path.delimiter) } : {})
    };
}

function friendlyPythonError(raw) {
    const msg = String(raw || "").trim();
    if (!msg) return "Ошибка Python-конвертера";
    if (/ModuleNotFoundError|No module named/i.test(msg)) {
        const mod = msg.match(/No module named ['"]([^'"]+)['"]/)?.[1];
        return mod
            ? `Не установлен Python-модуль «${mod}». На сервере выполните npm run zalog:install`
            : "Не установлены Python-зависимости (pdfplumber, openpyxl). Выполните npm run zalog:install";
    }
    if (/ENOENT|spawn .*python/i.test(msg)) {
        return "Python 3 не найден. Укажите PYTHON_PATH или установите Python на сервере.";
    }
    try {
        const parsed = JSON.parse(msg);
        if (parsed.error) return String(parsed.error);
    } catch {
        /* ignore */
    }
    const line = msg.split("\n").map((s) => s.trim()).filter(Boolean).pop();
    return line && line.length < 300 ? line : "Ошибка обработки PDF/XLSX";
}

function findPython() {
    if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
    for (const bin of ["python3", "python"]) {
        try {
            const candidates = [
                bin,
                `/usr/bin/${bin}`,
                `/usr/local/bin/${bin}`,
                `/opt/homebrew/bin/${bin}`
            ];
            for (const p of candidates) {
                if (fs.existsSync(p)) return p;
            }
        } catch {
            /* ignore */
        }
    }
    return "python3";
}

function runPython(python, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, {
            cwd: ROOT,
            env: pythonEnv(),
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c) => (stdout += c));
        child.stderr.on("data", (c) => (stderr += c));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                let msg = stderr.trim() || stdout.trim();
                try {
                    const parsed = JSON.parse(stdout.trim() || stderr.trim());
                    if (parsed.error) msg = parsed.error;
                } catch {
                    /* ignore */
                }
                reject(new Error(friendlyPythonError(msg || `Python завершился с кодом ${code}`)));
                return;
            }
            resolve(stdout);
        });
    });
}

export async function convertZalogFiles(pdfBytes, xlsxBytes) {
    if (!pdfBytes?.length) throw new Error("PDF-файл пустой");
    if (!xlsxBytes?.length) throw new Error("XLSX-файл пустой");
    const limit = MAX_UPLOAD_MB * 1024 * 1024;
    if (pdfBytes.length > limit) throw new Error(`PDF больше ${MAX_UPLOAD_MB} МБ`);
    if (xlsxBytes.length > limit) throw new Error(`XLSX больше ${MAX_UPLOAD_MB} МБ`);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zalog-"));
    const pdfPath = path.join(tmpDir, "conclusion.pdf");
    const xlsxPath = path.join(tmpDir, "objects.xlsx");
    try {
        fs.writeFileSync(pdfPath, pdfBytes);
        fs.writeFileSync(xlsxPath, xlsxBytes);
        const python = findPython();
        const stdout = await runPython(python, [CLI_SCRIPT, pdfPath, xlsxPath]);
        const payload = JSON.parse(stdout);
        if (!payload.ok) throw new Error(payload.error || "Ошибка конвертера");
        return payload;
    } finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    }
}

export async function readZalogUpload(req) {
    const contentType = req.headers["content-type"] || "";
    if (!/multipart\/form-data/i.test(contentType)) {
        throw new Error("Ожидается multipart/form-data с полями pdf и xlsx");
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const parts = parseMultipartFormData(buffer, contentType);
    const pdf = parts.get("pdf");
    const xlsx = parts.get("xlsx");
    if (!pdf?.data?.length || !xlsx?.data?.length) {
        throw new Error("Загрузите оба файла: PDF заключение и XLSX перечень залога");
    }
    return { pdfBytes: pdf.data, xlsxBytes: xlsx.data };
}

export async function convertZalogMultipart(req) {
    const { pdfBytes, xlsxBytes } = await readZalogUpload(req);
    return convertZalogFiles(pdfBytes, xlsxBytes);
}

export async function probeZalogPythonDeps() {
    const python = findPython();
    try {
        await runPython(python, ["-c", "import pdfplumber, openpyxl"]);
        return { ok: true, python };
    } catch (e) {
        return { ok: false, python, error: e.message || String(e) };
    }
}

/** Установить pdfplumber/openpyxl в python-deps, если при старте их нет (Render и т.п.). */
export async function ensureZalogPythonDeps() {
    let probe = await probeZalogPythonDeps();
    if (probe.ok) return probe;

    const python = findPython();
    const requirements = path.join(ROOT, "requirements-zalog.txt");
    if (!fs.existsSync(requirements)) {
        return { ...probe, installSkipped: true };
    }

    console.log("[zalog] Python-зависимости не найдены, выполняем pip install…");
    const result = spawnSync(
        python,
        ["-m", "pip", "install", "-r", requirements, "-t", PYTHON_DEPS],
        { cwd: ROOT, env: pythonEnv(), encoding: "utf-8", timeout: 300_000 }
    );
    if (result.status !== 0) {
        const err = (result.stderr || result.stdout || "").trim().slice(0, 500);
        console.error("[zalog] pip install failed:", err || `exit ${result.status}`);
        probe = await probeZalogPythonDeps();
        return { ...probe, installError: err || `pip exit ${result.status}` };
    }

    probe = await probeZalogPythonDeps();
    if (probe.ok) console.log("[zalog] Python-зависимости установлены:", probe.python);
    return probe;
}

export function getZalogConverterHealth() {
    const python = findPython();
    const hasCli = fs.existsSync(CLI_SCRIPT);
    const hasPackage = fs.existsSync(path.join(ROOT, "zalog_converter", "merge.py"));
    const hasBundledDeps =
        fs.existsSync(path.join(PYTHON_DEPS, "pdfplumber")) ||
        fs.existsSync(path.join(PYTHON_DEPS, "pdfplumber", "__init__.py"));
    return {
        ok: hasCli && hasPackage,
        python,
        hasPython: fs.existsSync(python) || python === "python3",
        pythonDepsBundled: hasBundledDeps,
        mode: "rule-based",
        gigachat: false,
        package: hasPackage
    };
}
