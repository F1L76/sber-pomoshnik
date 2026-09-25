package ru.upgrade.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import ru.upgrade.domain.ActivityAction;
import ru.upgrade.domain.ActivityEvent;
import ru.upgrade.domain.Idea;
import ru.upgrade.domain.ProtoStatus;
import ru.upgrade.repo.ActivityEventRepository;
import ru.upgrade.repo.IdeaRepository;
import ru.upgrade.security.SessionUser;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@Service
public class ActivityService {

    private final ActivityEventRepository events;
    private final IdeaRepository ideas;

    public ActivityService(ActivityEventRepository events, IdeaRepository ideas) {
        this.events = events;
        this.ideas = ideas;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(
            SessionUser user,
            ActivityAction action,
            String method,
            String path,
            Long ideaId,
            String ideaTitle,
            String detail
    ) {
        if (action == null) {
            return;
        }
        ActivityEvent e = new ActivityEvent();
        e.setOccurredAt(Instant.now());
        if (user == null) {
            e.setActorLogin("guest");
            e.setActorName("Гость");
            e.setActorRole("гость");
        } else {
            e.setActorLogin(trim(user.login(), 80));
            e.setActorName(trim(user.name(), 160));
            e.setActorRole(user.role() == null ? "" : user.role().getLabel());
        }
        e.setAction(action);
        e.setMethod(trim(method, 8));
        e.setPath(trim(path, 400));
        e.setIdeaId(ideaId);
        if ((ideaTitle == null || ideaTitle.isBlank()) && ideaId != null) {
            ideas.findById(ideaId).ifPresent(idea -> e.setIdeaTitle(trim(idea.getTitle(), 240)));
        } else {
            e.setIdeaTitle(trim(ideaTitle, 240));
        }
        e.setDetail(trim(detail, 500));
        events.save(e);
    }

    @Transactional
    public void seedIfEmpty() {
        if (events.count() > 0) {
            return;
        }
        List<Idea> catalog = ideas.findAll();
        if (catalog.isEmpty()) {
            return;
        }
        String[] actors = {
                "user|Аноним|Юзер",
                "admin|Админ|Админ",
                "platform|Админ платформы|Администратор целевой платформы",
                "guest|Гость|гость"
        };
        Instant now = Instant.now();
        List<ActivityEvent> batch = new ArrayList<>();
        int i = 0;
        for (Idea idea : catalog) {
            Instant created = idea.getCreatedAt() == null ? now.minus(20, ChronoUnit.DAYS) : idea.getCreatedAt();
            String author = idea.getAuthor() == null ? "Автор" : idea.getAuthor();
            batch.add(event(created, slug(author), author, "Юзер", ActivityAction.CREATE_IDEA,
                    "/ideas", idea.getId(), idea.getTitle(), "Подача инициативы"));

            int views = 4 + (int) ((idea.getId() == null ? 1 : idea.getId()) % 11);
            for (int v = 0; v < views; v++) {
                String[] actor = actors[(i + v) % actors.length].split("\\|");
                Instant at = now.minus((i + v * 3) % 20, ChronoUnit.DAYS).minus((v * 5) % 18, ChronoUnit.HOURS);
                batch.add(event(at, actor[0], actor[1], actor[2], ActivityAction.VIEW_IDEA,
                        "/ideas/" + idea.getId(), idea.getId(), idea.getTitle(), null));
            }

            if (idea.getProtoStatus() == ProtoStatus.SEARCHING_DEVELOPER
                    || idea.getProtoStatus() == ProtoStatus.IN_PROGRESS
                    || idea.getProtoStatus() == ProtoStatus.DONE
                    || idea.isBacklogTaken()
                    || idea.isImplemented()) {
                batch.add(event(created.plus(2, ChronoUnit.DAYS), "admin", "Админ", "Админ",
                        ActivityAction.OPEN_SEARCH, "/ideas/" + idea.getId() + "/open-search",
                        idea.getId(), idea.getTitle(), null));
            }
            if (idea.getProtoStatus() == ProtoStatus.IN_PROGRESS
                    || idea.getProtoStatus() == ProtoStatus.DONE
                    || idea.isBacklogTaken()
                    || idea.isImplemented()) {
                String dev = idea.getProtoResponsible() == null ? "Разработчик" : idea.getProtoResponsible();
                batch.add(event(created.plus(4, ChronoUnit.DAYS), slug(dev), dev, "Юзер",
                        ActivityAction.TAKE_WORK, "/ideas/" + idea.getId() + "/take",
                        idea.getId(), idea.getTitle(), null));
            }
            if (idea.hasPrototype() || idea.getProtoStatus() == ProtoStatus.DONE) {
                ActivityAction publish = idea.hasExternalPrototype() ? ActivityAction.ATTACH_SITE : ActivityAction.UPLOAD_HTML;
                batch.add(event(created.plus(6, ChronoUnit.DAYS), "user", "Аноним", "Юзер",
                        publish, idea.hasExternalPrototype() ? "/ideas/" + idea.getId() + "/proto-url"
                                : "/ideas/" + idea.getId() + "/proto-html",
                        idea.getId(), idea.getTitle(), idea.getProtoLink()));
                int launches = 6 + (int) ((idea.getId() == null ? 2 : idea.getId()) % 17);
                for (int v = 0; v < launches; v++) {
                    String[] actor = actors[(i + v + 1) % actors.length].split("\\|");
                    Instant at = now.minus((i + v * 2) % 18, ChronoUnit.DAYS).minus(v % 20, ChronoUnit.HOURS);
                    batch.add(event(at, actor[0], actor[1], actor[2], ActivityAction.VIEW_PROTO,
                            "/ideas/" + idea.getId() + "/proto", idea.getId(), idea.getTitle(), "Запуск прототипа"));
                }
            }
            if (idea.isBacklogTaken() || idea.isImplemented()) {
                batch.add(event(created.plus(10, ChronoUnit.DAYS), "platform", "Админ платформы",
                        "Администратор целевой платформы", ActivityAction.SEND_BACKLOG,
                        "/ideas/" + idea.getId() + "/to-backlog", idea.getId(), idea.getTitle(), null));
            }
            if (idea.isImplemented()) {
                batch.add(event(created.plus(14, ChronoUnit.DAYS), "platform", "Админ платформы",
                        "Администратор целевой платформы", ActivityAction.MARK_IMPLEMENTED,
                        "/ideas/" + idea.getId() + "/implement", idea.getId(), idea.getTitle(), null));
            }
            i++;
        }
        for (int d = 0; d < 14; d++) {
            String[] actor = actors[d % 3].split("\\|");
            batch.add(event(now.minus(d, ChronoUnit.DAYS).minus(8, ChronoUnit.HOURS),
                    actor[0], actor[1], actor[2], ActivityAction.LOGIN, "/login", null, null, "Сессия"));
            batch.add(event(now.minus(d, ChronoUnit.DAYS).minus(2, ChronoUnit.HOURS),
                    actor[0], actor[1], actor[2], ActivityAction.VIEW_CATALOG, "/ideas", null, null, null));
        }
        events.saveAll(batch);
    }

    private static ActivityEvent event(
            Instant when,
            String login,
            String name,
            String role,
            ActivityAction action,
            String path,
            Long ideaId,
            String ideaTitle,
            String detail
    ) {
        ActivityEvent e = new ActivityEvent();
        e.setOccurredAt(when == null ? Instant.now() : when);
        e.setActorLogin(trim(login, 80));
        e.setActorName(trim(name, 160));
        e.setActorRole(trim(role, 64));
        e.setAction(action);
        e.setMethod("GET");
        e.setPath(trim(path, 400));
        e.setIdeaId(ideaId);
        e.setIdeaTitle(trim(ideaTitle, 240));
        e.setDetail(trim(detail, 500));
        return e;
    }

    private static String slug(String name) {
        if (name == null || name.isBlank()) {
            return "user";
        }
        String compact = name.trim().toLowerCase().replaceAll("[^a-zа-яё0-9]+", "-");
        return compact.isBlank() ? "user" : compact.substring(0, Math.min(80, compact.length()));
    }

    private static String trim(String value, int max) {
        if (value == null) {
            return null;
        }
        String v = value.trim();
        if (v.isEmpty()) {
            return null;
        }
        return v.length() <= max ? v : v.substring(0, max);
    }
}
