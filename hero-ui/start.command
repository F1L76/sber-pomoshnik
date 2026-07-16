#!/bin/zsh
set -euo pipefail

PORT=5173
DIST_DIR="$(cd "$(dirname "$0")/dist" && pwd)"

if [ ! -d "$DIST_DIR" ]; then
  echo "dist/ not found at: $DIST_DIR"
  exit 1
fi

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python)"
else
  echo "python3 (или python) не найден. Нужен python для локального сервера."
  exit 1
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Порт $PORT уже используется."
    exit 1
  fi
fi

cd "$DIST_DIR"
echo "Открываю: http://localhost:$PORT"

"$PYTHON_BIN" -m http.server "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!

open "http://localhost:$PORT" || true

echo "Локальный сервер запущен (pid: $SERVER_PID). Чтобы остановить: закройте окно или Ctrl+C."
wait "$SERVER_PID"

