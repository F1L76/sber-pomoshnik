"""Оценка качества распознавания строк перечня залога."""

from __future__ import annotations

import re
from typing import Any

from .asz_xlsx import parse_semicolon_description, should_skip_asz_row
from .utils import parse_number_cell

MIN_ACCEPT_SCORE = 45

_CONDITIONAL_RE = re.compile(
    r"^(?:[A-ZА-Я]{1,5}[_-]?\w+|\d+[_-]\w+|З-\d{1,4}|Объект_\d+)$",
    re.IGNORECASE,
)
_VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{11,17}$", re.IGNORECASE)
_CADASTRAL_RE = re.compile(r"^\d{2}:\d{2}:\d+:\d+$")


def _cell(row: list[Any], index: int) -> Any:
    if index < 0 or index >= len(row):
        return ""
    return row[index]


def score_asz_row(
    row: list[Any],
    col_map: dict[str, int],
    *,
    conditional: str = "",
    name: str = "",
    identifier: str = "",
    description: str = "",
    kind_path: str = "",
) -> tuple[int, list[str]]:
    """Возвращает (балл 0–100, список пояснений)."""
    if not description:
        description = str(_cell(row, col_map["description"]) or "").strip()
    if not kind_path:
        kind_path = str(_cell(row, col_map["kind_path"]) or "").strip()
    cost = parse_number_cell(_cell(row, col_map["cost"]))
    collateral = parse_number_cell(_cell(row, col_map["collateral"]))

    score = 0
    reasons: list[str] = []

    if cost > 0:
        score += 30
        reasons.append("есть оценочная стоимость")
    elif collateral > 0:
        score += 20
        reasons.append("есть залоговая стоимость")

    fields = parse_semicolon_description(description)
    if len(fields) >= 2:
        score += 25
        reasons.append(f"структурированное описание ({len(fields)} полей)")
    elif description and len(description) >= 15:
        score += 12
        reasons.append("есть текст описания")

    if conditional and _CONDITIONAL_RE.match(conditional.strip()):
        score += 20
        reasons.append("валидное условное обозначение")
    elif conditional and len(conditional) <= 25:
        score += 8

    if identifier:
        score += 15
        if _VIN_RE.match(identifier):
            reasons.append("VIN найден")
        elif _CADASTRAL_RE.match(identifier):
            reasons.append("кадастровый номер найден")
        else:
            reasons.append("идентификатор найден")

    if name and len(name) >= 10:
        score += 10
        reasons.append("сформировано краткое наименование")

    if any(word in kind_path.lower() for word in ("автомобил", "имуществен", "земель", "помещен")):
        score += 5

    if len(conditional) > 40:
        score -= 25
        reasons.append("слишком длинное условное обозначение")
    if cost <= 0 and collateral <= 0 and not description:
        score -= 35
        reasons.append("нет стоимости и описания")
    if "отсутствует" in kind_path.lower() and cost <= 0:
        score -= 40
        reasons.append("секция «отсутствует»")

    return max(0, min(100, score)), reasons


def score_simple_row(
    row: list[Any],
    col_map: dict[str, int],
    *,
    conditional: str = "",
    name: str = "",
    identifier: str = "",
    raw_name: str = "",
) -> tuple[int, list[str]]:
    cost = parse_number_cell(_cell(row, col_map["cost"]))
    collateral = parse_number_cell(_cell(row, col_map["collateral"]))

    score = 0
    reasons: list[str] = []

    if cost > 0:
        score += 30
        reasons.append("есть оценочная стоимость")
    elif collateral > 0:
        score += 20
        reasons.append("есть залоговая стоимость")

    probe = raw_name or name
    if probe and len(probe) >= 8:
        score += 25
        reasons.append("есть наименование")
    elif probe:
        score += 8

    if conditional and _CONDITIONAL_RE.match(conditional.strip()):
        score += 20
        reasons.append("валидное условное обозначение")

    if identifier:
        score += 15
        reasons.append("идентификатор найден")

    if name and len(name) >= 10:
        score += 10

    classifier = str(_cell(row, col_map["classifier"]) or "").strip()
    if classifier and classifier != "999.99":
        score += 5

    if not probe and not conditional:
        score -= 30
        reasons.append("пустая строка")

    return max(0, min(100, score)), reasons


def classify_score(score: int, *, hard_skip: bool = False) -> str:
    if hard_skip:
        return "skipped"
    if score >= MIN_ACCEPT_SCORE:
        return "accepted"
    if score >= 20:
        return "suspicious"
    return "skipped"


def skip_reason_asz(row: list[Any], col_map: dict[str, int]) -> str | None:
    if should_skip_asz_row(row, col_map):
        kind_path = str(_cell(row, col_map["kind_path"]) or "").strip()
        description = str(_cell(row, col_map["description"]) or "").strip()
        lower = kind_path.lower()
        if not kind_path and not description:
            return "пустая строка"
        if lower.startswith("итого"):
            return "строка «Итого»"
        if "перечень залогов к ко" in lower:
            return "заголовок перечня"
        if "отсутствует" in lower:
            return "секция без объектов"
        if parse_number_cell(_cell(row, col_map["cost"])) <= 0 and not description:
            return "нет стоимости и описания"
        return "служебная строка"
    return None
