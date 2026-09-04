#!/bin/zsh
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1
PORT=8788
URL="http://127.0.0.1:${PORT}/"
if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js: https://nodejs.org"
  read -r "?Enter…"
  exit 1
fi
if lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Уже запущено: ${URL}"
  open "${URL}"
  exit 0
fi
echo "Meeting notes: ${URL}"
(sleep 1 && open "${URL}") &
exec node server.mjs
