#!/bin/bash
# Держит Mac без сна с закрытой крышкой, пока идёт геокод.
# Нужны: зарядка, пароль sudo. В сумку закрытый ноут не класть — перегрев.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! pmset -g batt | head -1 | grep -q "AC Power"; then
    echo "подключите зарядку — без неё с закрытой крышкой Mac уснёт или сядет"
    exit 1
fi

restore() {
    echo "возвращаю обычный сон…"
    sudo pmset -a disablesleep 0 || true
}
trap restore EXIT INT TERM

echo "на время геокода отключаю сон системы (пароль macOS)."
echo "крышку можно закрыть; в сумку не класть."
sudo pmset -a disablesleep 1

node_pid=""
while read -r p; do
    comm=$(ps -p "$p" -o comm= 2>/dev/null || true)
    if [[ "$comm" == "node" ]]; then
        node_pid=$p
        break
    fi
done < <(pgrep -f "geocode-cadastral-list.mjs" || true)

if [[ -z "$node_pid" ]]; then
    caffeinate -dims node scripts/geocode-cadastral-list.mjs "$@" &
    node_pid=$!
    echo "запущен геокод, pid $node_pid"
else
    echo "геокод уже идёт, pid $node_pid — только держу Mac без сна"
fi

while kill -0 "$node_pid" 2>/dev/null; do
    sleep 5
done
