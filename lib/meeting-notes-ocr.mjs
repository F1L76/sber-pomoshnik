/**
 * OCR заметок через macOS Vision (swift scripts/meeting-notes-mvp.swift --ocr-only).
 * Без LLM. HEIC → JPEG через sips при необходимости.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { parseMultipartFormData } from "./multipart-parse.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SWIFT_SCRIPT = path.join(ROOT, "scripts", "meeting-notes-mvp.swift");
const MAX_UPLOAD_MB = 15;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${cmd} exit ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function extFromName(name = "", mime = "") {
  const fromName = path.extname(name).toLowerCase();
  if (fromName) return fromName;
  if (/jpeg|jpg/i.test(mime)) return ".jpg";
  if (/png/i.test(mime)) return ".png";
  if (/webp/i.test(mime)) return ".webp";
  if (/heic|heif/i.test(mime)) return ".heic";
  if (/gif/i.test(mime)) return ".gif";
  return ".jpg";
}

async function ensureJpegIfNeeded(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (![".heic", ".heif", ".tiff", ".tif"].includes(ext)) return inputPath;
  const out = inputPath.replace(/\.[^.]+$/, "") + ".jpg";
  await run("sips", ["-s", "format", "jpeg", inputPath, "--out", out]);
  return out;
}

/** @returns {Promise<{ text: string, engine: string }>} */
export async function ocrImageBuffer(bytes, { filename = "notes.jpg", mime = "" } = {}) {
  if (!bytes?.length) throw new Error("Пустое изображение");
  if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`Файл больше ${MAX_UPLOAD_MB} МБ`);
  }
  if (process.platform !== "darwin") {
    throw new Error("Серверный OCR (Vision) доступен только на macOS. Вставьте текст вручную.");
  }
  if (!fs.existsSync(SWIFT_SCRIPT)) {
    throw new Error("Не найден scripts/meeting-notes-mvp.swift");
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-notes-"));
  const ext = extFromName(filename, mime);
  let imgPath = path.join(dir, `in${ext}`);
  try {
    fs.writeFileSync(imgPath, bytes);
    imgPath = await ensureJpegIfNeeded(imgPath);
    const { stdout } = await run("swift", [SWIFT_SCRIPT, imgPath, "--ocr-only"]);
    const text = stdout.trim();
    if (!text) throw new Error("OCR вернул пустой текст — проверьте качество фото");
    return { text, engine: "macos-vision" };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function ocrFromMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  if (!/multipart\/form-data/i.test(contentType)) {
    throw new Error("Ожидается multipart/form-data с полем image");
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("Пустое тело загрузки");
  const parts = parseMultipartFormData(buffer, contentType);
  const part = parts.get("image") || parts.get("file") || parts.get("photo");
  if (!part?.data?.length) {
    throw new Error(`Нет поля image (поля: ${[...parts.keys()].join(", ") || "нет"})`);
  }
  return ocrImageBuffer(part.data, { filename: part.filename || "notes.jpg" });
}
