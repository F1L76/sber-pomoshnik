#!/bin/bash
# Edge-прокси НСПД в РФ + публичный туннель для Render.
# Держите окно открытым: Mac не должен уснуть, иначе NSPD на проде падает.
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

# 8791 often taken by other local apps — bump if busy
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    if curl -fsS -H "X-NSPD-Proxy-Key: $KEY" "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q nspd-edge-proxy; then
        echo "edge-прокси уже слушает :$PORT"
    else
        PORT=$((PORT + 1))
        echo "порт занят чужим процессом → пробуем :$PORT"
    fi
fi

if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    NSPD_PROXY_KEY="$KEY" NSPD_EDGE_PORT="$PORT" NSPD_EDGE_TIMEOUT_MS=30000 \
        node scripts/nspd-edge-proxy.mjs &
    echo "edge-прокси pid $! :$PORT"
    sleep 1
fi

print_render() {
    local url="$1"
    echo ""
    echo "=== для Render → Environment ==="
    echo "NSPD_BASES=$url"
    echo "NSPD_PROXY_KEY=$KEY"
    echo "================================"
    echo "WARN: free Pinggy ~60 мин / Mac sleep убивает prod. Для 24/7: deploy/ru-edge на VPS в РФ."
    echo "локально: NSPD_BASES=http://127.0.0.1:$PORT"
}

# 1) cloudflared (needs outbound TCP/UDP 7844) — often blocked on RU ISP/VPN
LOG=$(mktemp)
if command -v cloudflared >/dev/null 2>&1 || command -v npx >/dev/null 2>&1; then
    echo "пробую cloudflared (http2)…"
    if command -v cloudflared >/dev/null 2>&1; then
        cloudflared tunnel --protocol http2 --url "http://127.0.0.1:$PORT" --no-autoupdate 2>&1 | tee "$LOG" &
    else
        npx --yes cloudflared tunnel --protocol http2 --url "http://127.0.0.1:$PORT" 2>&1 | tee "$LOG" &
    fi
    CF_PID=$!
    for _ in $(seq 1 25); do
        if ! kill -0 "$CF_PID" 2>/dev/null; then break; fi
        if rg -q 'HTTP/2 connection is blocked|Unable to establish connection with Cloudflare edge' "$LOG" 2>/dev/null; then
            echo "cloudflared: edge 7844 недоступен — переключаюсь на Pinggy"
            kill "$CF_PID" 2>/dev/null || true
            wait "$CF_PID" 2>/dev/null || true
            break
        fi
        URL=$(rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
        if [[ -n "${URL:-}" ]] && rg -q 'Registered tunnel connection' "$LOG" 2>/dev/null; then
            print_render "$URL"
            wait "$CF_PID"
            exit 0
        fi
        sleep 1
    done
    kill "$CF_PID" 2>/dev/null || true
    wait "$CF_PID" 2>/dev/null || true
fi

# 2) Pinggy over SSH/443 (works when Cloudflare 7844 is filtered)
echo "запуск Pinggy (ssh :443)… URL появится ниже"
PINGGY_LOG=$(mktemp)
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -p 443 -R0:127.0.0.1:"$PORT" -T a.pinggy.io x:none \
    >"$PINGGY_LOG" 2>&1 &
PG_PID=$!

URL=""
for _ in $(seq 1 40); do
    URL=$(rg -o 'https://[a-z0-9.-]+\.(free\.pinggy\.net|run\.pinggy-free\.link)' "$PINGGY_LOG" 2>/dev/null | head -1 || true)
    if [[ -n "$URL" ]]; then
        # prefer free.pinggy.net (stable for Render env paste)
        ALT=$(rg -o 'https://[a-z0-9.-]+\.free\.pinggy\.net' "$PINGGY_LOG" 2>/dev/null | head -1 || true)
        [[ -n "$ALT" ]] && URL="$ALT"
        print_render "$URL"
        echo "(prod image must send X-Pinggy-No-Screen — уже в digital-core vendor)"
        wait "$PG_PID"
        exit 0
    fi
    if ! kill -0 "$PG_PID" 2>/dev/null; then
        echo "Pinggy упал:"
        cat "$PINGGY_LOG"
        exit 1
    fi
    sleep 1
done

echo "не дождались URL туннеля — лог Pinggy:"
cat "$PINGGY_LOG"
wait "$PG_PID" || true
exit 1
