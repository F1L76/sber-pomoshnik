#!/usr/bin/env node
/**
 * Мини-сервер только для заметок со встречи.
 * Статика + POST /api/meeting-notes/ocr (macOS Vision).
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ocrFromMultipart } from "./lib/meeting-notes-ocr.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8788;
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(res, filePath) {
  if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": MIME[ext] || "application/octet-stream" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "POST" && url.pathname === "/api/meeting-notes/ocr") {
    try {
      const result = await ocrFromMultipart(req);
      send(res, 200, JSON.stringify({ ok: true, ...result }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (e) {
      const msg = e.message || String(e);
      const status = /пустое|ожидается|нет поля|больше/i.test(msg) ? 400 : 500;
      send(res, status, JSON.stringify({ ok: false, error: msg }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    }
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/meeting-notes" || url.pathname === "/notes") {
    serveFile(res, path.join(__dirname, "meeting-notes.html"));
    return;
  }

  const safe = path.normalize(path.join(__dirname, decodeURIComponent(url.pathname)));
  serveFile(res, safe);
});

server.listen(PORT, HOST, () => {
  console.log(`Meeting notes: http://${HOST}:${PORT}/`);
  console.log(`OCR: macOS Vision (нужен Swift). Запасной — Tesseract в браузере.`);
});
