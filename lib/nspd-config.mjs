/**
 * Базы НСПД. С Render напрямую .gov.ru часто недоступен —
 * задайте NSPD_BASES на URL edge-прокси в РФ (см. scripts/nspd-edge-proxy.mjs).
 *
 * Пример: NSPD_BASES=https://xxxx.trycloudflare.com
 * Несколько через запятую.
 */
export function getNspdBases() {
    const fromEnv = String(process.env.NSPD_BASES || "")
        .split(",")
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter(Boolean);
    if (fromEnv.length) return fromEnv;
    return ["https://nspd.gov.ru", "https://nspd.rosreestr.gov.ru"];
}

export const NSPD_REFERER = "https://nspd.gov.ru/map?thematic=PKK";
