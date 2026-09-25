package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ru.upgrade.domain.Favorite;

import java.util.List;
import java.util.Optional;

public interface FavoriteRepository extends JpaRepository<Favorite, Long> {
    Optional<Favorite> findByIdeaIdAndUserName(Long ideaId, String userName);

    @Query("select f from Favorite f join fetch f.idea where f.userName = :userName order by f.createdAt desc")
    List<Favorite> findByUserNameOrderByCreatedAtDesc(@Param("userName") String userName);

    boolean existsByIdeaIdAndUserName(Long ideaId, String userName);
    void deleteByIdeaId(Long ideaId);
}
