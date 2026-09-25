# UpGrade

Платформа инициатив залоговой службы: от подачи идеи до внедрения.

## Стек

- Java 17, Spring Boot 3.3, Thymeleaf
- Spring Data JPA, H2 (`./data/upgrade`)
- REST `/api/*` для оценок, избранного и пилотных замечаний

## Запуск

```bash
cd upgrade
./mvnw spring-boot:run
```

Приложение: http://127.0.0.1:8088/  
Консоль H2: http://127.0.0.1:8088/h2  
JDBC URL: `jdbc:h2:file:./data/upgrade`

На Render — отдельный сервис `sber-upgrade` (см. корневой `render.yaml`).  
В помощнике плашка «Платформа UPGrade» ведёт на `/upgrade` → редирект на этот сервис.

Учётки задаются в `src/main/resources/application.yml` (`upgrade.users`).

## Что внутри

- Каталог идей: плитка и список, фильтры, рейтинг, избранное
- Путь инициативы: Подача → Оценка → Поиск разработчика → Прототип → Пилот → Бэклог → Внедрено
- Прототип: HTML в платформе или ссылка на развёрнутый сайт
- Новости, поддержка, команды, рейтинг авторов и разработчиков
- Аналитика `/admin` — воронка, запуски прототипов, журнал действий

Каталог при первом запуске заполняется из `src/main/resources/data/backlog-ideas.json`.

## Структура

```
src/main/java/ru/upgrade/   домен, сервисы, веб
src/main/resources/templates  страницы Thymeleaf
src/main/resources/static     css, js, img
docs/                         заметки и исходные требования
data/                         локальная БД и загрузки (не в git)
```
