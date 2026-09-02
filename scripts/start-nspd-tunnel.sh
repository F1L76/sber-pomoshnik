#!/bin/bash
# Edge-прокси НСПД в РФ + туннель для Render. Держите окно открытым.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"
PORT="${NSPD_EDGE_PORT:-8791}"
KEY="${NSPD_PROXY_KEY:-}"

if [[ -z "$KEY" && -f "$ENV_FILE" ]]; then
    KEY=$(grep -E '^NSPD_PROXY_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
fi
if [[ -z "$KEY" ]]; then
    KEY=$(openssl rand -hex 16)
    echo "NSPD_PROXY_KEY=$KEY" >> "$ENV_FILE"
    echo "сгенерирован NSPD_PROXY_KEY → $ENV_FILE"
fi

if ! grep -q '^NSPD_BASES=' "$ENV_FILE" 2>/dev/null; then
    echo "NSPD_BASES=http://127.0.0.1:$PORT" >> "$ENV_FILE"
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "edge-прокси уже слушает :$PORT"
else
    NSPD_PROXY_KEY="$KEY" NSPD_EDGE_TIMEOUT_MS=30000 node scripts/nspd-edge-proxy.mjs &
    echo "edge-прокси pid $!"
    sleep 1
fi

LOG=$(mktemp)
echo "запуск cloudflared (http2)… URL появится ниже"
npx --yes cloudflared tunnel --protocol http2 --url "http://127.0.0.1:$PORT" 2>&1 | tee "$LOG" &
CF_PID=$!

for _ in $(seq 1 60); do
    URL=$(rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
    if [[ -n "$URL" ]]; then
        echo ""
        echo "=== для Render → Environment ==="
        echo "NSPD_BASES=$URL"
        echo "NSPD_PROXY_KEY=$KEY"
        echo "================================"
        echo "локально в .env уже NSPD_BASES=http://127.0.0.1:$PORT"
        echo "перезапустите: node gigachat-proxy.mjs"
        wait "$CF_PID"
        exit 0
    fi
    sleep 1
done

echo "не дождались URL туннеля — смотрите лог выше"
wait "$CF_PID"
