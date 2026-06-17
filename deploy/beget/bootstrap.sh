#!/usr/bin/env bash
# Однократная настройка Beget VPS (Ubuntu 24.04).
# Запуск на сервере от root:
#   curl -fsSL https://raw.githubusercontent.com/F1L76/sber-pomoshnik/main/deploy/beget/bootstrap.sh | bash
# или после git clone:
#   sudo bash deploy/beget/bootstrap.sh
set -euo pipefail

APP_DIR="/var/www/sber-pomoshnik"
REPO_URL="${REPO_URL:-https://github.com/F1L76/sber-pomoshnik.git}"
BRANCH="${DEPLOY_BRANCH:-main}"
APP_USER="sber-app"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Запустите от root: sudo bash $0"
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> пакеты"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates nginx

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
node -v
npm -v

echo "==> пользователь $APP_USER"
if ! id "$APP_USER" &>/dev/null; then
    useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

echo "==> каталог приложения"
mkdir -p "$APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
    cd "$APP_DIR"
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> зависимости"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && node node_modules/playwright-core/cli.js install chromium" || true
npx --yes playwright install-deps chromium 2>/dev/null || apt-get install -y -qq \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2t64 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 2>/dev/null || true

if [[ ! -f "$APP_DIR/.env" ]]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
    echo ""
    echo "!!! Отредактируйте $APP_DIR/.env (GIGACHAT_CREDENTIALS и др.)"
    echo ""
fi

echo "==> systemd"
cp "$APP_DIR/deploy/beget/sber-pomoshnik.service" /etc/systemd/system/sber-pomoshnik.service
systemctl daemon-reload
systemctl enable sber-pomoshnik
systemctl restart sber-pomoshnik

echo "==> nginx"
if [[ ! -f /etc/nginx/sites-enabled/sber-pomoshnik ]]; then
    cp "$APP_DIR/deploy/beget/nginx.conf" /etc/nginx/sites-available/sber-pomoshnik
    sed -i 's/YOUR_DOMAIN/_/' /etc/nginx/sites-available/sber-pomoshnik
    ln -sf /etc/nginx/sites-available/sber-pomoshnik /etc/nginx/sites-enabled/sber-pomoshnik
    rm -f /etc/nginx/sites-enabled/default
    nginx -t
    systemctl reload nginx
fi

echo ""
echo "Готово. Проверка: curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/"
echo "Сайт: http://$(curl -fsSL -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')/"
echo ""
echo "Дальше:"
echo "  1) nano $APP_DIR/.env"
echo "  2) systemctl restart sber-pomoshnik"
echo "  3) Настройте GitHub Actions (см. RAZVERNYVANIE-BEGET.md)"
