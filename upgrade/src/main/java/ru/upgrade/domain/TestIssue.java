package ru.upgrade.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "test_issues")
public class TestIssue {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "idea_id", nullable = false)
    private Idea idea;

    @Column(nullable = false, length = 240)
    private String author;

    @Column(nullable = false, length = 32)
    private String role = "Тестировщик";

    @Column(nullable = false, length = 4000)
    private String message;

    @Column(length = 500)
    private String attachmentStoredName;

    @Column(length = 500)
    private String attachmentOriginalName;

    @Column(length = 120)
    private String attachmentContentType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private TestIssueStatus status = TestIssueStatus.OPEN;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Idea getIdea() { return idea; }
    public void setIdea(Idea idea) { this.idea = idea; }
    public String getAuthor() { return author; }
    public void setAuthor(String author) { this.author = author; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public String getAttachmentStoredName() { return attachmentStoredName; }
    public void setAttachmentStoredName(String attachmentStoredName) { this.attachmentStoredName = attachmentStoredName; }
    public String getAttachmentOriginalName() { return attachmentOriginalName; }
    public void setAttachmentOriginalName(String attachmentOriginalName) { this.attachmentOriginalName = attachmentOriginalName; }
    public String getAttachmentContentType() { return attachmentContentType; }
    public void setAttachmentContentType(String attachmentContentType) { this.attachmentContentType = attachmentContentType; }
    public TestIssueStatus getStatus() { return status; }
    public void setStatus(TestIssueStatus status) { this.status = status; }
    public Instant getCreatedAt() { return createdAt; }

    public boolean hasAttachment() {
        return attachmentStoredName != null && !attachmentStoredName.isBlank();
    }

    public boolean isImageAttachment() {
        return attachmentContentType != null && attachmentContentType.startsWith("image/");
    }

    public boolean isVideoAttachment() {
        return attachmentContentType != null && attachmentContentType.startsWith("video/");
    }
}
