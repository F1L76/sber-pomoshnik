#!/usr/bin/env node
/**
 * Сборка data/rosreestr-classifier.json из PDF справочника Росреестра.
 * Требует: python3 + pypdf (pip install pypdf)
 *
 * Использование:
 *   node scripts/build-rosreestr-classifier.mjs [путь-к-pdf]
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "data", "rosreestr-classifier.json");
const pdfPath = process.argv[2] || path.join(process.env.HOME || "", "Downloads", "rosreestr.gov.ru.pdf");

if (!fs.existsSync(pdfPath)) {
    console.error("PDF не найден:", pdfPath);
    process.exit(1);
}

const py = `
import json, re, sys
import pypdf
text = "\\n".join((p.extract_text() or "") for p in pypdf.PdfReader(sys.argv[1]).pages)
codes = {}
for m in re.finditer(r'(?:^|\\s)(\\d{11,12})\\s+((?:(?!\\s\\d{11,12}\\s).)+)', text, re.M | re.S):
    c = m.group(1).zfill(12)
    v = re.sub(r'\\s+', ' ', m.group(2)).strip()
    v = re.split(r'\\s*(?:СПРАВОЧНИК|Классификатор видов|Назначение зданий|Назначение помещений|Перечень наименований)\\s*', v)[0].strip()
    if len(v) < 2 or 'Классификационный код' in v:
        continue
    codes[c] = v
codes.update({
    "002001001000": "Земельный участок",
    "002001002000": "Здание",
    "002001003000": "Помещение",
    "002001004000": "Сооружение",
    "002001005000": "Объект незавершенного строительства",
    "002001009000": "Машино-место",
})
json.dump({"source": sys.argv[1], "codes": codes}, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(len(codes))
`;

const install = spawnSync("python3", ["-m", "pip", "install", "pypdf", "-q"], { stdio: "inherit" });
if (install.status !== 0) process.exit(install.status || 1);

const run = spawnSync("python3", ["-c", py, pdfPath, outPath], { encoding: "utf8" });
if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    process.exit(run.status || 1);
}
console.log(`Справочник: ${run.stdout.trim()} кодов → ${outPath}`);
