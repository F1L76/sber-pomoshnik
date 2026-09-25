package ru.upgrade.security;

import ru.upgrade.domain.Role;

public record SessionUser(String login, String name, Role role) {

    public static final String SESSION_KEY = "upgradeUser";

    public boolean isAdmin() {
        return role == Role.ADMIN;
    }

    /** Админ каталога. */
    public boolean isStaff() {
        return isAdmin();
    }
}
