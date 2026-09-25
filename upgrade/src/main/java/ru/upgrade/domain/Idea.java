package ru.upgrade.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "ideas")
public class Idea {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 240)
    private String title;

    @Column(nullable = false, length = 240)
    private String author;

    @Column(length = 4000)
    private String description;

    @Column(length = 2000)
    private String expectedEffect;

    @Column(length = 120)
    private String targetPlatform;

    @Column(length = 1000)
    private String forWhom;

    @Column(length = 1000)
    private String howToUse;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ProtoStatus protoStatus = ProtoStatus.NOT_PLANNED;

    @Column(length = 240)
    private String protoResponsible;

    @Column(length = 500)
    private String protoAuthors;

    @Column(length = 1000)
    private String protoLink;

    private boolean protoIsDownload;

    private boolean backlogTaken;

    @Column(length = 240)
    private String backlogTeam;

    private boolean implemented;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
            name = "idea_direction_tags",
            joinColumns = @JoinColumn(name = "idea_id"),
            inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    @OrderBy("name ASC")
    private java.util.Set<DirectionTag> tags = new java.util.LinkedHashSet<>();

    @OneToMany(mappedBy = "idea", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<IdeaStage> stages = new ArrayList<>();

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public void replaceStages(List<IdeaStage> next) {
        stages.clear();
        if (next == null) {
            return;
        }
        for (IdeaStage stage : next) {
            stage.setIdea(this);
            stages.add(stage);
        }
    }

    public IdeaStage currentStage() {
        return stages.stream()
                .filter(s -> s.getStatus() == StageStatus.CURRENT)
                .findFirst()
                .orElse(null);
    }

    public int doneStagesCount() {
        return (int) stages.stream().filter(s -> s.getStatus() == StageStatus.DONE).count();
    }

    public int stageProgressPercent() {
        if (implemented) {
            return 100;
        }
        if (stages == null || stages.isEmpty()) {
            return 0;
        }
        return (int) Math.round(100.0 * doneStagesCount() / stages.size());
    }

    /** Кнопка «Помочь»: только на этапе поиска разработчика без ответственного. */
    public boolean canTakeIntoWork() {
        if (implemented || backlogTaken) {
            return false;
        }
        if (protoStatus != ProtoStatus.SEARCHING_DEVELOPER) {
            return false;
        }
        return protoResponsible == null || protoResponsible.isBlank();
    }

    /** Оценка завершена — можно открыть поиск разработчика. */
    public boolean canOpenDeveloperSearch() {
        if (implemented || backlogTaken) {
            return false;
        }
        return protoStatus == ProtoStatus.NOT_PLANNED;
    }

    /** Пилот пройден — передать в профильный бэклог. */
    public boolean canSendToBacklog() {
        if (implemented || backlogTaken) {
            return false;
        }
        return protoStatus == ProtoStatus.DONE;
    }

    /** Идея в бэклоге — отметить внедрённой. */
    public boolean canMarkImplemented() {
        return backlogTaken && !implemented;
    }

    public boolean hasPrototype() {
        return protoLink != null && !protoLink.isBlank();
    }

    /** Локальный HTML-прототип для совместного скачивания с JSON. */
    public boolean hasDownloadablePrototypeHtml() {
        String link = protoLink;
        if (link == null || link.isBlank()) {
            return false;
        }
        String path = link.trim().toLowerCase();
        return path.startsWith("/uploads/") && (path.endsWith(".html") || path.endsWith(".htm"));
    }

    /** Прототип развёрнут как сайт по внешней ссылке. */
    public boolean hasExternalPrototype() {
        if (!hasPrototype()) {
            return false;
        }
        String path = protoLink.trim().toLowerCase();
        return path.startsWith("http://") || path.startsWith("https://");
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getAuthor() { return author; }
    public void setAuthor(String author) { this.author = author; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getExpectedEffect() { return expectedEffect; }
    public void setExpectedEffect(String expectedEffect) { this.expectedEffect = expectedEffect; }
    public String getTargetPlatform() { return targetPlatform; }
    public void setTargetPlatform(String targetPlatform) { this.targetPlatform = targetPlatform; }
    public String getForWhom() { return forWhom; }
    public void setForWhom(String forWhom) { this.forWhom = forWhom; }
    public String getHowToUse() { return howToUse; }
    public void setHowToUse(String howToUse) { this.howToUse = howToUse; }
    public ProtoStatus getProtoStatus() { return protoStatus; }
    public void setProtoStatus(ProtoStatus protoStatus) { this.protoStatus = protoStatus; }
    public String getProtoResponsible() { return protoResponsible; }
    public void setProtoResponsible(String protoResponsible) { this.protoResponsible = protoResponsible; }
    public String getProtoAuthors() { return protoAuthors; }
    public void setProtoAuthors(String protoAuthors) { this.protoAuthors = protoAuthors; }
    public String getProtoLink() { return protoLink; }
    public void setProtoLink(String protoLink) { this.protoLink = protoLink; }
    public boolean isProtoIsDownload() { return protoIsDownload; }
    public void setProtoIsDownload(boolean protoIsDownload) { this.protoIsDownload = protoIsDownload; }
    public boolean isBacklogTaken() { return backlogTaken; }
    public void setBacklogTaken(boolean backlogTaken) { this.backlogTaken = backlogTaken; }
    public String getBacklogTeam() { return backlogTeam; }
    public void setBacklogTeam(String backlogTeam) { this.backlogTeam = backlogTeam; }
    public boolean isImplemented() { return implemented; }
    public void setImplemented(boolean implemented) { this.implemented = implemented; }
    public java.util.Set<DirectionTag> getTags() { return tags; }
    public void setTags(java.util.Set<DirectionTag> tags) { this.tags = tags; }
    public List<IdeaStage> getStages() { return stages; }
    public void setStages(List<IdeaStage> stages) { this.stages = stages; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
