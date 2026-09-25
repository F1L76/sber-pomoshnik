package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.upgrade.domain.TestIssue;

import java.util.List;

public interface TestIssueRepository extends JpaRepository<TestIssue, Long> {
    List<TestIssue> findByIdeaIdOrderByCreatedAtDesc(Long ideaId);
    void deleteByIdeaId(Long ideaId);
}
