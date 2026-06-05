# Подключение GitHub (один раз)

Локальный git уже настроен в этой папке. Осталось создать репозиторий на GitHub и отправить код.

## 1. Создайте пустой репозиторий на GitHub

1. Откройте https://github.com/new  
2. **Repository name:** `sber-pomoshnik` (или своё имя)  
3. **Private** — рекомендуется (ключи не в коде, но проект закрытый)  
4. **Не** ставьте галочки README, .gitignore, license (у нас уже есть файлы)  
5. **Create repository**

## 2. На Mac в Терминале

Подставьте **ваш логин** GitHub вместо `ВАШ_ЛОГИН`:

```bash
cd "/Users/avfilinyuk/Documents/sber-pomoshnik"

git commit -m "СберБизнес Помощник: приложение и Render"

git remote add origin https://github.com/ВАШ_ЛОГИН/sber-pomoshnik.git

git push -u origin main
```

При `git push` откроется вход в GitHub (логин + пароль или **Personal Access Token**).

### Если репозиторий на GitHub уже есть (с Render)

Не создавайте новый — используйте **ту же ссылку**:

```bash
git remote add origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

Если пишет, что `origin` уже есть:

```bash
git remote set-url origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

## 3. Render

Render → ваш сервис → **Settings** → репозиторий должен совпадать.  
После каждого `git push` Render обновит сайт сам (1–3 мин).

## 4. Обновления в будущем

После правок в Cursor / на Mac:

```bash
cd "/Users/avfilinyuk/Documents/sber-pomoshnik"
git add -A
git status
git commit -m "Описание изменения"
git push
```

## Что не попадает в GitHub

- `.env` (ключ GigaChat) — только в Render → Environment  
- папка `Резерв/`, старые прототипы  
- `.docx`, `.pptx` в корне папки
