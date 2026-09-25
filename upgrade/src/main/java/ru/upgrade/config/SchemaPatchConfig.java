package ru.upgrade.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * H2/Hibernate не расширяют CHECK-ограничения enum при ddl-auto=update.
 * Снимаем CHECK с PROTO_STATUS, чтобы новые значения ProtoStatus сохранялись.
 */
@Component
public class SchemaPatchConfig implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaPatchConfig.class);
    private final JdbcTemplate jdbc;

    public SchemaPatchConfig(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            var names = jdbc.queryForList(
                    """
                    select constraint_name
                    from information_schema.table_constraints
                    where table_name = 'IDEAS'
                      and constraint_type = 'CHECK'
                    """,
                    String.class
            );
            for (String name : names) {
                if (name == null || name.isBlank()) {
                    continue;
                }
                jdbc.execute("alter table ideas drop constraint " + name);
                log.info("Dropped CHECK constraint {} on ideas", name);
            }
            jdbc.execute("alter table ideas alter column proto_status varchar(32)");
        } catch (Exception ex) {
            log.warn("Schema patch for proto_status skipped: {}", ex.getMessage());
        }
    }
}
