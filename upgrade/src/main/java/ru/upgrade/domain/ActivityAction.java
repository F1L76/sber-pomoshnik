package ru.upgrade.domain;

public enum ActivityAction {
    LOGIN("Вход"),
    LOGIN_FAIL("Неудачный вход"),
    LOGOUT("Выход"),
    VIEW_HOME("Главная"),
    VIEW_CATALOG("Каталог идей"),
    VIEW_IDEA("Карточка идеи"),
    VIEW_PROTO("Запуск прототипа"),
    VIEW_RATING("Рейтинг"),
    VIEW_FAVORITES("Избранное"),
    VIEW_NEWS("Новости"),
    VIEW_SUPPORT("Поддержка"),
    VIEW_ABOUT("О платформе"),
    VIEW_TEAMS("Команды"),
    VIEW_ADMIN("Админка"),
    VIEW_OTHER("Просмотр страницы"),
    CREATE_IDEA("Подача идеи"),
    UPDATE_IDEA("Редактирование идеи"),
    RATE("Оценка идеи"),
    FAVORITE("Избранное вкл/выкл"),
    OPEN_SEARCH("Открыт поиск разработчика"),
    TAKE_WORK("Взято в работу"),
    UPLOAD_HTML("Загружен HTML-прототип"),
    ATTACH_SITE("Указана ссылка на сайт"),
    EXPORT("Скачивание пакета"),
    SEND_BACKLOG("В профильный бэклог"),
    MARK_IMPLEMENTED("Отмечено внедрённым"),
    LAUNCH_MVP("Запуск следующего шага"),
    TEST_ISSUE("Замечание по пилоту"),
    SUPPORT_SUBMIT("Обращение в поддержку"),
    NEWS_SAVE("Новость"),
    TEAM_SAVE("Команда");

    private final String label;

    ActivityAction(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    public boolean isPrototypeLaunch() {
        return this == VIEW_PROTO;
    }

    public boolean isPrototypePublish() {
        return this == UPLOAD_HTML || this == ATTACH_SITE;
    }
}
