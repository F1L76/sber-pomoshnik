package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ru.upgrade.domain.Idea;
import ru.upgrade.domain.ProtoStatus;

import java.util.List;

public interface IdeaRepository extends JpaRepository<Idea, Long> {

    @Query("""
        select distinct i from Idea i
        left join i.tags t
        where (:q is null or lower(i.title) like lower(concat('%', :q, '%'))
            or lower(i.author) like lower(concat('%', :q, '%'))
            or lower(i.description) like lower(concat('%', :q, '%')))
          and (:proto is null or i.protoStatus = :proto)
          and (:implemented is null or i.implemented = :implemented)
          and (:tag is null or lower(t.name) = lower(:tag))
        order by i.updatedAt desc
        """)
    List<Idea> search(
            @Param("q") String q,
            @Param("proto") ProtoStatus proto,
            @Param("implemented") Boolean implemented,
            @Param("tag") String tag
    );
}
