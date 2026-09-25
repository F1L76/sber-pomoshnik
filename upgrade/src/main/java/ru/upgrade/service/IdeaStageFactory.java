package ru.upgrade.service;

import ru.upgrade.domain.*;

import java.util.ArrayList;
import java.util.List;

/**
 * Строит стандартный жизненный цикл инициативы.
 *
 * Подача → Оценка → Поиск разработчика → Разработка прототипа → Пилот
 * → Передача в профильный бэклог → Внедрено
 */
public final class IdeaStageFactory {

    public static final String STAGE_SUBMIT = "Подача";
    public static final String STAGE_EVAL = "Оценка";
    public static final String STAGE_SEARCH = "Поиск разработчика";
    public static final String STAGE_PROTO = "Разработка прототипа";
    public static final String STAGE_PILOT = "Пилот";
    public static final String STAGE_BACKLOG = "Передача в профильный бэклог";
    public static final String STAGE_DONE = "Внедрено";

    private IdeaStageFactory() {}

    public static List<IdeaStage> buildFor(Idea idea) {
        String author = blankTo(idea.getAuthor(), "—");
        String protoOwner = firstNonBlank(idea.getProtoResponsible(), idea.getProtoAuthors(), "не назначен");
        String implementer = firstNonBlank(idea.getBacklogTeam(), idea.getProtoAuthors(), idea.getAuthor(), "не назначен");
        String tester = firstNonBlank(idea.getProtoResponsible(), idea.getProtoAuthors(), "не назначен");

        boolean hasDeveloper = hasText(idea.getProtoResponsible());
        boolean protoDone = idea.getProtoStatus() == ProtoStatus.DONE;
        boolean backlog = idea.isBacklogTaken();
        boolean implemented = idea.isImplemented();
        ProtoStatus status = idea.getProtoStatus() == null ? ProtoStatus.NOT_PLANNED : idea.getProtoStatus();

        boolean searching = !implemented && !backlog && !protoDone
                && status == ProtoStatus.SEARCHING_DEVELOPER;
        boolean inProgress = !implemented && !backlog && !protoDone
                && status == ProtoStatus.IN_PROGRESS
                && hasDeveloper;

        StageStatus s2; // Оценка
        StageStatus s3; // Поиск разработчика
        StageStatus s4; // Разработка прототипа
        StageStatus s5; // Пилот
        StageStatus s6; // Передача в профильный бэклог
        StageStatus s7; // Внедрено

        if (implemented) {
            s2 = StageStatus.DONE;
            s3 = StageStatus.DONE;
            s4 = StageStatus.DONE;
            s5 = StageStatus.DONE;
            s6 = StageStatus.DONE;
            s7 = StageStatus.CURRENT;
        } else if (backlog) {
            s2 = StageStatus.DONE;
            s3 = StageStatus.DONE;
            s4 = StageStatus.DONE;
            s5 = StageStatus.DONE;
            s6 = StageStatus.CURRENT;
            s7 = StageStatus.UPCOMING;
        } else if (protoDone) {
            s2 = StageStatus.DONE;
            s3 = StageStatus.DONE;
            s4 = StageStatus.DONE;
            s5 = StageStatus.CURRENT;
            s6 = StageStatus.UPCOMING;
            s7 = StageStatus.UPCOMING;
        } else if (searching) {
            s2 = StageStatus.DONE;
            s3 = StageStatus.CURRENT;
            s4 = StageStatus.UPCOMING;
            s5 = StageStatus.UPCOMING;
            s6 = StageStatus.UPCOMING;
            s7 = StageStatus.UPCOMING;
        } else if (inProgress) {
            s2 = StageStatus.DONE;
            s3 = StageStatus.DONE;
            s4 = StageStatus.CURRENT;
            s5 = StageStatus.UPCOMING;
            s6 = StageStatus.UPCOMING;
            s7 = StageStatus.UPCOMING;
        } else {
            s2 = StageStatus.CURRENT;
            s3 = StageStatus.UPCOMING;
            s4 = StageStatus.UPCOMING;
            s5 = StageStatus.UPCOMING;
            s6 = StageStatus.UPCOMING;
            s7 = StageStatus.UPCOMING;
        }

        List<IdeaStage> stages = new ArrayList<>();
        stages.add(stage(idea, 1, STAGE_SUBMIT, author, StageStatus.DONE,
                "Идея оформлена и попала в каталог инициатив."));
        stages.add(stage(idea, 2, STAGE_EVAL, null, s2,
                "Две оценки: сообществом (★ 1–5) и авторская с раскрытием финансового эффекта."));
        stages.add(stage(idea, 3, STAGE_SEARCH,
                searching ? "не назначен" : protoOwner,
                s3,
                "Ищем разработчика, который возьмёт инициативу в работу и подготовит прототип. "
                        + "Нажмите «Помочь», чтобы стать ответственным."));
        stages.add(stage(idea, 4, STAGE_PROTO, protoOwner, s4,
                "Загрузите HTML-файл или укажите ссылку на развёрнутый сайт — инициатива перейдёт в пилот."));
        stages.add(stage(idea, 5, STAGE_PILOT, tester, s5,
                "Пилотное внедрение: проверка на реальных кейсах, сбор обратной связи и устранение замечаний."));
        stages.add(stage(idea, 6, STAGE_BACKLOG, implementer, s6,
                "Инициатива передаётся в профильный бэклог команды для промышленного внедрения."));
        stages.add(stage(idea, 7, STAGE_DONE, implementer, s7,
                "Решение внедрено и закрывает исходную потребность."));
        return stages;
    }

    /**
     * Синхронизирует protoStatus с наличием ответственного за разработку.
     * @return true, если статус изменился
     */
    public static boolean syncProtoStatus(Idea idea) {
        if (idea == null || idea.isImplemented() || idea.isBacklogTaken()) {
            return false;
        }
        ProtoStatus status = idea.getProtoStatus() == null ? ProtoStatus.NOT_PLANNED : idea.getProtoStatus();
        if (status == ProtoStatus.DONE || status == ProtoStatus.NOT_PLANNED) {
            return false;
        }
        boolean hasDeveloper = hasText(idea.getProtoResponsible());
        if (!hasDeveloper && status == ProtoStatus.IN_PROGRESS) {
            idea.setProtoStatus(ProtoStatus.SEARCHING_DEVELOPER);
            return true;
        }
        if (hasDeveloper && status == ProtoStatus.SEARCHING_DEVELOPER) {
            idea.setProtoStatus(ProtoStatus.IN_PROGRESS);
            return true;
        }
        return false;
    }

    private static IdeaStage stage(
            Idea idea, int order, String name, String responsible, StageStatus status, String description
    ) {
        IdeaStage s = new IdeaStage();
        s.setIdea(idea);
        s.setSortOrder(order);
        s.setName(name);
        s.setResponsible(responsible);
        s.setStatus(status);
        s.setDescription(description);
        return s;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static String blankTo(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return "не назначен";
    }
}
