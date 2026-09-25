package ru.upgrade.web;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import ru.upgrade.domain.*;
import ru.upgrade.service.PlatformService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ApiController {

    private final PlatformService platform;

    public ApiController(PlatformService platform) {
        this.platform = platform;
    }

    @GetMapping("/ideas")
    public List<Map<String, Object>> ideas(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) ProtoStatus proto,
            @RequestParam(required = false) Boolean implemented,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String sort
    ) {
        return platform.searchIdeas(q, proto, implemented, tag, IdeaSort.from(sort)).stream().map(this::ideaJson).toList();
    }

    @GetMapping("/ideas/{id}")
    public Map<String, Object> idea(@PathVariable Long id) {
        Idea idea = platform.getIdea(id).orElseThrow();
        Map<String, Object> m = ideaJson(idea);
        m.put("avgRating", platform.avgRating(id));
        m.put("votes", platform.ratingCount(id));
        m.put("testIssues", platform.testIssuesFor(id).stream().map(this::issueJson).toList());
        return m;
    }

    @PostMapping("/ideas/{id}/rate")
    public Map<String, Object> rate(
            @PathVariable Long id,
            @RequestParam String user,
            @RequestParam int score
    ) {
        platform.rate(id, user, score);
        return Map.of("ok", true, "avgRating", platform.avgRating(id), "votes", platform.ratingCount(id));
    }

    @PostMapping("/ideas/{id}/favorite")
    public Map<String, Object> favorite(@PathVariable Long id, @RequestParam String user) {
        boolean on = platform.toggleFavorite(id, user);
        return Map.of("ok", true, "favorite", on);
    }

    @GetMapping("/ideas/{id}/test-issues")
    public List<Map<String, Object>> testIssues(@PathVariable Long id) {
        return platform.testIssuesFor(id).stream().map(this::issueJson).toList();
    }

    @PostMapping("/ideas/{id}/test-issues")
    public Map<String, Object> addTestIssue(
            @PathVariable Long id,
            @RequestParam String author,
            @RequestParam(required = false, defaultValue = "Тестировщик") String role,
            @RequestParam String message,
            @RequestParam(required = false) MultipartFile attachment
    ) {
        try {
            TestIssue issue = platform.addTestIssue(id, author, role, message, attachment);
            return issueJson(issue);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Не удалось сохранить вложение");
        }
    }

    @PostMapping("/test-issues/{issueId}/status")
    public Map<String, Object> setIssueStatus(
            @PathVariable Long issueId,
            @RequestParam TestIssueStatus status
    ) {
        return issueJson(platform.setTestIssueStatus(issueId, status));
    }

    @GetMapping("/news/today")
    public Object newsToday() {
        return platform.newsOfTheDay().orElse(null);
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "UP", "app", "UpGrade");
    }

    private Map<String, Object> ideaJson(Idea i) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", i.getId());
        m.put("title", i.getTitle());
        m.put("author", i.getAuthor());
        m.put("description", i.getDescription());
        m.put("expectedEffect", i.getExpectedEffect());
        m.put("forWhom", i.getForWhom());
        m.put("howToUse", i.getHowToUse());
        m.put("protoStatus", i.getProtoStatus());
        m.put("backlogTaken", i.isBacklogTaken());
        m.put("backlogTeam", i.getBacklogTeam());
        m.put("implemented", i.isImplemented());
        m.put("tags", i.getTags().stream().map(DirectionTag::getName).sorted().toList());
        m.put("stages", i.getStages().stream().map(s -> {
            Map<String, Object> st = new LinkedHashMap<>();
            st.put("name", s.getName());
            st.put("responsible", s.getResponsible());
            st.put("description", s.getDescription());
            st.put("status", s.getStatus().name());
            st.put("sortOrder", s.getSortOrder());
            return st;
        }).toList());
        return m;
    }

    private Map<String, Object> issueJson(TestIssue issue) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", issue.getId());
        m.put("author", issue.getAuthor());
        m.put("role", issue.getRole());
        m.put("message", issue.getMessage());
        m.put("status", issue.getStatus().name());
        m.put("statusLabel", issue.getStatus().getLabel());
        m.put("createdAt", issue.getCreatedAt().toString());
        m.put("hasAttachment", issue.hasAttachment());
        m.put("attachmentUrl", issue.hasAttachment() ? "/uploads/" + issue.getAttachmentStoredName() : null);
        m.put("attachmentName", issue.getAttachmentOriginalName());
        m.put("attachmentContentType", issue.getAttachmentContentType());
        m.put("image", issue.isImageAttachment());
        m.put("video", issue.isVideoAttachment());
        return m;
    }
}
