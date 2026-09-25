package ru.upgrade.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "applications")
public class ApplicationRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 240)
    private String title;

    @Column(nullable = false, length = 120)
    private String applicant;

    @Column(length = 4000)
    private String description;

    @ManyToOne(fetch = FetchType.LAZY)
    private Idea relatedIdea;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ApplicationStatus status = ApplicationStatus.NEW;

    @Column(length = 4000)
    private String feedback;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    private Instant reviewedAt;

    public Long getId() { return id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getApplicant() { return applicant; }
    public void setApplicant(String applicant) { this.applicant = applicant; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public Idea getRelatedIdea() { return relatedIdea; }
    public void setRelatedIdea(Idea relatedIdea) { this.relatedIdea = relatedIdea; }
    public ApplicationStatus getStatus() { return status; }
    public void setStatus(ApplicationStatus status) { this.status = status; }
    public String getFeedback() { return feedback; }
    public void setFeedback(String feedback) { this.feedback = feedback; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getReviewedAt() { return reviewedAt; }
    public void setReviewedAt(Instant reviewedAt) { this.reviewedAt = reviewedAt; }
}
