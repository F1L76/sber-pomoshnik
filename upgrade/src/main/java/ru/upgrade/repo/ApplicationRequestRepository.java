package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.upgrade.domain.ApplicationRequest;

import java.util.List;

public interface ApplicationRequestRepository extends JpaRepository<ApplicationRequest, Long> {
    List<ApplicationRequest> findAllByOrderByCreatedAtDesc();
}
