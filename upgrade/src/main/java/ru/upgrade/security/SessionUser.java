package ru.upgrade.security;

import ru.upgrade.domain.Role;

public record SessionUser(String login, String name, Role role) {

    public static final String SESSION_KEY = "upgradeUser";

    public boolean isAdmin() {
        return role == Role.ADMIN;
    }

    public boolean isPlatformAdmin() {
        return role == Role.PLATFORM_ADMIN;
    }

    /** Админ каталога или администратор целевой платформы. */
    public boolean isStaff() {
        return isAdmin() || isPlatformAdmin();
    }
}
