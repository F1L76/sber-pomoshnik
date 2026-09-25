package ru.upgrade.service;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.upgrade.domain.*;
import ru.upgrade.repo.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class AnalyticsService {

    private static final ZoneId ZONE = ZoneId.of("Europe/Moscow");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd.MM");
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("dd.MM HH:mm");

    private final IdeaRepository ideas;
    private final IdeaRatingRepository ratings;
    private final FavoriteRepository favorites;
    private final ApplicationRequestRepository applications;
    private final TestIssueRepository issues;
    private final TeamRepository teams;
    private final ActivityEventRepository events;

    public AnalyticsService(
            IdeaRepository ideas,
            IdeaRatingRepository ratings,
            FavoriteRepository favorites,
            ApplicationRequestRepository applications,
            TestIssueRepository issues,
            TeamRepository teams,
            ActivityEventRepository events
    ) {
        this.ideas = ideas;
        this.ratings = ratings;
        this.favorites = favorites;
        this.applications = applications;
        this.issues = issues;
        this.teams = teams;
        this.events = events;
    }

    @Transactional(readOnly = true)
    public Dashboard build(int days, ActivityAction logFilter) {
        int window = days <= 0 ? 3650 : Math.min(Math.max(days, 1), 365);
        Instant from = Instant.now().minusSeconds(window * 24L * 3600L);
        List<Idea> catalog = ideas.findAll();
        List<ActivityEvent> period = events.findByOccurredAtGreaterThanEqual(from);
        List<ActivityEvent> dayEvents = events.findByOccurredAtGreaterThanEqual(
                Instant.now().minusSeconds(24L * 3600L));
        List<ActivityEvent> weekEvents = events.findByOccurredAtGreaterThanEqual(
                Instant.now().minusSeconds(7L * 24L * 3600L));

        int total = catalog.size();
        long html = catalog.stream().filter(Idea::hasDownloadablePrototypeHtml).count();
        long sites = catalog.stream().filter(Idea::hasExternalPrototype).count();
        long withProto = catalog.stream().filter(Idea::hasPrototype).count();
        long implemented = catalog.stream().filter(Idea::isImplemented).count();
        long backlog = catalog.stream().filter(i -> i.isBacklogTaken() && !i.isImplemented()).count();
        long protoDone = catalog.stream().filter(i -> i.getProtoStatus() == ProtoStatus.DONE).count();
        long inDev = catalog.stream().filter(i -> i.getProtoStatus() == ProtoStatus.IN_PROGRESS).count();
        long searching = catalog.stream().filter(i -> i.getProtoStatus() == ProtoStatus.SEARCHING_DEVELOPER).count();
        Instant ideaFrom = from;
        long newIdeas = catalog.stream()
                .filter(i -> i.getCreatedAt() != null && !i.getCreatedAt().isBefore(ideaFrom))
                .count();

        long protoOpens = count(period, ActivityAction.VIEW_PROTO);
        long protoPublishes = period.stream().filter(e -> e.getAction() != null && e.getAction().isPrototypePublish()).count();
        long logins = count(period, ActivityAction.LOGIN);
        long catalogViews = count(period, ActivityAction.VIEW_CATALOG);
        long ideaViews = count(period, ActivityAction.VIEW_IDEA);
        long rates = count(period, ActivityAction.RATE);
        double avgOpens = withProto == 0 ? 0 : (double) protoOpens / withProto;
        double implRate = total == 0 ? 0 : 100.0 * implemented / total;
        double protoRate = total == 0 ? 0 : 100.0 * withProto / total;

        List<Kpi> kpis = List.of(
                kpi("Активные за сутки", String.valueOf(uniqueActors(dayEvents)), "DAU · уникальные логины"),
                kpi("Активные за неделю", String.valueOf(uniqueActors(weekEvents)), "WAU"),
                kpi("Активные за период", String.valueOf(uniqueActors(period)), window + " дн. · MAU окна"),
                kpi("Входов", String.valueOf(logins), "успешные сессии за период"),
                kpi("Идей в каталоге", String.valueOf(total), "+" + newIdeas + " новых за период"),
                kpi("Внедрено", String.valueOf(implemented), pct(implRate) + " от каталога"),
                kpi("Прототипов", String.valueOf(withProto), html + " HTML · " + sites + " сайтов"),
                kpi("Запусков прототипов", String.valueOf(protoOpens), "в среднем " + trimNum(avgOpens) + " на прототип"),
                kpi("Публикаций прототипа", String.valueOf(protoPublishes), "HTML или ссылка на сайт"),
                kpi("Просмотры каталога", String.valueOf(catalogViews), ideaViews + " карточек идей"),
                kpi("Оценки", String.valueOf(ratings.count()), rates + " за период"),
                kpi("Избранное", String.valueOf(favorites.count()), "сохранений"),
                kpi("Обращения", String.valueOf(applications.count()), "поддержка"),
                kpi("Замечания пилота", String.valueOf(issues.count()), teams.count() + " команд")
        );

        List<FunnelStep> funnel = funnel(total, searching + inDev + protoDone + backlog + implemented,
                withProto, backlog + implemented, implemented);

        Map<String, Long> stageCounts = new LinkedHashMap<>();
        for (String name : List.of(
                IdeaStageFactory.STAGE_SUBMIT, IdeaStageFactory.STAGE_EVAL, IdeaStageFactory.STAGE_SEARCH,
                IdeaStageFactory.STAGE_PROTO, IdeaStageFactory.STAGE_PILOT, IdeaStageFactory.STAGE_BACKLOG,
                IdeaStageFactory.STAGE_DONE)) {
            stageCounts.put(name, 0L);
        }
        for (Idea idea : catalog) {
            IdeaStage cur = idea.currentStage();
            String name = idea.isImplemented() ? IdeaStageFactory.STAGE_DONE
                    : (cur == null ? IdeaStageFactory.STAGE_SUBMIT : cur.getName());
            stageCounts.merge(name, 1L, Long::sum);
        }
        long stageMax = Math.max(1, stageCounts.values().stream().mapToLong(Long::longValue).max().orElse(1));
        List<NamedCount> stages = stageCounts.entrySet().stream()
                .map(e -> named(e.getKey(), e.getValue(), (int) Math.round(100.0 * e.getValue() / stageMax)))
                .toList();

        List<NamedCount> protoMix = List.of(
                named("HTML в платформе", html, share(html, total)),
                named("Развёрнутый сайт", sites, share(sites, total)),
                named("Ещё нет прототипа", total - withProto, share(total - withProto, total))
        );

        Map<Long, long[]> protoStats = new HashMap<>();
        for (ActivityEvent e : period) {
            if (e.getAction() != ActivityAction.VIEW_PROTO || e.getIdeaId() == null) {
                continue;
            }
            protoStats.computeIfAbsent(e.getIdeaId(), id -> new long[]{0, 0});
            protoStats.get(e.getIdeaId())[0]++;
        }
        Map<Long, String> titles = catalog.stream()
                .filter(i -> i.getId() != null)
                .collect(Collectors.toMap(Idea::getId, Idea::getTitle, (a, b) -> a));
        long protoMax = protoStats.values().stream().mapToLong(v -> v[0]).max().orElse(1);
        List<NamedCount> topProtos = protoStats.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue()[0], a.getValue()[0]))
                .limit(8)
                .map(e -> named(
                        titles.getOrDefault(e.getKey(), "Идея #" + e.getKey()),
                        e.getValue()[0],
                        (int) Math.round(100.0 * e.getValue()[0] / Math.max(1, protoMax))))
                .toList();

        Map<String, Long> users = new HashMap<>();
        for (ActivityEvent e : period) {
            String key = e.getActorName() == null || e.getActorName().isBlank()
                    ? (e.getActorLogin() == null ? "Гость" : e.getActorLogin())
                    : e.getActorName();
            users.merge(key, 1L, Long::sum);
        }
        long userMax = users.values().stream().mapToLong(Long::longValue).max().orElse(1);
        List<NamedCount> topUsers = users.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue(), a.getValue()))
                .limit(8)
                .map(e -> named(e.getKey(), e.getValue(), (int) Math.round(100.0 * e.getValue() / userMax)))
                .toList();

        Map<ActivityAction, Long> byAction = new EnumMap<>(ActivityAction.class);
        for (ActivityEvent e : period) {
            if (e.getAction() != null) {
                byAction.merge(e.getAction(), 1L, Long::sum);
            }
        }
        long actionMax = byAction.values().stream().mapToLong(Long::longValue).max().orElse(1);
        List<NamedCount> actions = byAction.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue(), a.getValue()))
                .limit(10)
                .map(e -> named(e.getKey().getLabel(), e.getValue(),
                        (int) Math.round(100.0 * e.getValue() / actionMax)))
                .toList();

        int trendDays = Math.min(14, window);
        List<DayPoint> trend = trend(period, trendDays);

        List<ActivityEvent> logSource = logFilter == null
                ? events.findByOccurredAtGreaterThanEqualOrderByOccurredAtDesc(from, PageRequest.of(0, 80))
                : events.findByOccurredAtGreaterThanEqualAndActionOrderByOccurredAtDesc(
                        from, logFilter, PageRequest.of(0, 80));
        List<LogRow> logs = logSource.stream().map(this::toRow).toList();

        return new Dashboard(
                window,
                kpis,
                funnel,
                stages,
                protoMix,
                topProtos,
                topUsers,
                actions,
                trend,
                logs,
                events.countByOccurredAtGreaterThanEqual(from),
                pct(protoRate),
                searching,
                inDev,
                protoDone,
                backlog,
                implemented
        );
    }

    private List<FunnelStep> funnel(long submitted, long inWork, long proto, long backlog, long done) {
        long max = Math.max(1, submitted);
        return List.of(
                new FunnelStep("Подано", submitted, (int) Math.round(100.0 * submitted / max), "100%"),
                new FunnelStep("В работе", inWork, (int) Math.round(100.0 * inWork / max), pct(100.0 * inWork / max)),
                new FunnelStep("Есть прототип", proto, (int) Math.round(100.0 * proto / max), pct(100.0 * proto / max)),
                new FunnelStep("В бэклоге", backlog, (int) Math.round(100.0 * backlog / max), pct(100.0 * backlog / max)),
                new FunnelStep("Внедрено", done, (int) Math.round(100.0 * done / max), pct(100.0 * done / max))
        );
    }

    private List<DayPoint> trend(List<ActivityEvent> period, int days) {
        LocalDate today = LocalDate.now(ZONE);
        Map<LocalDate, int[]> buckets = new LinkedHashMap<>();
        for (int i = days - 1; i >= 0; i--) {
            buckets.put(today.minusDays(i), new int[]{0, 0, 0, 0});
        }
        for (ActivityEvent e : period) {
            if (e.getOccurredAt() == null) {
                continue;
            }
            LocalDate day = e.getOccurredAt().atZone(ZONE).toLocalDate();
            int[] b = buckets.get(day);
            if (b == null) {
                continue;
            }
            b[0]++;
            if (e.getAction() == ActivityAction.VIEW_PROTO) {
                b[1]++;
            }
            if (e.getAction() == ActivityAction.LOGIN) {
                b[2]++;
            }
            if (e.getAction() == ActivityAction.CREATE_IDEA) {
                b[3]++;
            }
        }
        int max = buckets.values().stream().mapToInt(v -> v[0]).max().orElse(1);
        List<DayPoint> points = new ArrayList<>();
        for (Map.Entry<LocalDate, int[]> e : buckets.entrySet()) {
            int[] v = e.getValue();
            points.add(new DayPoint(
                    e.getKey().format(DAY),
                    v[0], v[1], v[2], v[3],
                    (int) Math.round(100.0 * v[0] / Math.max(1, max)),
                    (int) Math.round(100.0 * v[1] / Math.max(1, max)),
                    (int) Math.round(100.0 * v[2] / Math.max(1, max))
            ));
        }
        return points;
    }

    private LogRow toRow(ActivityEvent e) {
        String when = e.getOccurredAt() == null ? "—" : TS.format(e.getOccurredAt().atZone(ZONE));
        String who = e.getActorName() == null || e.getActorName().isBlank() ? e.getActorLogin() : e.getActorName();
        return new LogRow(
                when,
                who == null ? "Гость" : who,
                e.getActorRole() == null ? "—" : e.getActorRole(),
                e.getAction() == null ? "—" : e.getAction().getLabel(),
                e.getAction() == null ? "" : e.getAction().name(),
                e.getIdeaTitle() == null ? (e.getPath() == null ? "" : e.getPath()) : e.getIdeaTitle(),
                e.getIdeaId(),
                e.getDetail() == null ? "" : e.getDetail()
        );
    }

    private static long uniqueActors(List<ActivityEvent> list) {
        return list.stream()
                .map(e -> e.getActorLogin() == null ? "guest" : e.getActorLogin())
                .filter(s -> !s.isBlank())
                .distinct()
                .count();
    }

    private static long count(List<ActivityEvent> list, ActivityAction action) {
        return list.stream().filter(e -> e.getAction() == action).count();
    }

    private static Kpi kpi(String label, String value, String hint) {
        return new Kpi(label, value, hint);
    }

    private static NamedCount named(String name, long count, int bar) {
        return new NamedCount(name, count, Math.max(4, Math.min(100, bar)));
    }

    private static int share(long part, long total) {
        if (total <= 0) {
            return 0;
        }
        return (int) Math.round(100.0 * part / total);
    }

    private static String pct(double value) {
        return Math.round(value) + "%";
    }

    private static String trimNum(double value) {
        return String.format(java.util.Locale.US, "%.1f", value);
    }

    public record Dashboard(
            int days,
            List<Kpi> kpis,
            List<FunnelStep> funnel,
            List<NamedCount> stages,
            List<NamedCount> protoMix,
            List<NamedCount> topProtos,
            List<NamedCount> topUsers,
            List<NamedCount> actions,
            List<DayPoint> trend,
            List<LogRow> logs,
            long eventsInPeriod,
            String protoCoverage,
            long searching,
            long inDev,
            long protoDone,
            long backlog,
            long implemented
    ) {}

    public record Kpi(String label, String value, String hint) {}
    public record FunnelStep(String label, long count, int bar, String share) {}
    public record NamedCount(String name, long count, int bar) {}
    public record DayPoint(String day, int events, int protoOpens, int logins, int ideas, int eventsBar, int protoBar, int loginBar) {}
    public record LogRow(String when, String who, String role, String action, String actionCode, String target, Long ideaId, String detail) {}
}
