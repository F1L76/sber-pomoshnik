package ru.upgrade.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ru.upgrade.domain.DirectionTag;

import java.util.List;
import java.util.Optional;

public interface DirectionTagRepository extends JpaRepository<DirectionTag, Long> {
    Optional<DirectionTag> findByNameIgnoreCase(String name);

    List<DirectionTag> findByCatalogTrueOrderByNameAsc();

    @Query("""
        select t.name, count(i.id)
        from DirectionTag t
        left join t.ideas i
        group by t.id, t.name
        order by count(i.id) desc, t.name asc
        """)
    List<Object[]> popularity();
}
