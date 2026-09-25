package ru.upgrade.domain;

public enum ProtoStatus {
    NOT_PLANNED("не предполагается"),
    SEARCHING_DEVELOPER("Поиск разработчика"),
    IN_PROGRESS("в разработке"),
    DONE("реализован");

    private final String label;

    ProtoStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
