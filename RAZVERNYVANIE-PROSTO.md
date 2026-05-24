# Как открыть программу по ссылке (без SSH)

Если Yandex Cloud / терминал не получились — это нормально. Ниже **3 варианта** от простого к сложному.

---

## Вариант 1. Только ваш Mac (уже работает)

1. Двойной щелчок: **«Запуск СберБизнес Помощник.command»** на рабочем столе.
2. Открыть: http://localhost:8787/

Коллегам с других ПК **не подойдёт** — только у вас.

---

## Вариант 2. Render.com — ссылка для всех, без команд Linux (рекомендуем)

Нужны: аккаунт GitHub, аккаунт [render.com](https://render.com), ключ GigaChat.

### Шаг 1. GitHub

1. Создайте репозиторий на github.com (например `sber-pomoshnik`).
2. Загрузите **папку проекта** (без `.env` и без папки `Резерв/`):
   - `С распознаванием.html`
   - `gigachat-proxy.mjs`
   - `package.json`
   - `render.yaml`
   - `vendor/`
   - `materials/`
   - `.env.example`

Через сайт GitHub: **Add file → Upload files**.

### Шаг 2. Render

1. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** (или Web Service).
2. Подключите репозиторий GitHub.
3. Render подхватит `render.yaml` или укажите вручную:
   - **Start command:** `npm start`
   - **Runtime:** Node
4. **Environment** → добавьте:
   - `GIGACHAT_CREDENTIALS` = ваш ключ из Studio Сбера
   - `GIGACHAT_SCOPE` = `GIGACHAT_API_PERS`
   - `GIGACHAT_MODEL` = `GigaChat`
5. **Create Web Service**.

Через 2–5 минут будет ссылка вида:

`https://sber-pomoshnik-xxxx.onrender.com`

Её открывают с **любого ПК/телефона**.

> Бесплатный тариф «засыпает» — первый заход может ждать 30–60 секунд.

---

## Вариант 3. Yandex Cloud (если снова попробуете)

Ошибка **`Permission denied (publickey)`** значит: сервер **не пустил** — ключ SSH не совпал.

### Проще всего: новая ВМ с ключом

1. На Mac в Терминале:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
   Если файла нет:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
   cat ~/.ssh/id_ed25519.pub
   ```
2. Скопируйте **всю строку** `ssh-ed25519 AAAA...`
3. Yandex Cloud → **Создать ВМ** → в поле **SSH-ключ** вставить строку → создать.
4. Подключение:
   ```bash
   ssh -i ~/.ssh/id_ed25519 ubuntu@НОВЫЙ_IP
   ```
   Если не пускает — попробуйте `yc-user` вместо `ubuntu`.

### Или SSH в браузере

Консоль Yandex → ваша ВМ → **Подключиться** → **SSH** (если кнопка есть) — команды `apt` вводятся **в окне браузера**, не на Mac.

---

## Что вы делали не так (кратко)

| Действие | Проблема |
|----------|----------|
| `ssh` → Permission denied | На сервер не вошли |
| `apt install` на Mac | `apt` есть только на Linux-сервере |
| `scp ... ПУБЛИЧНЫЙ_IP` | Нужен реальный IP, например `51.250.24.101` |

Команды `apt`, `node`, `pm2`, `nginx` — **только после успешного** `ssh`, когда видите `ubuntu@...:~$`.

---

## Нужна помощь

Напишите, какой вариант хотите:

1. **Только Mac** (ярлык)  
2. **Render** (помогу по шагам с GitHub)  
3. **Yandex** (создать ВМ заново с ключом)

Можно прислать **скрин** ошибки из Терминала или из консоли Yandex.
