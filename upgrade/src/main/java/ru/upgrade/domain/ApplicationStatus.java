package ru.upgrade.domain;

public enum ApplicationStatus {
    NEW("новая"),
    IN_REVIEW("на рассмотрении"),
    ACCEPTED("принята"),
    REJECTED("отклонена"),
    DONE("закрыта");

    private final String label;

    ApplicationStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
