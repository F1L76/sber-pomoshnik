package ru.upgrade.domain;

public enum TestIssueStatus {
    OPEN("открыто"),
    FIXED("исправлено");

    private final String label;

    TestIssueStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
