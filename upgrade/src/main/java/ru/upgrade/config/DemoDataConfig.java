package ru.upgrade.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import ru.upgrade.domain.NewsItem;
import ru.upgrade.domain.ProtoStatus;
import ru.upgrade.domain.Team;
import ru.upgrade.repo.IdeaRepository;
import ru.upgrade.repo.NewsItemRepository;
import ru.upgrade.repo.TeamRepository;
import ru.upgrade.service.ActivityService;
import ru.upgrade.service.PlatformService;

import java.io.InputStream;
import java.time.LocalDate;
import java.util.List;

@Configuration
public class DemoDataConfig {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class BacklogIdeaDto {
        public String title;
        public String author;
        public String description;
        public String effect;
        public String protoStatus;
        public String protoResponsible;
        public String protoAuthors;
        public String protoLink;
        public boolean protoIsDownload;
        public String backlogTaken;
        public String backlogTeam;
        public String isImplemented;
    }

    @Bean
    CommandLineRunner seed(
            IdeaRepository ideas,
            NewsItemRepository news,
            TeamRepository teams,
            PlatformService platform,
            ActivityService activity,
            ObjectMapper mapper
    ) {
        return args -> {
            boolean needBacklog = ideas.findAll().stream()
                    .noneMatch(i -> "Верификация ФЖН".equals(i.getTitle()));

            if (needBacklog) {
                platform.clearAllIdeas();
                try (InputStream in = new ClassPathResource("data/backlog-ideas.json").getInputStream()) {
                    List<BacklogIdeaDto> rows = mapper.readValue(in, new TypeReference<>() {});
                    for (BacklogIdeaDto row : rows) {
                        platform.saveIdea(toIdea(row));
                    }
                }

                if (news.count() == 0) {
                    NewsItem n = new NewsItem();
                    n.setTitle("Старт платформы UpGrade");
                    n.setBody("Каталог инициатив загружен из бэклога ЦООП: этапы, оценки, избранное, заявки и команды.");
                    n.setNewsDate(LocalDate.now());
                    n.setPinned(true);
                    news.save(n);
                }

                if (teams.count() == 0) {
                    Team t = new Team();
                    t.setName("ЦООП · UpGrade");
                    t.setGoal("Развитие платформы идей и прототипов залоговой службы");
                    t.setMembers("Карпенко М., Завьялов Я., Мальков В., Богданов А.");
                    ideas.findAll().stream()
                            .filter(i -> "Идеи by ЦООП".equals(i.getTitle()))
                            .findFirst()
                            .ifPresent(t::setRelatedIdea);
                    teams.save(t);
                }
            }

            platform.ensureCatalogTags();
            platform.ensureStagesForAll();
            platform.seedMissingIdeaTags();
            activity.seedIfEmpty();
        };
    }

    private static ru.upgrade.domain.Idea toIdea(BacklogIdeaDto row) {
        ru.upgrade.domain.Idea idea = new ru.upgrade.domain.Idea();
        idea.setTitle(safe(row.title));
        idea.setAuthor(safe(row.author));
        idea.setDescription(row.description);
        idea.setExpectedEffect(row.effect);
        idea.setProtoStatus(mapProto(row.protoStatus));
        idea.setProtoResponsible(blankToNull(row.protoResponsible));
        idea.setProtoAuthors(blankToNull(row.protoAuthors));
        idea.setProtoLink(blankToNull(row.protoLink));
        idea.setProtoIsDownload(row.protoIsDownload);
        idea.setBacklogTaken(isYes(row.backlogTaken));
        idea.setBacklogTeam(blankToNull(row.backlogTeam));
        idea.setImplemented(isYes(row.isImplemented));
        return idea;
    }

    private static ProtoStatus mapProto(String raw) {
        if (raw == null) {
            return ProtoStatus.NOT_PLANNED;
        }
        return switch (raw.trim().toLowerCase()) {
            case "реализован" -> ProtoStatus.DONE;
            case "в разработке" -> ProtoStatus.IN_PROGRESS;
            case "поиск разработчика" -> ProtoStatus.SEARCHING_DEVELOPER;
            default -> ProtoStatus.NOT_PLANNED;
        };
    }

    private static boolean isYes(String value) {
        return value != null && value.trim().equalsIgnoreCase("да");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String safe(String value) {
        return value == null || value.isBlank() ? "Без названия" : value.trim();
    }
}
