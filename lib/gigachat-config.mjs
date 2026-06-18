/** Включение GigaChat на сервере (админ). Клиентский переключатель — в localStorage. */

function parseEnvBool(value, defaultValue = true) {
    if (value == null || String(value).trim() === "") return defaultValue;
    const s = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on", "да"].includes(s)) return true;
    if (["0", "false", "no", "off", "нет"].includes(s)) return false;
    return defaultValue;
}

export function isGigaChatEnabledOnServer() {
    return parseEnvBool(process.env.GIGACHAT_ENABLED, true);
}

export function getGigaChatPublicConfig() {
    const serverEnabled = isGigaChatEnabledOnServer();
    const hasCredentials = Boolean(process.env.GIGACHAT_CREDENTIALS);
    return {
        serverEnabled,
        hasCredentials,
        model: process.env.GIGACHAT_MODEL || "GigaChat",
        effective: serverEnabled && hasCredentials
    };
}
