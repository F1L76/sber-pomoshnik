# Деплой на Beget VPS + автообновление с GitHub

Инструкция для [Beget VPS](https://beget.com/ru/vps): проект обновляется при каждом `git push` в ветку `main`.

---

## 1. Заказать VPS на Beget

1. [beget.com/ru/vps](https://beget.com/ru/vps) → **Создать**
2. Локация: **Россия, Санкт-Петербург**
3. ОС: **Ubuntu 24.04** (без ispmanager — достаточно чистой Ubuntu)
4. Конфигурация для этого проекта:

| Параметр | Рекомендация |
|----------|----------------|
| CPU | 2 ядра |
| RAM | **4 ГБ** (~33 ₽/день) |
| Диск | **40+ ГБ** NVMe |
| IPv4 | да (+5 ₽/день) |

5. В панели Beget откройте **VNC-терминал** или подключитесь по SSH:

```bash
ssh root@ВАШ_IP
```

Пароль root — в панели Beget у вашего VPS.

---

## 2. Первичная установка (один раз)

На сервере от **root**:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/F1L76/sber-pomoshnik.git /var/www/sber-pomoshnik
bash /var/www/sber-pomoshnik/deploy/beget/bootstrap.sh
```

Скрипт установит Node 22, nginx, systemd-сервис, Chromium для Playwright.

### Секреты приложения

```bash
nano /var/www/sber-pomoshnik/.env
```

Минимум:

```env
GIGACHAT_CREDENTIALS=ваш_ключ
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_MODEL=GigaChat
PORT=8787
```

Перезапуск:

```bash
systemctl restart sber-pomoshnik
```

Проверка: откройте в браузере `http://ВАШ_IP/` — должна открыться главная страница.

---

## 3. Домен и HTTPS (опционально)

В панели Beget: **Домены → DNS** — A-запись на IP VPS.

На сервере:

```bash
sed -i 's/server_name _;/server_name ваш-домен.ru;/' /etc/nginx/sites-available/sber-pomoshnik
nginx -t && systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.ru
```

---

## 4. Автообновление с GitHub

При каждом push в `main` GitHub Actions подключается по SSH и запускает `scripts/deploy.sh`.

### 4.1. SSH-ключ для деплоя

На **вашем Mac**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/beget_deploy -N "" -C "github-deploy"
cat ~/.ssh/beget_deploy.pub
```

На **сервере** (root):

```bash
mkdir -p /root/.ssh
echo 'ВСТАВЬТЕ_СТРОКУ_pub' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

Проверка с Mac:

```bash
ssh -i ~/.ssh/beget_deploy root@ВАШ_IP
```

### 4.2. Секреты в GitHub

Репозиторий → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Значение |
|--------|----------|
| `BEGET_HOST` | IP или домен VPS |
| `BEGET_USER` | `root` |
| `BEGET_SSH_KEY` | содержимое `~/.ssh/beget_deploy` (приватный ключ) |
| `BEGET_SSH_PORT` | `22` (если не меняли) |

### 4.3. Проверка

```bash
# локально — любое изменение и push
git push origin main
```

В GitHub: **Actions** → workflow **Deploy to Beget VPS** — должен быть зелёный.

---

## 5. Датасет сделок (SQLite)

Импорт **не** запускается при каждом деплое (файл ~6 ГБ).

1. Загрузите CSV/GZ в `/var/www/sber-pomoshnik/data/deals/` (SFTP в панели Beget или `scp`)
2. Один раз на сервере:

```bash
cd /var/www/sber-pomoshnik
sudo -u sber-app npm run deals:import
```

Файл `data/deals/deals.sqlite` в git не попадает — на сервере сохраняется между обновлениями.

---

## 6. Полезные команды

```bash
systemctl status sber-pomoshnik    # статус
journalctl -u sber-pomoshnik -f    # логи
bash /var/www/sber-pomoshnik/scripts/deploy.sh   # ручное обновление
```

---

## Схема

```
git push → GitHub Actions → SSH на Beget VPS → git pull → npm ci → restart
```

Аналог Render, но без таймаута 30 с и со сном — сервер работает постоянно (пока оплачен VPS).
