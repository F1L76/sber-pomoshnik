package ru.upgrade.domain;

import jakarta.persistence.*;

@Entity
@Table(name = "idea_stages")
public class IdeaStage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "idea_id", nullable = false)
    private Idea idea;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(length = 240)
    private String responsible;

    @Column(length = 500)
    private String description;

    @Column(nullable = false)
    private int sortOrder;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private StageStatus status = StageStatus.UPCOMING;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Idea getIdea() { return idea; }
    public void setIdea(Idea idea) { this.idea = idea; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getResponsible() { return responsible; }
    public void setResponsible(String responsible) { this.responsible = responsible; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public int getSortOrder() { return sortOrder; }
    public void setSortOrder(int sortOrder) { this.sortOrder = sortOrder; }
    public StageStatus getStatus() { return status; }
    public void setStatus(StageStatus status) { this.status = status; }
}
