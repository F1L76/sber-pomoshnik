/**
 * Базы НСПД. С Render напрямую .gov.ru часто недоступен —
 * задайте NSPD_BASES на URL edge-прокси в РФ (см. scripts/nspd-edge-proxy.mjs).
 *
 * Пример: NSPD_BASES=https://xxxx.trycloudflare.com
 * Ключ (обязателен при туннеле): NSPD_PROXY_KEY — тот же на edge-прокси и здесь.
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

/** Заголовок для edge-прокси (NSPD_BASES + NSPD_PROXY_KEY на обеих сторонах). */
export function getNspdProxyAuthHeaders() {
    const key = String(process.env.NSPD_PROXY_KEY || "").trim();
    if (!key) return {};
    return { "X-NSPD-Proxy-Key": key };
}

export const NSPD_REFERER = "https://nspd.gov.ru/map?thematic=PKK";
