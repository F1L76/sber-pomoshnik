package ru.upgrade.domain;

public enum Role {
    USER("Юзер"),
    ADMIN("Админ");

    private final String label;

    Role(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
