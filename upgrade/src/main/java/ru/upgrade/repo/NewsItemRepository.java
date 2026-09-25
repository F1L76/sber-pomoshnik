package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.upgrade.domain.NewsItem;

import java.util.List;
import java.util.Optional;

public interface NewsItemRepository extends JpaRepository<NewsItem, Long> {
    Optional<NewsItem> findFirstByOrderByPinnedDescNewsDateDescCreatedAtDesc();
    List<NewsItem> findAllByOrderByPinnedDescNewsDateDescCreatedAtDesc();
}
