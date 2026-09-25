package ru.upgrade.web;

import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import ru.upgrade.domain.ActivityAction;
import ru.upgrade.security.AuthService;
import ru.upgrade.security.SessionUser;
import ru.upgrade.service.AnalyticsService;

@Controller
public class AdminController {

    private final AuthService auth;
    private final AnalyticsService analytics;

    public AdminController(AuthService auth, AnalyticsService analytics) {
        this.auth = auth;
        this.analytics = analytics;
    }

    @GetMapping("/admin")
    public String dashboard(
            @RequestParam(defaultValue = "30") int days,
            @RequestParam(required = false) ActivityAction action,
            HttpSession session,
            Model model,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            return "redirect:/login?redirect=/admin";
        }
        if (!current.isStaff()) {
            ra.addFlashAttribute("error", "Аналитика доступна администраторам");
            return "redirect:/ideas";
        }
        int window = days <= 0 ? 30 : days;
        model.addAttribute("dash", analytics.build(window, action));
        model.addAttribute("days", window);
        model.addAttribute("logAction", action);
        model.addAttribute("activityActions", ActivityAction.values());
        model.addAttribute("active", "admin");
        return "admin";
    }
}
