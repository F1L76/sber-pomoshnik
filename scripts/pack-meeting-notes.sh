#!/usr/bin/env bash
# Собрать zip только meeting-notes на рабочий стол.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP=$(date +%Y%m%d)
OUT="${HOME}/Desktop/meeting-notes-${STAMP}.zip"
TMP=$(mktemp -d)
DEST="${TMP}/meeting-notes"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

mkdir -p "${DEST}/lib" "${DEST}/scripts"
cp "${ROOT}/meeting-notes-app/server.mjs" "${DEST}/"
cp "${ROOT}/meeting-notes-app/package.json" "${DEST}/"
cp "${ROOT}/meeting-notes-app/README.md" "${DEST}/"
cp "${ROOT}/meeting-notes-app/start.command" "${DEST}/"
chmod +x "${DEST}/start.command"

cp "${ROOT}/meeting-notes.html" "${DEST}/"
cp "${ROOT}/theme.css" "${DEST}/"
cp "${ROOT}/theme.js" "${DEST}/"
cp "${ROOT}/lib/meeting-notes-extract.mjs" "${DEST}/lib/"
cp "${ROOT}/lib/meeting-notes-ocr.mjs" "${DEST}/lib/"
cp "${ROOT}/lib/multipart-parse.mjs" "${DEST}/lib/"
cp "${ROOT}/scripts/meeting-notes-mvp.swift" "${DEST}/scripts/"

# В автономной копии убрать ссылку «на главную» помощника
python3 -c "
from pathlib import Path
p = Path(r'''${DEST}/meeting-notes.html''')
t = p.read_text(encoding='utf-8')
t = t.replace(
    '<a href=\"/\" class=\"btn btn-outline-light btn-sm align-self-start\">На главную</a>',
    '',
)
p.write_text(t, encoding='utf-8')
"

rm -f "${OUT}"
ditto -c -k --norsrc --keepParent "${DEST}" "${OUT}"
rm -rf "${TMP}"
ls -lh "${OUT}"
echo "Архив: ${OUT}"
