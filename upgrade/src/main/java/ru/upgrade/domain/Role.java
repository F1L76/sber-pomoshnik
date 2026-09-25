package ru.upgrade.domain;

public enum Role {
    USER("Юзер"),
    PLATFORM_ADMIN("Администратор целевой платформы"),
    ADMIN("Админ");

    private final String label;

    Role(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
