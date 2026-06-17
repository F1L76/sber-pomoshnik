/** Минимальный разбор multipart/form-data для загрузки PDF + XLSX. */

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
        let headerEnd = buffer.indexOf("\r\n\r\n", start);
        if (headerEnd === -1) headerEnd = buffer.indexOf("\n\n", start);
        if (headerEnd === -1) break;

        const headerBlock = buffer.slice(start + delim.length + 2, headerEnd).toString("utf8");
        const bodyStart = headerEnd + (buffer[headerEnd] === 0x0d ? 4 : 2);
        const next = buffer.indexOf(delim, bodyStart);
        if (next === -1) break;

        let bodyEnd = next;
        if (buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
        else if (buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 1;

        const nameMatch = /name="([^"]+)"/i.exec(headerBlock);
        const filenameMatch = /filename="([^"]*)"/i.exec(headerBlock);
        if (nameMatch) {
            const name = nameMatch[1];
            const data = buffer.slice(bodyStart, bodyEnd);
            parts.set(name, {
                name,
                filename: filenameMatch?.[1] || "",
                data
            });
        }

        start = next;
        if (buffer.slice(start + delim.length, start + delim.length + 2).toString() === "--") break;
    }

    return parts;
}
