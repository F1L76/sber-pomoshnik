package ru.upgrade.web;

import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import ru.upgrade.domain.*;
import ru.upgrade.security.AuthService;
import ru.upgrade.security.SessionUser;
import ru.upgrade.service.ActivityService;
import ru.upgrade.service.PlatformService;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Controller
public class PageController {

    private final PlatformService platform;
    private final AuthService auth;
    private final ActivityService activity;
    private final String demoUser;

    public PageController(
            PlatformService platform,
            AuthService auth,
            ActivityService activity,
            @Value("${upgrade.demo-user}") String demoUser
    ) {
        this.platform = platform;
        this.auth = auth;
        this.activity = activity;
        this.demoUser = demoUser;
    }

    @InitBinder("idea")
    public void ideaBinder(WebDataBinder binder) {
        binder.setDisallowedFields("tags", "stages", "id", "createdAt", "updatedAt");
    }

    private String who(String userParam, HttpSession session) {
        return auth.current(session)
                .map(SessionUser::name)
                .orElseGet(() -> (userParam == null || userParam.isBlank()) ? demoUser : userParam.trim());
    }

    @GetMapping("/login")
    public String loginForm(
            @RequestParam(required = false) String redirect,
            Model model
    ) {
        model.addAttribute("redirect", redirect == null ? "/ideas" : redirect);
        model.addAttribute("accounts", auth.directory());
        model.addAttribute("active", "login");
        return "login";
    }

    @PostMapping("/login")
    public String login(
            @RequestParam String login,
            @RequestParam String password,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        var user = auth.login(login, password);
        if (user.isEmpty()) {
            activity.record(null, ActivityAction.LOGIN_FAIL, "POST", "/login", null, null, login);
            ra.addFlashAttribute("error", "Неверный логин или пароль");
            return "redirect:/login" + (redirect != null && !redirect.isBlank() ? "?redirect=" + redirect : "");
        }
        auth.store(session, user.get());
        activity.record(user.get(), ActivityAction.LOGIN, "POST", "/login", null, null, user.get().role().getLabel());
        ra.addFlashAttribute("ok", "Вы вошли как " + user.get().name() + " (" + user.get().role().getLabel() + ")");
        String target = (redirect == null || redirect.isBlank()) ? "/ideas" : redirect;
        if (!target.startsWith("/")) {
            target = "/ideas";
        }
        return "redirect:" + target;
    }

    @PostMapping("/logout")
    public String logout(HttpSession session, RedirectAttributes ra) {
        SessionUser current = auth.current(session).orElse(null);
        activity.record(current, ActivityAction.LOGOUT, "POST", "/logout", null, null, null);
        auth.logout(session);
        ra.addFlashAttribute("ok", "Вы вышли из аккаунта");
        return "redirect:/ideas";
    }

    @GetMapping("/")
    public String home(Model model) {
        model.addAttribute("news", platform.newsOfTheDay().orElse(null));
        model.addAttribute("ideasCount", platform.searchIdeas(null, null, null).size());
        model.addAttribute("active", "home");
        return "home";
    }

    @GetMapping("/ideas")
    public String ideas(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) ProtoStatus proto,
            @RequestParam(required = false) Boolean implemented,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String user,
            HttpSession session,
            Model model
    ) {
        String who = who(user, session);
        IdeaSort ideaSort = IdeaSort.from(sort);
        List<Idea> list = platform.searchIdeas(q, proto, implemented, tag, ideaSort);
        Map<Long, Boolean> fav = new HashMap<>();
        for (Idea i : list) {
            fav.put(i.getId(), platform.isFavorite(i.getId(), who));
        }
        model.addAttribute("ideas", list);
        model.addAttribute("ratings", platform.ratingMap(list));
        model.addAttribute("voteCounts", platform.ratingCountMap(list));
        model.addAttribute("favorites", fav);
        model.addAttribute("testIssues", platform.testIssuesMap(list));
        model.addAttribute("popularTags", platform.popularTags(50));
        model.addAttribute("q", q);
        model.addAttribute("proto", proto);
        model.addAttribute("implemented", implemented);
        model.addAttribute("tag", tag);
        model.addAttribute("sort", ideaSort.name());
        model.addAttribute("sortOptions", IdeaSort.values());
        model.addAttribute("user", who);
        model.addAttribute("protoStatuses", ProtoStatus.values());
        model.addAttribute("active", "ideas");
        return "ideas";
    }

    @GetMapping({"/ideas/new", "/ideas/create"})
    public String newIdea(HttpSession session, Model model, RedirectAttributes ra) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы подать идею");
            return "redirect:/login?redirect=/ideas/new";
        }
        Idea idea = new Idea();
        idea.setAuthor(current.name());
        model.addAttribute("idea", idea);
        model.addAttribute("editMode", false);
        model.addAttribute("canEditAll", true);
        model.addAttribute("canEditAuthorFields", true);
        model.addAttribute("selectedTags", Set.of());
        model.addAttribute("protoStatuses", ProtoStatus.values());
        model.addAttribute("catalogTags", platform.catalogTags());
        model.addAttribute("targetPlatforms", PlatformService.TARGET_PLATFORMS);
        model.addAttribute("active", "ideas");
        model.addAttribute("user", current.name());
        return "idea-form";
    }

    @GetMapping("/ideas/{id:\\d+}")
    public String ideaDetail(
            @PathVariable Long id,
            @RequestParam(required = false) String user,
            HttpSession session,
            Model model
    ) {
        String who = who(user, session);
        SessionUser current = auth.current(session).orElse(null);
        Idea idea = platform.getIdea(id).orElseThrow();
        model.addAttribute("idea", idea);
        model.addAttribute("avg", platform.avgRating(id));
        model.addAttribute("votes", platform.ratingCount(id));
        model.addAttribute("favorite", platform.isFavorite(id, who));
        model.addAttribute("testIssues", platform.testIssuesFor(id));
        model.addAttribute("user", who);
        model.addAttribute("canEdit", auth.canEditAuthorFields(current, idea));
        model.addAttribute("active", "ideas");
        return "idea-detail";
    }

    @GetMapping("/ideas/{id:\\d+}/edit")
    public String editIdea(
            @PathVariable Long id,
            HttpSession session,
            Model model,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы редактировать идею");
            return "redirect:/login?redirect=/ideas/" + id + "/edit";
        }
        Idea idea = platform.getIdea(id).orElseThrow();
        if (!auth.canEditAuthorFields(current, idea)) {
            ra.addFlashAttribute("error", "Недостаточно прав для редактирования");
            return "redirect:/ideas/" + id;
        }
        boolean admin = auth.canEditAllFields(current);
        Set<String> selected = idea.getTags().stream().map(DirectionTag::getName).collect(Collectors.toSet());
        model.addAttribute("idea", idea);
        model.addAttribute("editMode", true);
        model.addAttribute("canEditAll", admin);
        model.addAttribute("canEditAuthorFields", true);
        model.addAttribute("selectedTags", selected);
        model.addAttribute("protoStatuses", ProtoStatus.values());
        model.addAttribute("catalogTags", platform.catalogTags());
        model.addAttribute("targetPlatforms", PlatformService.TARGET_PLATFORMS);
        model.addAttribute("active", "ideas");
        model.addAttribute("user", current.name());
        return "idea-form";
    }

    @PostMapping("/ideas")
    public String createIdea(
            @ModelAttribute Idea idea,
            @RequestParam(name = "tagNames", required = false) List<String> tagNames,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы подать идею");
            return "redirect:/login?redirect=/ideas/new";
        }
        if (!current.isAdmin()) {
            idea.setAuthor(current.name());
        } else if (idea.getAuthor() == null || idea.getAuthor().isBlank()) {
            idea.setAuthor(current.name());
        }
        platform.saveIdeaWithTags(idea, tagNames);
        ra.addFlashAttribute("ok", "Идея сохранена");
        return "redirect:/ideas";
    }

    @PostMapping("/ideas/{id:\\d+}")
    public String updateIdea(
            @PathVariable Long id,
            @ModelAttribute Idea idea,
            @RequestParam(name = "tagNames", required = false) List<String> tagNames,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы редактировать идею");
            return "redirect:/login?redirect=/ideas/" + id + "/edit";
        }
        Idea existing = platform.getIdea(id).orElseThrow();
        if (!auth.canEditAuthorFields(current, existing)) {
            ra.addFlashAttribute("error", "Недостаточно прав для редактирования");
            return "redirect:/ideas/" + id;
        }
        boolean admin = auth.canEditAllFields(current);
        platform.updateIdeaFields(id, idea, tagNames, admin);
        ra.addFlashAttribute("ok", "Изменения сохранены");
        return "redirect:/ideas/" + id;
    }

    @PostMapping("/ideas/{id}/rate")
    public String rate(
            @PathVariable Long id,
            @RequestParam String user,
            @RequestParam int score,
            RedirectAttributes ra
    ) {
        platform.rate(id, user, score);
        ra.addFlashAttribute("ok", "Оценка сохранена");
        return "redirect:/ideas/" + id + "?user=" + user;
    }

    @PostMapping("/ideas/{id}/favorite")
    public String favorite(@PathVariable Long id, @RequestParam String user, RedirectAttributes ra) {
        boolean on = platform.toggleFavorite(id, user);
        ra.addFlashAttribute("ok", on ? "В избранном" : "Убрано из избранного");
        return "redirect:/ideas/" + id + "?user=" + user;
    }

    @PostMapping("/ideas/{id:\\d+}/take")
    public String takeIntoWork(
            @PathVariable Long id,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы взять идею в работу");
            return "redirect:/login?redirect=/ideas/" + id;
        }
        try {
            platform.takeIntoWork(id, current.name());
            ra.addFlashAttribute("ok", "Вы взяли идею в работу — этап «Разработка прототипа»");
        } catch (IllegalStateException | IllegalArgumentException ex) {
            ra.addFlashAttribute("error", ex.getMessage());
        }
        String target = (redirect != null && redirect.startsWith("/") && !redirect.startsWith("//"))
                ? redirect
                : "/ideas/" + id;
        return "redirect:" + target;
    }

    @PostMapping("/ideas/{id:\\d+}/open-search")
    public String openDeveloperSearch(
            @PathVariable Long id,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы открыть поиск разработчика");
            return "redirect:/login?redirect=/ideas/" + id;
        }
        Idea idea = platform.getIdea(id).orElse(null);
        if (idea == null || !auth.canOpenDeveloperSearch(current, idea)) {
            ra.addFlashAttribute("error", "Недостаточно прав, чтобы открыть поиск разработчика");
            return redirectIdeas(redirect, id);
        }
        try {
            platform.openDeveloperSearch(id);
            ra.addFlashAttribute("ok", "Открыт поиск разработчика");
        } catch (IllegalStateException | IllegalArgumentException ex) {
            ra.addFlashAttribute("error", ex.getMessage());
        }
        return redirectIdeas(redirect, id);
    }

    @PostMapping("/ideas/{id:\\d+}/to-backlog")
    public String sendToBacklog(
            @PathVariable Long id,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите как администратор целевой платформы");
            return "redirect:/login?redirect=/ideas/" + id;
        }
        Idea idea = platform.getIdea(id).orElse(null);
        if (idea == null || !auth.canSendToBacklog(current, idea)) {
            ra.addFlashAttribute("error", "Передачу в бэклог делает администратор целевой платформы");
            return redirectIdeas(redirect, id);
        }
        try {
            platform.sendToBacklog(id, current.name());
            ra.addFlashAttribute("ok", "Идея передана в профильный бэклог");
        } catch (IllegalStateException | IllegalArgumentException ex) {
            ra.addFlashAttribute("error", ex.getMessage());
        }
        return redirectIdeas(redirect, id);
    }

    @PostMapping("/ideas/{id:\\d+}/implement")
    public String markImplemented(
            @PathVariable Long id,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите как администратор целевой платформы");
            return "redirect:/login?redirect=/ideas/" + id;
        }
        Idea idea = platform.getIdea(id).orElse(null);
        if (idea == null || !auth.canMarkImplemented(current, idea)) {
            ra.addFlashAttribute("error", "Отметить внедрение может администратор целевой платформы");
            return redirectIdeas(redirect, id);
        }
        try {
            platform.markImplemented(id, current.name());
            ra.addFlashAttribute("ok", "Идея отмечена как внедрённая");
        } catch (IllegalStateException | IllegalArgumentException ex) {
            ra.addFlashAttribute("error", ex.getMessage());
        }
        return redirectIdeas(redirect, id);
    }

    private String redirectIdeas(String redirect, Long id) {
        if (redirect != null && redirect.startsWith("/") && !redirect.startsWith("//")) {
            return "redirect:" + redirect;
        }
        return "redirect:/ideas/" + id;
    }

    @PostMapping("/ideas/{id:\\d+}/proto-html")
    public String uploadProtoHtml(
            @PathVariable Long id,
            @RequestParam("file") org.springframework.web.multipart.MultipartFile file,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы загрузить прототип");
            return "redirect:/login?redirect=/ideas/" + id;
        }
        Idea idea = platform.getIdea(id).orElse(null);
        if (idea == null || !auth.canUploadPrototype(current, idea)) {
            ra.addFlashAttribute("error", "Загрузить прототип может ответственный разработчик или админ");
            return redirectIdeas(redirect, id);
        }
        try {
            platform.uploadPrototypeHtml(id, file);
            ra.addFlashAttribute("ok", "HTML загружен — идея на этапе «Пилот»");
            return "redirect:/ideas/" + id + "/proto";
        } catch (IllegalArgumentException | IllegalStateException ex) {
            ra.addFlashAttribute("error", ex.getMessage());
        } catch (java.io.IOException ex) {
            ra.addFlashAttribute("error", "Не удалось сохранить файл");
        }
        String target = (redirect != null && redirect.startsWith("/") && !redirect.startsWith("//"))
                ? redirect
                : "/ideas/" + id;
        return "redirect:" + target;
    }

    @PostMapping("/ideas/{id:\\d+}/proto-url")
    public String attachProtoUrl(
            @PathVariable Long id,
            @RequestParam("url") String url,
            @RequestParam(required = false) String redirect,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы прикрепить прототип");
            return "redirect:/login?redirect=/ideas/" + id;
        }
        Idea idea = platform.getIdea(id).orElse(null);
        if (idea == null || !auth.canUploadPrototype(current, idea)) {
            ra.addFlashAttribute("error", "Указать сайт может ответственный разработчик или админ");
            return redirectIdeas(redirect, id);
        }
        try {
            platform.attachPrototypeUrl(id, url);
            ra.addFlashAttribute("ok", "Ссылка на сайт сохранена — идея на этапе «Пилот»");
            return "redirect:/ideas/" + id + "/proto";
        } catch (IllegalArgumentException | IllegalStateException ex) {
            ra.addFlashAttribute("error", ex.getMessage());
        }
        return redirectIdeas(redirect, id);
    }

    @GetMapping("/ideas/{id:\\d+}/export")
    public ResponseEntity<byte[]> exportIdea(@PathVariable Long id) throws java.io.IOException {
        PlatformService.IdeaExport pack = platform.exportIdeaPackage(id);
        String encoded = URLEncoder.encode(pack.filename(), StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType(pack.contentType()))
                .body(pack.body());
    }

    @GetMapping("/ideas/{id:\\d+}/proto")
    public String viewProto(@PathVariable Long id, Model model, RedirectAttributes ra) {
        Idea idea = platform.getIdea(id).orElseThrow();
        if (!idea.hasPrototype()) {
            ra.addFlashAttribute("error", "Прототип ещё не прикреплён");
            return "redirect:/ideas/" + id;
        }
        model.addAttribute("idea", idea);
        model.addAttribute("protoSrc", idea.getProtoLink());
        model.addAttribute("protoExternal", idea.hasExternalPrototype());
        model.addAttribute("active", "ideas");
        return "proto-viewer";
    }

    @GetMapping("/rating")
    public String rating(Model model) {
        model.addAttribute("topIdeas", platform.topIdeasByRating(3));
        model.addAttribute("topAuthors", platform.topAuthors(3));
        model.addAttribute("topDevelopers", platform.topDevelopers(3));
        model.addAttribute("active", "rating");
        return "rating";
    }

    @GetMapping("/favorites")
    public String favorites(@RequestParam(required = false) String user, HttpSession session, Model model) {
        String who = who(user, session);
        List<Idea> list = platform.favoritesOf(who);
        model.addAttribute("ideas", list);
        model.addAttribute("ratings", platform.ratingMap(list));
        model.addAttribute("user", who);
        model.addAttribute("active", "favorites");
        return "favorites";
    }

    @GetMapping("/news")
    public String news(Model model) {
        model.addAttribute("items", platform.allNews());
        model.addAttribute("active", "news");
        return "news";
    }

    @PostMapping("/news")
    public String addNews(@RequestParam String title, @RequestParam String body, RedirectAttributes ra) {
        NewsItem n = new NewsItem();
        n.setTitle(title);
        n.setBody(body);
        platform.saveNews(n);
        ra.addFlashAttribute("ok", "Новость добавлена");
        return "redirect:/news";
    }

    @GetMapping({"/support", "/applications"})
    public String support(HttpSession session, Model model) {
        SessionUser current = auth.current(session).orElse(null);
        boolean isAdmin = current != null && current.isAdmin();
        model.addAttribute("ideas", platform.searchIdeas(null, null, null));
        model.addAttribute("statuses", ApplicationStatus.values());
        model.addAttribute("isAdmin", isAdmin);
        model.addAttribute("active", "support");
        if (isAdmin) {
            model.addAttribute("items", platform.allApplications());
            model.addAttribute("myItems", List.of());
        } else {
            model.addAttribute("items", List.of());
            model.addAttribute("myItems", current == null
                    ? List.of()
                    : platform.applicationsByApplicant(current.name()));
        }
        return "support";
    }

    @PostMapping({"/support", "/applications"})
    public String submitSupport(
            @RequestParam String title,
            @RequestParam String applicant,
            @RequestParam String description,
            @RequestParam(required = false) Long ideaId,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        ApplicationRequest req = new ApplicationRequest();
        req.setTitle(title);
        if (current != null) {
            req.setApplicant(current.name());
        } else {
            req.setApplicant(applicant == null || applicant.isBlank() ? "Аноним" : applicant.trim());
        }
        req.setDescription(description);
        if (ideaId != null) {
            platform.getIdea(ideaId).ifPresent(req::setRelatedIdea);
        }
        platform.submitApplication(req);
        ra.addFlashAttribute("ok", "Сообщение отправлено администраторам");
        return "redirect:/support";
    }

    @PostMapping({"/support/{id:\\d+}/feedback", "/applications/{id:\\d+}/feedback"})
    public String supportFeedback(
            @PathVariable Long id,
            @RequestParam ApplicationStatus status,
            @RequestParam(required = false) String feedback,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null || !current.isAdmin()) {
            ra.addFlashAttribute("error", "Отвечать на обращения могут только администраторы");
            return "redirect:/support";
        }
        platform.feedback(id, status, feedback);
        ra.addFlashAttribute("ok", "Ответ сохранён");
        return "redirect:/support";
    }

    @GetMapping("/teams")
    public String teams(HttpSession session, Model model) {
        SessionUser current = auth.current(session).orElse(null);
        List<Team> items = platform.allTeams();
        Map<Long, Boolean> canEditMembers = new HashMap<>();
        for (Team t : items) {
            canEditMembers.put(t.getId(), auth.canEditTeamMembers(current, t));
        }
        model.addAttribute("items", items);
        model.addAttribute("canEditMembers", canEditMembers);
        model.addAttribute("ideas", platform.searchIdeas(null, null, null));
        model.addAttribute("loggedIn", current != null);
        model.addAttribute("active", "teams");
        return "teams";
    }

    @PostMapping("/teams")
    public String createTeam(
            @RequestParam String name,
            @RequestParam(required = false) String goal,
            @RequestParam(required = false) String members,
            @RequestParam(required = false) Long ideaId,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы создать команду");
            return "redirect:/login?redirect=/teams";
        }
        Team t = new Team();
        t.setName(name);
        t.setGoal(goal);
        String roster = members == null ? "" : members.trim();
        if (!current.isAdmin()) {
            // создатель автоматически в составе
            if (roster.isBlank()) {
                roster = current.name();
            } else if (!auth.isTeamMember(current, membersTeam(roster))) {
                roster = current.name() + ", " + roster;
            }
        }
        t.setMembers(roster);
        if (ideaId != null) {
            platform.getIdea(ideaId).ifPresent(t::setRelatedIdea);
        }
        platform.saveTeam(t);
        ra.addFlashAttribute("ok", "Команда создана");
        return "redirect:/teams";
    }

    private static Team membersTeam(String members) {
        Team stub = new Team();
        stub.setMembers(members);
        return stub;
    }

    @PostMapping("/teams/{id:\\d+}/members")
    public String updateTeamMembers(
            @PathVariable Long id,
            @RequestParam(required = false) String members,
            HttpSession session,
            RedirectAttributes ra
    ) {
        SessionUser current = auth.current(session).orElse(null);
        if (current == null) {
            ra.addFlashAttribute("error", "Войдите, чтобы изменить состав");
            return "redirect:/login?redirect=/teams";
        }
        Team team = platform.getTeam(id).orElseThrow();
        if (!auth.canEditTeamMembers(current, team)) {
            ra.addFlashAttribute("error", "Состав могут менять участники команды и администраторы");
            return "redirect:/teams";
        }
        platform.updateTeamMembers(id, members);
        ra.addFlashAttribute("ok", "Состав команды обновлён");
        return "redirect:/teams";
    }

    @GetMapping("/about")
    public String about(Model model) {
        model.addAttribute("active", "about");
        return "about";
    }
}
