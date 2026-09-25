package ru.upgrade.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "idea_ratings", uniqueConstraints = @UniqueConstraint(columnNames = {"idea_id", "voterName"}))
public class IdeaRating {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    private Idea idea;

    @Column(nullable = false, length = 120)
    private String voterName;

    /** 1..5 */
    @Column(nullable = false)
    private int score;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public Idea getIdea() { return idea; }
    public void setIdea(Idea idea) { this.idea = idea; }
    public String getVoterName() { return voterName; }
    public void setVoterName(String voterName) { this.voterName = voterName; }
    public int getScore() { return score; }
    public void setScore(int score) { this.score = score; }
    public Instant getCreatedAt() { return createdAt; }
}
