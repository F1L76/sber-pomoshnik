package ru.upgrade.domain;

import jakarta.persistence.*;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "direction_tags", uniqueConstraints = @UniqueConstraint(columnNames = "name"))
public class DirectionTag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    /** Тег из каталога направлений (предлагается автору). */
    private boolean catalog = true;

    @ManyToMany(mappedBy = "tags")
    private Set<Idea> ideas = new HashSet<>();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public boolean isCatalog() { return catalog; }
    public void setCatalog(boolean catalog) { this.catalog = catalog; }
    public Set<Idea> getIdeas() { return ideas; }
    public void setIdeas(Set<Idea> ideas) { this.ideas = ideas; }
}
