package ru.upgrade.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;
import ru.upgrade.security.AuthService;
import ru.upgrade.security.SessionUser;

@ControllerAdvice
public class CurrentUserAdvice {

    private final AuthService auth;

    public CurrentUserAdvice(AuthService auth) {
        this.auth = auth;
    }

    @ModelAttribute("currentUser")
    public SessionUser currentUser(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        return auth.current(session).orElse(null);
    }
}
