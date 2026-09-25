package ru.upgrade.domain;

public enum StageStatus {
    DONE("пройден"),
    CURRENT("текущий"),
    UPCOMING("предстоит");

    private final String label;

    StageStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
