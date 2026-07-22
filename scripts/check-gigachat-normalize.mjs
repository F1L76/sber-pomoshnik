/** Мини-проверка нормализации GIGACHAT_CREDENTIALS (без сети). */
function normalizeGigaChatCredentials(raw) {
    let credentials = String(raw || "").trim().replace(/^Basic\s+/i, "");
    if (
        (credentials.startsWith('"') && credentials.endsWith('"')) ||
        (credentials.startsWith("'") && credentials.endsWith("'"))
    ) {
        credentials = credentials.slice(1, -1).trim();
    }
    return credentials.replace(/\s+/g, "");
}

const cases = [
    ["Basic abcDEF==", "abcDEF=="],
    ["  'abcDEF=='  ", "abcDEF=="],
    ["ab cd", "abcd"],
    ["", ""]
];
for (const [input, want] of cases) {
    const got = normalizeGigaChatCredentials(input);
    if (got !== want) {
        console.error("FAIL", JSON.stringify(input), "→", got, "want", want);
        process.exit(1);
    }
}
console.log("ok");
