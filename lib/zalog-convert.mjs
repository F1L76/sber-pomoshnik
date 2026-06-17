import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { parseMultipartFormData } from "./multipart-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CLI_SCRIPT = path.join(ROOT, "scripts", "zalog_convert_cli.py");
const MAX_UPLOAD_MB = 25;

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
            env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
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
                reject(new Error(msg || `Python завершился с кодом ${code}`));
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

export async function convertZalogMultipart(req) {
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
    return convertZalogFiles(pdf.data, xlsx.data);
}

export function getZalogConverterHealth() {
    const python = findPython();
    const hasPython = fs.existsSync(python) || python === "python3";
    const hasCli = fs.existsSync(CLI_SCRIPT);
    const hasPackage = fs.existsSync(path.join(ROOT, "zalog_converter", "merge.py"));
    return {
        ok: hasCli && hasPackage,
        python,
        hasPython,
        mode: "rule-based",
        gigachat: false,
        package: hasPackage
    };
}
