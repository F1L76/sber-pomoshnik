#!/usr/bin/env node
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { httpsFetchBuffer } from "../lib/https-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "data", "deals");
const BASE = "https://rosreestr.gov.ru/data-sets/";

const QUARTERS = [
    { q: 1, folder: "1%20%EA%E2%E0%F0%F2%E0%EB%202024%E3./" },
    { q: 2, folder: "2%20%EA%E2%E0%F0%F2%E0%EB%202024%E3./" },
    { q: 3, folder: "3%20%EA%E2%E0%F0%F2%E0%EB%202024%E3./" },
    { q: 4, folder: "4%20%EA%E2%E0%F0%F2%E0%EB%202024%E3./" }
];

const DATASETS = [
  {
    localName: (q) => `dataset_СДЕЛКИ_r-r_01-92_y_2024_q_${q}.csv`,
    remoteName: (q) => `dataset_%D1%C4%C5%CB%CA%C8_r-r_01-92_y_2024_q_${q}.csv`
  },
  {
    localName: (q) => `dataset_АРЕНДА_r-r_01-92_y_2024_q_${q}.csv`,
    remoteName: (q) => `dataset_%C0%D0%C5%CD%C4%C0_r-r_01-92_y_2024_q_${q}.csv`
  }
];

async function downloadBuffer(url) {
  const res = await httpsFetchBuffer(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "*/*",
      Referer: "https://rosreestr.gov.ru/data-sets/"
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} для ${url}`);
  }
  return res.buffer;
}

function looksLikeCsv(buf) {
  if (!buf?.length || buf.length < 1024) return false;
  const head = buf.subarray(0, 200).toString("utf8").trimStart();
  return !head.startsWith("<!") && !head.startsWith("<html") && head.includes("~");
}

async function loadCsvBuffer(folder, remoteBase, q) {
  const csvUrl = `${BASE}${folder}${remoteBase(q)}`;
  try {
    const buf = await downloadBuffer(csvUrl);
    if (looksLikeCsv(buf)) return buf;
  } catch {
    /* try zip */
  }

  const zipUrl = `${csvUrl}.zip`;
  const zipBuf = await downloadBuffer(zipUrl);
  const tmpZip = path.join(OUT_DIR, `.tmp_${remoteBase(q)}.zip`);
  fs.writeFileSync(tmpZip, zipBuf);
  try {
    const out = execFileSync("unzip", ["-p", tmpZip], { maxBuffer: 1024 * 1024 * 1024 });
    return Buffer.from(out);
  } finally {
    fs.unlinkSync(tmpZip);
  }
}

function gzipFile(csvPath, gzPath) {
  const input = fs.readFileSync(csvPath);
  const gz = zlib.gzipSync(input, { level: 9 });
  fs.writeFileSync(gzPath, gz);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const { q, folder } of QUARTERS) {
    for (const ds of DATASETS) {
      const localCsv = path.join(OUT_DIR, ds.localName(q));
      const localGz = `${localCsv}.gz`;

      if (fs.existsSync(localGz)) {
        console.log(`skip ${path.basename(localGz)} (уже есть)`);
        continue;
      }

      console.log(`загрузка ${ds.localName(q)}…`);
      const csvBuf = await loadCsvBuffer(folder, ds.remoteName, q);
      fs.writeFileSync(localCsv, csvBuf);
      const mb = (csvBuf.length / (1024 * 1024)).toFixed(1);
      console.log(`  csv ${mb} MB`);

      gzipFile(localCsv, localGz);
      fs.unlinkSync(localCsv);
      const gzMb = (fs.statSync(localGz).size / (1024 * 1024)).toFixed(1);
      console.log(`  -> ${path.basename(localGz)} (${gzMb} MB)`);
    }
  }

  console.log("готово");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
