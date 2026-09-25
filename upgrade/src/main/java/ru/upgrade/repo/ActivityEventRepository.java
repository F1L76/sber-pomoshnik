package ru.upgrade.repo;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.upgrade.domain.ActivityAction;
import ru.upgrade.domain.ActivityEvent;

import java.time.Instant;
import java.util.List;

public interface ActivityEventRepository extends JpaRepository<ActivityEvent, Long> {

    List<ActivityEvent> findByOccurredAtGreaterThanEqualOrderByOccurredAtDesc(Instant from, Pageable pageable);

    List<ActivityEvent> findByOccurredAtGreaterThanEqualAndActionOrderByOccurredAtDesc(
            Instant from, ActivityAction action, Pageable pageable);

    List<ActivityEvent> findByOccurredAtGreaterThanEqual(Instant from);

    long countByOccurredAtGreaterThanEqual(Instant from);

    long countByActionAndOccurredAtGreaterThanEqual(ActivityAction action, Instant from);
}
