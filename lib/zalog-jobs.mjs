import crypto from "crypto";
import { convertZalogFiles } from "./zalog-convert.mjs";

const jobs = new Map();
const TTL_MS = 20 * 60 * 1000;

function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - (job.finishedAt || job.startedAt) > TTL_MS) jobs.delete(id);
    }
}

export function createZalogConvertJob(pdfBytes, xlsxBytes) {
    pruneJobs();
    const jobId = crypto.randomUUID();
    jobs.set(jobId, {
        status: "running",
        startedAt: Date.now()
    });

    convertZalogFiles(pdfBytes, xlsxBytes)
        .then((result) => {
            jobs.set(jobId, { status: "done", result, finishedAt: Date.now() });
        })
        .catch((err) => {
            jobs.set(jobId, {
                status: "error",
                error: err.message || String(err),
                finishedAt: Date.now()
            });
        });

    return jobId;
}

export function getZalogConvertJob(jobId) {
    pruneJobs();
    return jobs.get(jobId) || null;
}
