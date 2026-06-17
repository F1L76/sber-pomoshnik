#!/usr/bin/env bash
# Обновление приложения на сервере (вызывается вручную или из GitHub Actions).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/sber-pomoshnik}"
APP_USER="${APP_USER:-sber-app}"
BRANCH="${DEPLOY_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-sber-pomoshnik}"

as_app() {
    sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && $*"
}

echo "==> git pull ($BRANCH)"
as_app git fetch origin "$BRANCH"
as_app git reset --hard "origin/$BRANCH"

echo "==> npm ci"
as_app npm ci

echo "==> Playwright Chromium"
as_app "node node_modules/playwright-core/cli.js install chromium" || true

echo "==> restart $SERVICE_NAME"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
systemctl restart "$SERVICE_NAME"
systemctl --no-pager status "$SERVICE_NAME" || true

echo "==> deploy OK"
