package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.upgrade.domain.Team;

import java.util.List;

public interface TeamRepository extends JpaRepository<Team, Long> {
    List<Team> findAllByOrderByCreatedAtDesc();
}
