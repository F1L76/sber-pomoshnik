/** Минимальный разбор multipart/form-data для загрузки PDF + XLSX. */

function headerName(headerBlock) {
    const quoted = /(?:^|;)\s*name\s*=\s*"([^"]+)"/i.exec(headerBlock);
    if (quoted) return quoted[1];
    const single = /(?:^|;)\s*name\s*=\s*'([^']+)'/i.exec(headerBlock);
    if (single) return single[1];
    const bare = /(?:^|;)\s*name\s*=\s*([^;\s]+)/i.exec(headerBlock);
    return bare ? bare[1].replace(/^["']|["']$/g, "") : null;
}

export function parseMultipartFormData(buffer, contentType) {
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
    const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
    if (!boundary) {
        throw new Error("Некорректный Content-Type: нет boundary");
    }

    const delim = Buffer.from(`--${boundary}`);
    const parts = new Map();

    let start = buffer.indexOf(delim);
    while (start !== -1) {
        // после --boundary может быть -- (конец) или \r\n / \n
        const afterDelim = start + delim.length;
        if (buffer.slice(afterDelim, afterDelim + 2).toString() === "--") break;

        let headerEnd = buffer.indexOf("\r\n\r\n", afterDelim);
        let sepLen = 4;
        if (headerEnd === -1) {
            headerEnd = buffer.indexOf("\n\n", afterDelim);
            sepLen = 2;
        }
        if (headerEnd === -1) break;

        const headerBlock = buffer.slice(afterDelim, headerEnd).toString("utf8").replace(/^\r?\n/, "");
        const bodyStart = headerEnd + sepLen;
        const next = buffer.indexOf(delim, bodyStart);
        if (next === -1) break;

        let bodyEnd = next;
        if (buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
        else if (buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 1;

        const name = headerName(headerBlock);
        const filenameMatch =
            /filename\*=(?:UTF-8''|utf-8'')([^;\s]+)/i.exec(headerBlock) ||
            /filename="([^"]*)"/i.exec(headerBlock) ||
            /filename=([^;\s]+)/i.exec(headerBlock);
        if (name) {
            parts.set(name, {
                name,
                filename: filenameMatch ? decodeURIComponent(String(filenameMatch[1]).replace(/^["']|["']$/g, "")) : "",
                data: buffer.slice(bodyStart, bodyEnd)
            });
        }

        start = next;
    }

    return parts;
}
