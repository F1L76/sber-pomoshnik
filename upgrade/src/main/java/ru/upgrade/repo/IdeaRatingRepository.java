package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ru.upgrade.domain.IdeaRating;

import java.util.List;
import java.util.Optional;

public interface IdeaRatingRepository extends JpaRepository<IdeaRating, Long> {
    Optional<IdeaRating> findByIdeaIdAndVoterName(Long ideaId, String voterName);
    List<IdeaRating> findByIdeaId(Long ideaId);
    void deleteByIdeaId(Long ideaId);

    @Query("select avg(r.score) from IdeaRating r where r.idea.id = :ideaId")
    Double averageForIdea(@Param("ideaId") Long ideaId);

    long countByIdeaId(Long ideaId);
}
