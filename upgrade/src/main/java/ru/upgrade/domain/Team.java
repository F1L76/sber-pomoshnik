package ru.upgrade.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "teams")
public class Team {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(length = 2000)
    private String goal;

    @Column(length = 1000)
    private String members;

    @ManyToOne(fetch = FetchType.LAZY)
    private Idea relatedIdea;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getGoal() { return goal; }
    public void setGoal(String goal) { this.goal = goal; }
    public String getMembers() { return members; }
    public void setMembers(String members) { this.members = members; }
    public Idea getRelatedIdea() { return relatedIdea; }
    public void setRelatedIdea(Idea relatedIdea) { this.relatedIdea = relatedIdea; }
    public Instant getCreatedAt() { return createdAt; }
}
