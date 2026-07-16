import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { convertZalogFiles } from "./zalog-convert.mjs";

const JOB_DIR = path.join(os.tmpdir(), "sber-zalog-jobs");
const TTL_MS = 20 * 60 * 1000;
// ponytail: после рестарта Render job остаётся running на диске без воркера
const STALE_RUNNING_MS = 12 * 60 * 1000;

function ensureJobDir() {
    fs.mkdirSync(JOB_DIR, { recursive: true });
}

function jobPath(jobId) {
    const safe = String(jobId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) throw new Error("Некорректный идентификатор задачи");
    return path.join(JOB_DIR, `${safe}.json`);
}

function writeJob(jobId, data) {
    ensureJobDir();
    const tmp = `${jobPath(jobId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, jobPath(jobId));
}

function readJob(jobId) {
    try {
        const raw = fs.readFileSync(jobPath(jobId), "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function deleteJobFile(jobId) {
    try {
        fs.unlinkSync(jobPath(jobId));
    } catch {
        /* ignore */
    }
}

function pruneJobs() {
    ensureJobDir();
    const now = Date.now();
    for (const name of fs.readdirSync(JOB_DIR)) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        const job = readJob(id);
        if (!job) {
            deleteJobFile(id);
            continue;
        }
        const anchor = job.finishedAt || job.startedAt || 0;
        if (now - anchor > TTL_MS) deleteJobFile(id);
    }
}

function refreshStale(job) {
    if (!job || job.status !== "running") return job;
    const age = Date.now() - (job.startedAt || 0);
    if (age <= STALE_RUNNING_MS) return job;
    return {
        status: "error",
        error: "Конвертация прервалась (перезапуск сервера). Повторите попытку.",
        finishedAt: Date.now(),
        startedAt: job.startedAt
    };
}

export function createZalogConvertJob(pdfBytes, xlsxBytes) {
    pruneJobs();
    const jobId = crypto.randomUUID();
    const startedAt = Date.now();
    writeJob(jobId, {
        status: "running",
        startedAt
    });

    convertZalogFiles(pdfBytes, xlsxBytes)
        .then((result) => {
            writeJob(jobId, {
                status: "done",
                result,
                startedAt,
                finishedAt: Date.now()
            });
        })
        .catch((err) => {
            writeJob(jobId, {
                status: "error",
                error: err.message || String(err),
                startedAt,
                finishedAt: Date.now()
            });
        });

    return jobId;
}

export function getZalogConvertJob(jobId) {
    pruneJobs();
    let job = readJob(jobId);
    if (!job) return null;
    const refreshed = refreshStale(job);
    if (refreshed !== job && refreshed.status === "error") {
        writeJob(jobId, refreshed);
    }
    return refreshed;
}
