package ru.upgrade.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(
        name = "activity_events",
        indexes = {
                @Index(name = "idx_activity_at", columnList = "occurredAt"),
                @Index(name = "idx_activity_action", columnList = "action"),
                @Index(name = "idx_activity_actor", columnList = "actorLogin")
        }
)
public class ActivityEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Instant occurredAt = Instant.now();

    @Column(length = 80)
    private String actorLogin;

    @Column(length = 160)
    private String actorName;

    @Column(length = 64)
    private String actorRole;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private ActivityAction action;

    @Column(length = 8)
    private String method;

    @Column(length = 400)
    private String path;

    private Long ideaId;

    @Column(length = 240)
    private String ideaTitle;

    @Column(length = 500)
    private String detail;

    public Long getId() { return id; }
    public Instant getOccurredAt() { return occurredAt; }
    public void setOccurredAt(Instant occurredAt) { this.occurredAt = occurredAt; }
    public String getActorLogin() { return actorLogin; }
    public void setActorLogin(String actorLogin) { this.actorLogin = actorLogin; }
    public String getActorName() { return actorName; }
    public void setActorName(String actorName) { this.actorName = actorName; }
    public String getActorRole() { return actorRole; }
    public void setActorRole(String actorRole) { this.actorRole = actorRole; }
    public ActivityAction getAction() { return action; }
    public void setAction(ActivityAction action) { this.action = action; }
    public String getMethod() { return method; }
    public void setMethod(String method) { this.method = method; }
    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    public Long getIdeaId() { return ideaId; }
    public void setIdeaId(Long ideaId) { this.ideaId = ideaId; }
    public String getIdeaTitle() { return ideaTitle; }
    public void setIdeaTitle(String ideaTitle) { this.ideaTitle = ideaTitle; }
    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }
}
