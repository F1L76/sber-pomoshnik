"""Общие утилиты: классификатор, форматирование, парсинг чисел."""

from __future__ import annotations

import html
import re
from typing import Any


IMPORT_NAME_MIN_LEN = 3


def escape_html(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def format_money(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "0"
    if number != number:  # NaN
        return "0"
    formatted = f"{number:,.2f}".replace(",", " ").replace(".", ",")
    if formatted.endswith(",00"):
        formatted = formatted[:-3]
    return formatted


def calc_collateral_from_discount(estimated_cost: float, discount_pct: float) -> float:
    if estimated_cost <= 0:
        return 0.0
    if discount_pct <= 0:
        return round(estimated_cost)
    if discount_pct >= 100:
        return 0.0
    return round(estimated_cost * (1 - discount_pct / 100))


def parse_number_cell(raw: Any) -> float:
    text = str(raw or "").strip()
    if not text:
        return 0.0
    cleaned = re.sub(r"[^\d,.-]", "", text).replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def get_classifier_code_3_level(classifier_text: str) -> str:
    lower = str(classifier_text or "").lower()
    if "легковой автомобиль" in lower or "легковой" in lower:
        return "310.01"
    if "грузовой автомобиль" in lower or "грузовой" in lower:
        return "310.02"
    if "квартира" in lower or "жилое помещение" in lower:
        return "101.01"
    if "коммерческое помещение" in lower or "офис" in lower:
        return "102.03"
    if "земельный участок" in lower:
        return "201.05"
    if "жилой дом" in lower:
        return "101.02"
    return "999.99"


def should_skip_xlsx_object_row(raw_name: str, display_name: str) -> bool:
    raw = str(raw_name or "").strip()
    display = str(display_name or "").strip()
    lower = display.lower()
    if re.match(r"^не\s*указано\.?$", lower):
        return True
    if lower in {"н/д", "нет", "без названия", "без названия."}:
        return True
    if re.match(r"^[-–—_.\s]+$", display):
        return True
    if not raw:
        return True
    if len(display) < IMPORT_NAME_MIN_LEN:
        return True
    return False


def is_xlsx_technical_row(
    row: list[Any],
    col_map: dict[str, int],
    classifier_code: str,
    raw_name_cell: str,
    conditional: str,
    estimated_cost: float,
) -> bool:
    row_text = " ".join(str(cell or "").strip() for cell in row).lower()
    name_lower = (raw_name_cell or "").strip().lower()
    # Шаблонная строка перечня: подписи полей без данных объекта (не путать с описанием в ячейке).
    if name_lower in {"вид обеспечения", "описание обеспечения", "местонахождение обеспечения"}:
        return True
    if (
        "вид обеспечения" in row_text
        and "описание обеспечения" in row_text
        and "местонахождение обеспечения" in row_text
        and classifier_code == "999.99"
        and estimated_cost == 0
    ):
        return True
    if "местонахождение обеспечения" in row_text and (
        "999.99" in row_text or classifier_code == "999.99"
    ) and estimated_cost == 0:
        return True
    labels = [
        "вид обеспечения",
        "описание обеспечения",
        "местонахождение обеспечения",
        "категория качества",
    ]
    name_probe = (raw_name_cell or conditional or "").strip().lower()
    if any(name_probe == label or name_probe.startswith(label + " ") for label in labels):
        return True
    classifier_cell = str(row[col_map["classifier"]] if col_map["classifier"] < len(row) else "").strip()
    if classifier_cell == "999.99" and re.search(
        r"вид обеспечения|описание обеспечения|местонахождение", row_text, re.I
    ):
        return True
    if classifier_code == "999.99" and estimated_cost == 0 and re.search(
        r"вид обеспечения|описание обеспечения", row_text, re.I
    ):
        return True
    return False
