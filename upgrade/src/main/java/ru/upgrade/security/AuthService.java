package ru.upgrade.security;

import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import ru.upgrade.domain.Idea;
import ru.upgrade.domain.Role;
import ru.upgrade.domain.Team;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

@Service
public class AuthService {

    private final List<ConfiguredUser> users;

    public AuthService(
            @Value("${upgrade.users.admin.login:admin}") String adminLogin,
            @Value("${upgrade.users.admin.password:admin}") String adminPassword,
            @Value("${upgrade.users.admin.name:Админ}") String adminName,
            @Value("${upgrade.users.user.login:user}") String userLogin,
            @Value("${upgrade.users.user.password:user}") String userPassword,
            @Value("${upgrade.users.user.name:Аноним}") String userName
    ) {
        users = List.of(
                new ConfiguredUser(adminLogin, adminPassword, adminName, Role.ADMIN),
                new ConfiguredUser(userLogin, userPassword, userName, Role.USER)
        );
    }

    public Optional<SessionUser> login(String login, String password) {
        if (login == null || password == null) {
            return Optional.empty();
        }
        String l = login.trim();
        return users.stream()
                .filter(u -> u.login().equalsIgnoreCase(l) && u.password().equals(password))
                .map(u -> new SessionUser(u.login(), u.name(), u.role()))
                .findFirst();
    }

    public Optional<SessionUser> current(HttpSession session) {
        if (session == null) {
            return Optional.empty();
        }
        Object raw = session.getAttribute(SessionUser.SESSION_KEY);
        return raw instanceof SessionUser su ? Optional.of(su) : Optional.empty();
    }

    public void store(HttpSession session, SessionUser user) {
        session.setAttribute(SessionUser.SESSION_KEY, user);
    }

    public void logout(HttpSession session) {
        if (session != null) {
            session.removeAttribute(SessionUser.SESSION_KEY);
        }
    }

    public boolean canEditAuthorFields(SessionUser user, Idea idea) {
        if (user == null || idea == null) {
            return false;
        }
        if (user.isAdmin()) {
            return true;
        }
        return isAuthor(user, idea);
    }

    public boolean canEditAllFields(SessionUser user) {
        return user != null && user.isAdmin();
    }

    public boolean isAuthor(SessionUser user, Idea idea) {
        if (user == null || idea == null || idea.getAuthor() == null) {
            return false;
        }
        String author = idea.getAuthor().toLowerCase(Locale.ROOT);
        String name = user.name() == null ? "" : user.name().toLowerCase(Locale.ROOT).trim();
        String login = user.login() == null ? "" : user.login().toLowerCase(Locale.ROOT).trim();
        if (!name.isEmpty() && (author.equals(name) || author.contains(name))) {
            return true;
        }
        return !login.isEmpty() && (author.equals(login) || author.contains(login));
    }

    public boolean canOpenDeveloperSearch(SessionUser user, Idea idea) {
        if (user == null || idea == null || !idea.canOpenDeveloperSearch()) {
            return false;
        }
        return user.isAdmin() || isAuthor(user, idea);
    }

    public boolean canSendToBacklog(SessionUser user, Idea idea) {
        if (user == null || idea == null || !idea.canSendToBacklog()) {
            return false;
        }
        return user.isStaff();
    }

    public boolean canMarkImplemented(SessionUser user, Idea idea) {
        if (user == null || idea == null || !idea.canMarkImplemented()) {
            return false;
        }
        return user.isStaff();
    }

    public boolean canUploadPrototype(SessionUser user, Idea idea) {
        if (user == null || idea == null) {
            return false;
        }
        if (user.isAdmin()) {
            return true;
        }
        if (idea.getProtoResponsible() != null && !idea.getProtoResponsible().isBlank()) {
            String owner = idea.getProtoResponsible().toLowerCase(Locale.ROOT);
            String name = user.name() == null ? "" : user.name().toLowerCase(Locale.ROOT).trim();
            if (!name.isEmpty() && (owner.equals(name) || owner.contains(name) || name.contains(owner))) {
                return true;
            }
        }
        return isAuthor(user, idea);
    }

    public boolean canEditTeamMembers(SessionUser user, Team team) {
        if (user == null || team == null) {
            return false;
        }
        if (user.isAdmin()) {
            return true;
        }
        return isTeamMember(user, team);
    }

    public boolean isTeamMember(SessionUser user, Team team) {
        if (user == null || team == null || team.getMembers() == null || team.getMembers().isBlank()) {
            return false;
        }
        String name = user.name() == null ? "" : user.name().trim().toLowerCase(Locale.ROOT);
        String login = user.login() == null ? "" : user.login().trim().toLowerCase(Locale.ROOT);
        for (String part : team.getMembers().split("[,;\\n]+")) {
            String token = part.trim().toLowerCase(Locale.ROOT);
            if (token.isEmpty()) {
                continue;
            }
            if ((!name.isEmpty() && (token.equals(name) || token.contains(name) || name.contains(token)))
                    || (!login.isEmpty() && (token.equals(login) || token.contains(login)))) {
                return true;
            }
        }
        return false;
    }

    public record ConfiguredUser(String login, String password, String name, Role role) {}
}
