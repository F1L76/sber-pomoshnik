package ru.upgrade.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.upgrade.domain.*;
import ru.upgrade.repo.*;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class PlatformService {

    private final IdeaRepository ideas;
    private final IdeaRatingRepository ratings;
    private final FavoriteRepository favorites;
    private final NewsItemRepository news;
    private final ApplicationRequestRepository applications;
    private final TeamRepository teams;
    private final TestIssueRepository testIssues;
    private final DirectionTagRepository tags;
    private final UploadService uploads;
    private final ObjectMapper objectMapper;

    public static final List<String> CATALOG_DIRECTIONS = List.of(
            "Оценка",
            "Осмотр",
            "Риски",
            "Простая экспертиза",
            "ФЖН",
            "CRE",
            "Онлайн-оценка",
            "Аспект",
            "АС Залоги",
            "Навигатор",
            "Ценности",
            "ЕГРН",
            "Обременения",
            "Сберлизинг",
            "Методология",
            "Внешний потребитель"
    );

    public static final List<String> TARGET_PLATFORMS = List.of(
            "АС Залоги",
            "Аспект",
            "Онлайн-оценка",
            "ИТ ЦООП",
            "Методология",
            "CRE",
            "Сберлизинг"
    );

    public PlatformService(
            IdeaRepository ideas,
            IdeaRatingRepository ratings,
            FavoriteRepository favorites,
            NewsItemRepository news,
            ApplicationRequestRepository applications,
            TeamRepository teams,
            TestIssueRepository testIssues,
            DirectionTagRepository tags,
            UploadService uploads,
            ObjectMapper objectMapper
    ) {
        this.ideas = ideas;
        this.ratings = ratings;
        this.favorites = favorites;
        this.news = news;
        this.applications = applications;
        this.teams = teams;
        this.testIssues = testIssues;
        this.tags = tags;
        this.uploads = uploads;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<Idea> searchIdeas(String q, ProtoStatus proto, Boolean implemented) {
        return searchIdeas(q, proto, implemented, null, IdeaSort.POPULARITY);
    }

    @Transactional(readOnly = true)
    public List<Idea> searchIdeas(String q, ProtoStatus proto, Boolean implemented, String tag) {
        return searchIdeas(q, proto, implemented, tag, IdeaSort.POPULARITY);
    }

    @Transactional(readOnly = true)
    public List<Idea> searchIdeas(String q, ProtoStatus proto, Boolean implemented, String tag, IdeaSort sort) {
        String query = (q == null || q.isBlank()) ? null : q.trim();
        String tagName = (tag == null || tag.isBlank()) ? null : tag.trim();
        List<Idea> list = new ArrayList<>(ideas.search(query, proto, implemented, tagName));
        list.forEach(i -> {
            ensureStages(i);
            touchTags(i);
        });
        return sortIdeas(list, sort == null ? IdeaSort.POPULARITY : sort);
    }

    private List<Idea> sortIdeas(List<Idea> list, IdeaSort sort) {
        Map<Long, Double> avgs = ratingMap(list);
        Map<Long, Long> votes = ratingCountMap(list);
        Comparator<Idea> byVotes = Comparator.comparing((Idea i) -> votes.getOrDefault(i.getId(), 0L)).reversed();
        Comparator<Idea> byRating = Comparator.comparing((Idea i) -> avgs.getOrDefault(i.getId(), 0.0)).reversed();
        Comparator<Idea> byUpdated = Comparator.comparing(Idea::getUpdatedAt, Comparator.nullsLast(Comparator.naturalOrder())).reversed();
        Comparator<Idea> cmp = switch (sort) {
            case RATING -> byRating.thenComparing(byVotes).thenComparing(byUpdated);
            case VOTES -> byVotes.thenComparing(byRating).thenComparing(byUpdated);
            case NEWEST -> byUpdated.thenComparing(byRating).thenComparing(byVotes);
            case POPULARITY -> byRating.thenComparing(byVotes).thenComparing(byUpdated);
        };
        list.sort(cmp);
        return list;
    }

    @Transactional(readOnly = true)
    public Optional<Idea> getIdea(Long id) {
        Optional<Idea> idea = ideas.findById(id);
        idea.ifPresent(i -> {
            ensureStages(i);
            touchTags(i);
        });
        return idea;
    }

    public record IdeaExport(byte[] body, String contentType, String filename) {}

    @Transactional(readOnly = true)
    public IdeaExport exportIdeaPackage(Long id) throws IOException {
        Idea idea = getIdea(id).orElseThrow();
        Path htmlFile = resolveLocalPrototypeFile(idea);
        boolean includeHtml = htmlFile != null && Files.isRegularFile(htmlFile);

        Map<String, Object> payload = buildFullIdeaExport(idea, includeHtml);
        byte[] json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(payload);
        String base = exportFileBase(idea);

        if (!includeHtml) {
            return new IdeaExport(json, "application/json;charset=UTF-8", base + ".json");
        }

        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bos)) {
            zip.putNextEntry(new ZipEntry("idea.json"));
            zip.write(json);
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("prototype.html"));
            Files.copy(htmlFile, zip);
            zip.closeEntry();
        }
        return new IdeaExport(bos.toByteArray(), "application/zip", base + ".zip");
    }

    private Map<String, Object> buildFullIdeaExport(Idea idea, boolean htmlIncluded) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", idea.getId());
        m.put("title", idea.getTitle());
        m.put("author", idea.getAuthor());
        m.put("description", idea.getDescription());
        m.put("expectedEffect", idea.getExpectedEffect());
        m.put("targetPlatform", idea.getTargetPlatform());
        m.put("forWhom", idea.getForWhom());
        m.put("howToUse", idea.getHowToUse());
        m.put("protoStatus", idea.getProtoStatus() == null ? null : idea.getProtoStatus().name());
        m.put("protoStatusLabel", idea.getProtoStatus() == null ? null : idea.getProtoStatus().getLabel());
        m.put("protoResponsible", idea.getProtoResponsible());
        m.put("protoAuthors", idea.getProtoAuthors());
        m.put("protoLink", idea.getProtoLink());
        m.put("protoIsDownload", idea.isProtoIsDownload());
        m.put("prototypeKind", idea.hasDownloadablePrototypeHtml() ? "html"
                : (idea.hasExternalPrototype() ? "site" : null));
        m.put("prototypeFile", htmlIncluded ? "prototype.html" : null);
        m.put("backlogTaken", idea.isBacklogTaken());
        m.put("backlogTeam", idea.getBacklogTeam());
        m.put("implemented", idea.isImplemented());
        m.put("createdAt", idea.getCreatedAt() == null ? null : idea.getCreatedAt().toString());
        m.put("updatedAt", idea.getUpdatedAt() == null ? null : idea.getUpdatedAt().toString());
        m.put("currentStage", idea.currentStage() == null ? null : idea.currentStage().getName());
        m.put("stageProgressPercent", idea.stageProgressPercent());
        m.put("tags", idea.getTags().stream().map(DirectionTag::getName).sorted().toList());
        m.put("stages", idea.getStages().stream().map(s -> {
            Map<String, Object> st = new LinkedHashMap<>();
            st.put("sortOrder", s.getSortOrder());
            st.put("name", s.getName());
            st.put("responsible", s.getResponsible());
            st.put("description", s.getDescription());
            st.put("status", s.getStatus() == null ? null : s.getStatus().name());
            st.put("statusLabel", s.getStatus() == null ? null : s.getStatus().getLabel());
            return st;
        }).toList());
        m.put("rating", Map.of(
                "average", avgRating(idea.getId()),
                "votes", ratingCount(idea.getId())
        ));
        m.put("testIssues", testIssuesFor(idea.getId()).stream().map(issue -> {
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("id", issue.getId());
            t.put("author", issue.getAuthor());
            t.put("role", issue.getRole());
            t.put("message", issue.getMessage());
            t.put("status", issue.getStatus() == null ? null : issue.getStatus().name());
            t.put("statusLabel", issue.getStatus() == null ? null : issue.getStatus().getLabel());
            t.put("createdAt", issue.getCreatedAt() == null ? null : issue.getCreatedAt().toString());
            t.put("attachmentName", issue.getAttachmentOriginalName());
            t.put("attachmentContentType", issue.getAttachmentContentType());
            return t;
        }).toList());
        return m;
    }

    private Path resolveLocalPrototypeFile(Idea idea) {
        String link = idea.getProtoLink();
        if (link == null || link.isBlank()) {
            return null;
        }
        String path = link.trim();
        if (!path.startsWith("/uploads/")) {
            return null;
        }
        String name = path.substring("/uploads/".length());
        if (name.isBlank() || name.contains("..") || name.contains("/") || name.contains("\\")) {
            return null;
        }
        String lower = name.toLowerCase();
        if (!(lower.endsWith(".html") || lower.endsWith(".htm"))) {
            return null;
        }
        Path resolved = uploads.root().resolve(name).normalize();
        if (!resolved.startsWith(uploads.root())) {
            return null;
        }
        return resolved;
    }

    private static String exportFileBase(Idea idea) {
        String title = idea.getTitle() == null ? "idea" : idea.getTitle().trim();
        String slug = title
                .replaceAll("[\\\\/:*?\"<>|]+", " ")
                .replaceAll("\\s+", "-")
                .replaceAll("-+", "-");
        if (slug.length() > 60) {
            slug = slug.substring(0, 60);
        }
        if (slug.isBlank()) {
            slug = "idea";
        }
        return "upgrade-" + idea.getId() + "-" + slug;
    }

    @Transactional
    public Idea saveIdea(Idea idea) {
        Idea saved = ideas.save(idea);
        ensureStages(saved);
        return ideas.save(saved);
    }

    @Transactional
    public void ensureStagesForAll() {
        for (Idea idea : ideas.findAll()) {
            ensureStages(idea);
            ideas.save(idea);
        }
    }

    @Transactional
    public void clearAllIdeas() {
        favorites.deleteAll();
        ratings.deleteAll();
        testIssues.deleteAll();
        for (Team t : teams.findAll()) {
            t.setRelatedIdea(null);
            teams.save(t);
        }
        for (ApplicationRequest a : applications.findAll()) {
            a.setRelatedIdea(null);
            applications.save(a);
        }
        ideas.deleteAll();
    }

    private void ensureStages(Idea idea) {
        IdeaStageFactory.syncProtoStatus(idea);
        List<IdeaStage> next = IdeaStageFactory.buildFor(idea);
        List<IdeaStage> current = idea.getStages();
        boolean sameShape = current != null && current.size() == next.size() && !current.isEmpty();
        if (sameShape) {
            for (int i = 0; i < next.size(); i++) {
                if (!next.get(i).getName().equals(current.get(i).getName())) {
                    sameShape = false;
                    break;
                }
            }
        }
        if (!sameShape) {
            idea.replaceStages(next);
            return;
        }
        for (int i = 0; i < next.size(); i++) {
            IdeaStage src = next.get(i);
            IdeaStage dst = current.get(i);
            dst.setName(src.getName());
            dst.setResponsible(src.getResponsible());
            dst.setDescription(src.getDescription());
            dst.setSortOrder(src.getSortOrder());
            dst.setStatus(src.getStatus());
        }
    }

    private void touchStages(Idea idea) {
        idea.getStages().size();
    }

    private void touchTags(Idea idea) {
        idea.getTags().size();
    }

    @Transactional
    public void ensureCatalogTags() {
        for (DirectionTag tag : tags.findAll()) {
            boolean inCatalog = CATALOG_DIRECTIONS.stream().anyMatch(c -> c.equalsIgnoreCase(tag.getName()));
            if (tag.isCatalog() != inCatalog) {
                tag.setCatalog(inCatalog);
                tags.save(tag);
            }
        }
        for (String name : CATALOG_DIRECTIONS) {
            tags.findByNameIgnoreCase(name).orElseGet(() -> {
                DirectionTag tag = new DirectionTag();
                tag.setName(name);
                tag.setCatalog(true);
                return tags.save(tag);
            });
        }
    }

    @Transactional(readOnly = true)
    public List<DirectionTag> catalogTags() {
        Map<String, DirectionTag> byName = new HashMap<>();
        for (DirectionTag tag : tags.findByCatalogTrueOrderByNameAsc()) {
            byName.put(tag.getName().toLowerCase(), tag);
        }
        java.util.ArrayList<DirectionTag> ordered = new java.util.ArrayList<>();
        for (String name : CATALOG_DIRECTIONS) {
            DirectionTag tag = byName.get(name.toLowerCase());
            if (tag != null) {
                ordered.add(tag);
            }
        }
        return ordered;
    }

    @Transactional(readOnly = true)
    public List<TagStat> popularTags(int limit) {
        Map<String, Long> counts = new HashMap<>();
        for (Object[] row : tags.popularity()) {
            counts.put(String.valueOf(row[0]).toLowerCase(), ((Number) row[1]).longValue());
        }
        return catalogTags().stream()
                .map(t -> new TagStat(t.getName(), counts.getOrDefault(t.getName().toLowerCase(), 0L)))
                .limit(Math.max(limit, 1))
                .toList();
    }

    @Transactional
    public Idea saveIdeaWithTags(Idea idea, List<String> tagNames) {
        Idea saved = ideas.save(idea);
        applyTags(saved, tagNames);
        ensureStages(saved);
        return ideas.save(saved);
    }

    @Transactional
    public Idea updateIdeaFields(Long id, Idea patch, List<String> tagNames, boolean admin) {
        Idea existing = ideas.findById(id).orElseThrow();
        existing.setTitle(patch.getTitle());
        existing.setDescription(patch.getDescription());
        existing.setExpectedEffect(patch.getExpectedEffect());
        existing.setTargetPlatform(patch.getTargetPlatform());
        if (admin) {
            if (patch.getAuthor() != null && !patch.getAuthor().isBlank()) {
                existing.setAuthor(patch.getAuthor().trim());
            }
            existing.setForWhom(patch.getForWhom());
            existing.setHowToUse(patch.getHowToUse());
            if (patch.getProtoStatus() != null) {
                existing.setProtoStatus(patch.getProtoStatus());
            }
            existing.setProtoResponsible(patch.getProtoResponsible());
            existing.setProtoAuthors(patch.getProtoAuthors());
            existing.setProtoLink(patch.getProtoLink());
            existing.setProtoIsDownload(existing.hasDownloadablePrototypeHtml());
            existing.setBacklogTaken(patch.isBacklogTaken());
            existing.setBacklogTeam(patch.getBacklogTeam());
            existing.setImplemented(patch.isImplemented());
        }
        applyTags(existing, tagNames);
        ensureStages(existing);
        return ideas.save(existing);
    }

    @Transactional
    public Idea takeIntoWork(Long ideaId, String developerName) {
        Idea idea = ideas.findById(ideaId).orElseThrow();
        if (idea.getProtoStatus() != ProtoStatus.SEARCHING_DEVELOPER) {
            throw new IllegalStateException("Идея уже не в статусе «поиск разработчика»");
        }
        String name = developerName == null ? "" : developerName.trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) {
            throw new IllegalArgumentException("Не указан разработчик");
        }
        idea.setProtoStatus(ProtoStatus.IN_PROGRESS);
        idea.setProtoResponsible(name);
        String authors = idea.getProtoAuthors();
        if (authors == null || authors.isBlank()) {
            idea.setProtoAuthors(name);
        } else if (!authors.toLowerCase().contains(name.toLowerCase())) {
            idea.setProtoAuthors(authors.trim() + ", " + name);
        }
        ensureStages(idea);
        return ideas.save(idea);
    }

    @Transactional
    public Idea uploadPrototypeHtml(Long ideaId, org.springframework.web.multipart.MultipartFile htmlFile)
            throws java.io.IOException {
        Idea idea = ideas.findById(ideaId).orElseThrow();
        UploadService.StoredFile stored = uploads.storeHtml(htmlFile);
        return finishPrototype(idea, "/uploads/" + stored.storedName(), true);
    }

    @Transactional
    public Idea attachPrototypeUrl(Long ideaId, String url) {
        Idea idea = ideas.findById(ideaId).orElseThrow();
        return finishPrototype(idea, normalizePrototypeUrl(url), false);
    }

    private Idea finishPrototype(Idea idea, String link, boolean downloadableHtml) {
        idea.setProtoLink(link);
        idea.setProtoIsDownload(downloadableHtml);
        idea.setProtoStatus(ProtoStatus.DONE);
        ensureStages(idea);
        return ideas.save(idea);
    }

    static String normalizePrototypeUrl(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Укажите ссылку на развёрнутый сайт");
        }
        String value = raw.trim();
        String lower = value.toLowerCase();
        if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")
                || lower.startsWith("vbscript:") || lower.startsWith("blob:")) {
            throw new IllegalArgumentException("Можно указать только http(s)-ссылку на сайт");
        }
        if (value.startsWith("/") && !value.startsWith("//")) {
            throw new IllegalArgumentException("Укажите полный адрес сайта, например https://example.com");
        }
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            if (value.contains("://")) {
                throw new IllegalArgumentException("Можно указать только http(s)-ссылку на сайт");
            }
            value = "https://" + value;
        }
        if (value.length() > 1000) {
            throw new IllegalArgumentException("Ссылка слишком длинная");
        }
        try {
            java.net.URI uri = java.net.URI.create(value);
            if (uri.getHost() == null || uri.getHost().isBlank()) {
                throw new IllegalArgumentException("Некорректная ссылка на сайт");
            }
            String scheme = uri.getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                throw new IllegalArgumentException("Можно указать только http(s)-ссылку на сайт");
            }
            return uri.toString();
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalArgumentException("Некорректная ссылка на сайт");
        }
    }

    @Transactional
    public Idea openDeveloperSearch(Long ideaId) {
        Idea idea = ideas.findById(ideaId).orElseThrow();
        if (!idea.canOpenDeveloperSearch()) {
            throw new IllegalStateException("Поиск разработчика можно открыть после оценки");
        }
        idea.setProtoStatus(ProtoStatus.SEARCHING_DEVELOPER);
        ensureStages(idea);
        return ideas.save(idea);
    }

    @Transactional
    public Idea sendToBacklog(Long ideaId, String actorName) {
        Idea idea = ideas.findById(ideaId).orElseThrow();
        if (!idea.canSendToBacklog()) {
            throw new IllegalStateException("Сначала завершите пилот: загрузите HTML или укажите ссылку на сайт");
        }
        String actor = actorName == null ? "" : actorName.trim().replaceAll("\\s+", " ");
        idea.setBacklogTaken(true);
        if (idea.getBacklogTeam() == null || idea.getBacklogTeam().isBlank()) {
            idea.setBacklogTeam(actor.isEmpty() ? "профильный бэклог" : actor);
        }
        ensureStages(idea);
        return ideas.save(idea);
    }

    @Transactional
    public Idea markImplemented(Long ideaId, String actorName) {
        Idea idea = ideas.findById(ideaId).orElseThrow();
        if (!idea.canMarkImplemented()) {
            throw new IllegalStateException("Сначала передайте инициативу в профильный бэклог");
        }
        idea.setImplemented(true);
        String actor = actorName == null ? "" : actorName.trim().replaceAll("\\s+", " ");
        if ((idea.getBacklogTeam() == null || idea.getBacklogTeam().isBlank()) && !actor.isEmpty()) {
            idea.setBacklogTeam(actor);
        }
        ensureStages(idea);
        return ideas.save(idea);
    }

    @Transactional
    public void applyTags(Idea idea, List<String> tagNames) {
        idea.getTags().clear();
        if (tagNames == null) {
            return;
        }
        for (String raw : tagNames) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            String name = raw.trim().replaceAll("\\s+", " ");
            if (name.length() > 120) {
                name = name.substring(0, 120);
            }
            final String finalName = name;
            DirectionTag tag = tags.findByNameIgnoreCase(finalName).orElseGet(() -> {
                DirectionTag created = new DirectionTag();
                created.setName(finalName);
                created.setCatalog(CATALOG_DIRECTIONS.stream().anyMatch(c -> c.equalsIgnoreCase(finalName)));
                return tags.save(created);
            });
            idea.getTags().add(tag);
        }
    }

    @Transactional
    public void seedMissingIdeaTags() {
        for (Idea idea : ideas.findAll()) {
            if (!idea.getTags().isEmpty()) {
                continue;
            }
            List<String> guessed = guessTagsFor(idea);
            if (!guessed.isEmpty()) {
                applyTags(idea, guessed);
                ideas.save(idea);
            }
        }
    }

    private List<String> guessTagsFor(Idea idea) {
        String hay = ((idea.getTitle() == null ? "" : idea.getTitle()) + " "
                + (idea.getDescription() == null ? "" : idea.getDescription())
                + " " + (idea.getAuthor() == null ? "" : idea.getAuthor())).toLowerCase();
        java.util.ArrayList<String> out = new java.util.ArrayList<>();
        if (hay.contains("фжн")) out.add("ФЖН");
        if (hay.contains("навигатор")) out.add("Навигатор");
        if (hay.contains("егрн") || hay.contains("кадастр") || hay.contains("росреестр")) out.add("ЕГРН");
        if (hay.contains("онлайн") || hay.contains("оценк")) out.add("Онлайн-оценка");
        if (hay.contains("оценк") && !out.contains("Онлайн-оценка")) out.add("Оценка");
        if (hay.contains("осмотр")) out.add("Осмотр");
        if (hay.contains("риск")) out.add("Риски");
        if (hay.contains("cre")) out.add("CRE");
        if (hay.contains("аспект")) out.add("Аспект");
        if (hay.contains("залог")) out.add("АС Залоги");
        if (hay.contains("ценност")) out.add("Ценности");
        if (hay.contains("обремен")) out.add("Обременения");
        if (hay.contains("сберлизинг") || hay.contains("лизинг")) out.add("Сберлизинг");
        if (hay.contains("методолог")) out.add("Методология");
        if (hay.contains("внешн") || hay.contains("потребител")) out.add("Внешний потребитель");
        if (hay.contains("эксперт")) out.add("Простая экспертиза");
        if (out.isEmpty() && hay.contains("цооп")) out.add("Оценка");
        return out;
    }

    @Transactional
    public void deleteIdea(Long id) {
        favorites.deleteByIdeaId(id);
        ratings.deleteByIdeaId(id);
        testIssues.deleteByIdeaId(id);
        ideas.deleteById(id);
    }

    @Transactional(readOnly = true)
    public List<TestIssue> testIssuesFor(Long ideaId) {
        return testIssues.findByIdeaIdOrderByCreatedAtDesc(ideaId);
    }

    @Transactional(readOnly = true)
    public Map<Long, List<TestIssue>> testIssuesMap(List<Idea> list) {
        Map<Long, List<TestIssue>> map = new HashMap<>();
        for (Idea i : list) {
            map.put(i.getId(), testIssuesFor(i.getId()));
        }
        return map;
    }

    @Transactional
    public TestIssue addTestIssue(
            Long ideaId,
            String author,
            String role,
            String message,
            org.springframework.web.multipart.MultipartFile attachment
    ) throws java.io.IOException {
        if (message == null || message.isBlank()) {
            throw new IllegalArgumentException("Опишите ошибку или замечание");
        }
        Idea idea = ideas.findById(ideaId).orElseThrow();
        TestIssue issue = new TestIssue();
        issue.setIdea(idea);
        issue.setAuthor(author == null || author.isBlank() ? "Аноним" : author.trim());
        issue.setRole(role == null || role.isBlank() ? "Тестировщик" : role.trim());
        issue.setMessage(message.trim());
        UploadService.StoredFile stored = uploads.store(attachment);
        if (stored != null) {
            issue.setAttachmentStoredName(stored.storedName());
            issue.setAttachmentOriginalName(stored.originalName());
            issue.setAttachmentContentType(stored.contentType());
        }
        return testIssues.save(issue);
    }

    @Transactional
    public TestIssue setTestIssueStatus(Long issueId, TestIssueStatus status) {
        TestIssue issue = testIssues.findById(issueId).orElseThrow();
        issue.setStatus(status);
        return testIssues.save(issue);
    }

    public double avgRating(Long ideaId) {
        Double avg = ratings.averageForIdea(ideaId);
        return avg == null ? 0 : Math.round(avg * 10.0) / 10.0;
    }

    public long ratingCount(Long ideaId) {
        return ratings.countByIdeaId(ideaId);
    }

    public Map<Long, Double> ratingMap(List<Idea> list) {
        Map<Long, Double> map = new HashMap<>();
        for (Idea i : list) {
            map.put(i.getId(), avgRating(i.getId()));
        }
        return map;
    }

    public Map<Long, Long> ratingCountMap(List<Idea> list) {
        Map<Long, Long> map = new HashMap<>();
        for (Idea i : list) {
            map.put(i.getId(), ratingCount(i.getId()));
        }
        return map;
    }

    @Transactional
    public IdeaRating rate(Long ideaId, String voter, int score) {
        if (score < 1 || score > 5) {
            throw new IllegalArgumentException("Оценка должна быть от 1 до 5");
        }
        Idea idea = ideas.findById(ideaId).orElseThrow();
        IdeaRating rating = ratings.findByIdeaIdAndVoterName(ideaId, voter)
                .orElseGet(IdeaRating::new);
        rating.setIdea(idea);
        rating.setVoterName(voter);
        rating.setScore(score);
        return ratings.save(rating);
    }

    @Transactional
    public boolean toggleFavorite(Long ideaId, String user) {
        var existing = favorites.findByIdeaIdAndUserName(ideaId, user);
        if (existing.isPresent()) {
            favorites.delete(existing.get());
            return false;
        }
        Favorite f = new Favorite();
        f.setIdea(ideas.findById(ideaId).orElseThrow());
        f.setUserName(user);
        favorites.save(f);
        return true;
    }

    @Transactional(readOnly = true)
    public List<Idea> favoritesOf(String user) {
        return favorites.findByUserNameOrderByCreatedAtDesc(user).stream()
                .map(Favorite::getIdea)
                .toList();
    }

    public boolean isFavorite(Long ideaId, String user) {
        return favorites.existsByIdeaIdAndUserName(ideaId, user);
    }

    public Optional<NewsItem> newsOfTheDay() {
        return news.findFirstByOrderByPinnedDescNewsDateDescCreatedAtDesc();
    }

    public List<NewsItem> allNews() {
        return news.findAllByOrderByPinnedDescNewsDateDescCreatedAtDesc();
    }

    @Transactional
    public NewsItem saveNews(NewsItem item) {
        return news.save(item);
    }

    public List<ApplicationRequest> allApplications() {
        return applications.findAllByOrderByCreatedAtDesc();
    }

    public List<ApplicationRequest> applicationsByApplicant(String applicant) {
        if (applicant == null || applicant.isBlank()) {
            return List.of();
        }
        String key = applicant.trim().toLowerCase();
        return applications.findAllByOrderByCreatedAtDesc().stream()
                .filter(a -> a.getApplicant() != null && a.getApplicant().toLowerCase().contains(key))
                .toList();
    }

    @Transactional
    public ApplicationRequest submitApplication(ApplicationRequest req) {
        req.setStatus(ApplicationStatus.NEW);
        return applications.save(req);
    }

    @Transactional
    public ApplicationRequest feedback(Long id, ApplicationStatus status, String feedback) {
        ApplicationRequest req = applications.findById(id).orElseThrow();
        req.setStatus(status);
        req.setFeedback(feedback);
        req.setReviewedAt(Instant.now());
        return applications.save(req);
    }

    public List<Team> allTeams() {
        return teams.findAllByOrderByCreatedAtDesc();
    }

    public Optional<Team> getTeam(Long id) {
        return teams.findById(id);
    }

    @Transactional
    public Team saveTeam(Team team) {
        return teams.save(team);
    }

    @Transactional
    public Team updateTeamMembers(Long id, String members) {
        Team team = teams.findById(id).orElseThrow();
        team.setMembers(members == null ? "" : members.trim());
        return teams.save(team);
    }

    public record IdeaLeader(Idea idea, double rating, long votes) {}
    public record PersonLeader(String name, long count) {}

    @Transactional(readOnly = true)
    public List<IdeaLeader> topIdeasByRating(int limit) {
        List<Idea> all = ideas.findAll();
        return all.stream()
                .map(i -> new IdeaLeader(i, avgRating(i.getId()), ratingCount(i.getId())))
                .filter(r -> r.votes() > 0)
                .sorted(Comparator
                        .comparingDouble(IdeaLeader::rating).reversed()
                        .thenComparingLong(IdeaLeader::votes).reversed()
                        .thenComparing(r -> r.idea().getTitle(), Comparator.nullsLast(String::compareToIgnoreCase)))
                .limit(Math.max(limit, 1))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<PersonLeader> topAuthors(int limit) {
        Map<String, Long> counts = new HashMap<>();
        for (Idea idea : ideas.findAll()) {
            String name = normalizePerson(idea.getAuthor());
            if (name == null) continue;
            counts.merge(name, 1L, Long::sum);
        }
        return toPersonLeaders(counts, limit);
    }

    @Transactional(readOnly = true)
    public List<PersonLeader> topDevelopers(int limit) {
        Map<String, Long> counts = new HashMap<>();
        for (Idea idea : ideas.findAll()) {
            ProtoStatus status = idea.getProtoStatus();
            if (status != ProtoStatus.SEARCHING_DEVELOPER
                    && status != ProtoStatus.IN_PROGRESS
                    && status != ProtoStatus.DONE) {
                continue;
            }
            String primary = normalizePerson(idea.getProtoResponsible());
            if (primary != null) {
                counts.merge(primary, 1L, Long::sum);
                continue;
            }
            for (String part : splitPeople(idea.getProtoAuthors())) {
                counts.merge(part, 1L, Long::sum);
            }
        }
        return toPersonLeaders(counts, limit);
    }

    private List<PersonLeader> toPersonLeaders(Map<String, Long> counts, int limit) {
        return counts.entrySet().stream()
                .map(e -> new PersonLeader(e.getKey(), e.getValue()))
                .sorted(Comparator
                        .comparingLong(PersonLeader::count).reversed()
                        .thenComparing(PersonLeader::name, String.CASE_INSENSITIVE_ORDER))
                .limit(Math.max(limit, 1))
                .toList();
    }

    private static String normalizePerson(String raw) {
        if (raw == null) return null;
        String name = raw.trim().replaceAll("\\s+", " ");
        if (name.isEmpty() || "—".equals(name) || "не назначен".equalsIgnoreCase(name)) {
            return null;
        }
        return name;
    }

    private static List<String> splitPeople(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        java.util.ArrayList<String> out = new java.util.ArrayList<>();
        for (String part : raw.split("[,;/]|\\s+и\\s+")) {
            String name = normalizePerson(part);
            if (name != null) out.add(name);
        }
        return out;
    }
}
