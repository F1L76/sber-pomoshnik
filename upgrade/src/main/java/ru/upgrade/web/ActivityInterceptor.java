package ru.upgrade.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import ru.upgrade.domain.ActivityAction;
import ru.upgrade.security.AuthService;
import ru.upgrade.security.SessionUser;
import ru.upgrade.service.ActivityService;

@Component
public class ActivityInterceptor implements HandlerInterceptor {

    private final AuthService auth;
    private final ActivityService activity;

    public ActivityInterceptor(AuthService auth, ActivityService activity) {
        this.auth = auth;
        this.activity = activity;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception ex
    ) {
        try {
            String uri = request.getRequestURI();
            if (uri == null || skip(uri)) {
                return;
            }
            String method = request.getMethod();
            if (method == null || "OPTIONS".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) {
                return;
            }
            Resolved resolved = resolve(method, uri);
            if (resolved == null) {
                return;
            }
            SessionUser user = auth.current(request.getSession(false)).orElse(null);
            String detail = resolved.detail();
            if (response.getStatus() >= 400) {
                detail = (detail == null ? "" : detail + " · ") + "HTTP " + response.getStatus();
            }
            activity.record(user, resolved.action(), method, uri, resolved.ideaId(), null, detail);
        } catch (Exception ignored) {
            // analytics must never break the request
        }
    }

    private static boolean skip(String uri) {
        return uri.startsWith("/css/")
                || uri.startsWith("/js/")
                || uri.startsWith("/img/")
                || uri.startsWith("/uploads/")
                || uri.startsWith("/h2")
                || uri.startsWith("/favicon")
                || uri.startsWith("/error")
                || uri.startsWith("/webjars/");
    }

    private static Resolved resolve(String method, String uri) {
        boolean get = "GET".equalsIgnoreCase(method);
        boolean post = "POST".equalsIgnoreCase(method);
        if (post && "/login".equals(uri)) {
            return null;
        }
        if (post && "/logout".equals(uri)) {
            return null;
        }
        if (uri.startsWith("/api/")) {
            Long id = ideaId(uri, "/api/ideas/");
            if (post && uri.matches("/api/ideas/\\d+/rate")) {
                return new Resolved(ActivityAction.RATE, id, "оценка");
            }
            if (post && uri.matches("/api/ideas/\\d+/favorite")) {
                return new Resolved(ActivityAction.FAVORITE, id, null);
            }
            if (post && uri.matches("/api/ideas/\\d+/test-issues")) {
                return new Resolved(ActivityAction.TEST_ISSUE, id, null);
            }
            return null;
        }
        if (get && "/".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_HOME, null, null);
        }
        if (get && "/ideas".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_CATALOG, null, null);
        }
        if (get && ("/ideas/new".equals(uri) || "/ideas/create".equals(uri))) {
            return new Resolved(ActivityAction.VIEW_OTHER, null, "форма подачи");
        }
        if (get && uri.matches("/ideas/\\d+/edit")) {
            return new Resolved(ActivityAction.VIEW_OTHER, ideaId(uri, "/ideas/"), "форма редактирования");
        }
        if (get && uri.matches("/ideas/\\d+/proto")) {
            return new Resolved(ActivityAction.VIEW_PROTO, ideaId(uri, "/ideas/"), "запуск");
        }
        if (get && uri.matches("/ideas/\\d+/export")) {
            return new Resolved(ActivityAction.EXPORT, ideaId(uri, "/ideas/"), null);
        }
        if (get && uri.matches("/ideas/\\d+")) {
            return new Resolved(ActivityAction.VIEW_IDEA, ideaId(uri, "/ideas/"), null);
        }
        if (post && "/ideas".equals(uri)) {
            return new Resolved(ActivityAction.CREATE_IDEA, null, null);
        }
        if (post && uri.matches("/ideas/\\d+")) {
            return new Resolved(ActivityAction.UPDATE_IDEA, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/rate")) {
            return new Resolved(ActivityAction.RATE, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/favorite")) {
            return new Resolved(ActivityAction.FAVORITE, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/take")) {
            return new Resolved(ActivityAction.TAKE_WORK, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/open-search")) {
            return new Resolved(ActivityAction.OPEN_SEARCH, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/to-backlog")) {
            return new Resolved(ActivityAction.SEND_BACKLOG, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/implement")) {
            return new Resolved(ActivityAction.MARK_IMPLEMENTED, ideaId(uri, "/ideas/"), null);
        }
        if (post && uri.matches("/ideas/\\d+/proto-html")) {
            return new Resolved(ActivityAction.UPLOAD_HTML, ideaId(uri, "/ideas/"), "HTML");
        }
        if (post && uri.matches("/ideas/\\d+/proto-url")) {
            return new Resolved(ActivityAction.ATTACH_SITE, ideaId(uri, "/ideas/"), "сайт");
        }
        if (get && "/rating".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_RATING, null, null);
        }
        if (get && "/favorites".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_FAVORITES, null, null);
        }
        if (get && "/news".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_NEWS, null, null);
        }
        if (post && "/news".equals(uri)) {
            return new Resolved(ActivityAction.NEWS_SAVE, null, null);
        }
        if (get && ("/support".equals(uri) || "/applications".equals(uri))) {
            return new Resolved(ActivityAction.VIEW_SUPPORT, null, null);
        }
        if (post && ("/support".equals(uri) || "/applications".equals(uri))) {
            return new Resolved(ActivityAction.SUPPORT_SUBMIT, null, null);
        }
        if (get && "/teams".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_TEAMS, null, null);
        }
        if (post && ("/teams".equals(uri) || uri.matches("/teams/\\d+/members"))) {
            return new Resolved(ActivityAction.TEAM_SAVE, null, null);
        }
        if (get && "/about".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_ABOUT, null, null);
        }
        if (get && "/admin".equals(uri)) {
            return new Resolved(ActivityAction.VIEW_ADMIN, null, null);
        }
        if (get && "/login".equals(uri)) {
            return null;
        }
        return get ? new Resolved(ActivityAction.VIEW_OTHER, null, uri) : null;
    }

    private static Long ideaId(String uri, String prefix) {
        int start = uri.indexOf(prefix);
        if (start < 0) {
            return null;
        }
        String rest = uri.substring(start + prefix.length());
        int slash = rest.indexOf('/');
        String num = slash < 0 ? rest : rest.substring(0, slash);
        try {
            return Long.parseLong(num);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private record Resolved(ActivityAction action, Long ideaId, String detail) {}
}
