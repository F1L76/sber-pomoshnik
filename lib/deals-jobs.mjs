import crypto from "crypto";
import { searchDealsByQuarter, searchDealsReport } from "./deals-lookup.mjs";

const jobs = new Map();
const TTL_MS = 15 * 60 * 1000;

function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - (job.finishedAt || job.startedAt) > TTL_MS) jobs.delete(id);
    }
}

function runJob(jobId, promise) {
    promise
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
}

export function createDealsJob(quarter, options = {}) {
    pruneJobs();
    const jobId = crypto.randomUUID();
    jobs.set(jobId, {
        status: "running",
        quarter,
        year: options.year ?? null,
        startedAt: Date.now()
    });
    runJob(jobId, searchDealsByQuarter(quarter, options));
    return jobId;
}

export function createDealsReportJob(options = {}) {
    pruneJobs();
    const jobId = crypto.randomUUID();
    jobs.set(jobId, {
        status: "running",
        mode: "report",
        city: options.city || null,
        regionCode: options.regionCode ?? null,
        startedAt: Date.now()
    });
    runJob(jobId, searchDealsReport(options));
    return jobId;
}

export function getDealsJob(jobId) {
    pruneJobs();
    return jobs.get(jobId) || null;
}
