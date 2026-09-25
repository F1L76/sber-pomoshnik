package ru.upgrade.domain;

public enum IdeaSort {
    POPULARITY("По популярности"),
    RATING("По рейтингу"),
    VOTES("По числу оценок"),
    NEWEST("Сначала новые");

    private final String label;

    IdeaSort(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    public static IdeaSort from(String raw) {
        if (raw == null || raw.isBlank()) {
            return POPULARITY;
        }
        try {
            return IdeaSort.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return POPULARITY;
        }
    }
}
