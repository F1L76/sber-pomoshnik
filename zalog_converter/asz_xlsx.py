"""Парсинг перечня залогов в формате ASZ (КО / Excel из сопровождения)."""

from __future__ import annotations

import re
from typing import Any

from .name_format import format_object_report_name, truncate_land_plot_display_name
from .utils import get_classifier_code_3_level, parse_number_cell

_ASZ_HEADER_MARKERS = ("вид обеспечения", "описание обеспечения", "залогодатель")


def is_asz_header_row(row: list[Any]) -> bool:
    text = " ".join(str(cell or "").lower() for cell in row)
    return all(marker in text for marker in _ASZ_HEADER_MARKERS)


def find_asz_header_row(rows: list[list[Any]]) -> int | None:
    for index, row in enumerate(rows[:40]):
        if is_asz_header_row(row):
            return index
    return None


def build_asz_col_map(header_row: list[Any]) -> dict[str, int]:
    col_map = {
        "kind_path": -1,
        "pledgor": -1,
        "description": -1,
        "location": -1,
        "cost": -1,
        "discount": -1,
        "collateral": -1,
        "quality": -1,
        "liquidity": -1,
        "conditional": -1,
        "classifier": -1,
        "name": -1,
        "identifier": -1,
    }
    for index, cell in enumerate(header_row):
        value = str(cell or "").lower().strip()
        if value.startswith("вид обеспечения"):
            col_map["kind_path"] = index
        elif "залогодатель" in value:
            col_map["pledgor"] = index
        elif "описание обеспечения" in value:
            col_map["description"] = index
        elif "местонахождение обеспечения" in value:
            col_map["location"] = index
        elif "оценочная стоимость" in value:
            col_map["cost"] = index
        elif "залоговый дисконт" in value or value.startswith("дисконт"):
            col_map["discount"] = index
        elif "залоговая стоимость" in value:
            col_map["collateral"] = index
        elif "категория качества" in value:
            col_map["quality"] = index
        elif "срок экспозиции" in value or "ликвидность" in value and "ликвидацион" not in value:
            col_map["liquidity"] = index

    if col_map["liquidity"] < 0:
        col_map["liquidity"] = 11  # ponytail: столбец L

    col_map["conditional"] = col_map["kind_path"]
    col_map["classifier"] = col_map["kind_path"]
    col_map["name"] = col_map["description"]
    return col_map


def _cell(row: list[Any], index: int) -> Any:
    if index < 0 or index >= len(row):
        return ""
    return row[index]


def parse_semicolon_description(text: str) -> dict[str, str]:
    """Поля вида «Ключ: значение», разделённые «;» (формат ASZ в колонке описания)."""
    fields: dict[str, str] = {}
    for part in str(text or "").split(";"):
        chunk = part.strip()
        if not chunk:
            continue
        if ":" in chunk:
            key, _, value = chunk.partition(":")
            key_norm = re.sub(r"\s+", " ", key.strip().lower())
            value = value.strip()
            if key_norm and value and value.lower() not in {"н/д", "не указано"}:
                fields[key_norm] = value
        elif "kind" not in fields:
            fields["kind"] = chunk.lower()
    return fields


_IDENTIFIER_TYPE_VALUE_RE = re.compile(
    r"тип\s+идентификатора\s*:\s*[^:;]+:\s*([^;]+)",
    re.IGNORECASE,
)
_CADASTRAL_NUMBER_RE = re.compile(
    r"кадастровый\s+номер\s*:\s*([^;]+)",
    re.IGNORECASE,
)
_INVENTORY_NUMBER_RE = re.compile(
    r"инвентарный\s+номер\s*:\s*([^;]+)",
    re.IGNORECASE,
)


def _extract_identifier_after_type_colons(text: str) -> str:
    """Значение после второго «:» в фрагменте «Тип идентификатора: <тип>: <значение>»."""
    match = _IDENTIFIER_TYPE_VALUE_RE.search(str(text or ""))
    if not match:
        return ""
    value = match.group(1).strip()
    if not value or value.lower() in {"н/д", "не указано"}:
        return ""
    if re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", value.upper()):
        return value.upper()
    return value


def _extract_cadastral_number(text: str) -> str:
    """Кадастровый номер недвижимости: после «Кадастровый номер:» до «;»."""
    match = _CADASTRAL_NUMBER_RE.search(str(text or ""))
    if not match:
        return ""
    value = match.group(1).strip()
    if not value or value.lower() in {"н/д", "не указано"}:
        return ""
    return value


def _extract_inventory_number(text: str) -> str:
    """Инвентарный номер: после «Инвентарный номер:» до «;» (МиО и др.)."""
    match = _INVENTORY_NUMBER_RE.search(str(text or ""))
    if not match:
        return ""
    value = match.group(1).strip()
    if not value or value.lower() in {"н/д", "не указано"}:
        return ""
    return value


def _primary_identifier_marked_nd(text: str) -> bool:
    """В ячейке явно указано н/д для основного идентификатора."""
    raw = str(text or "")
    patterns = (
        r"тип\s+идентификатора\s*:\s*н/д",
        r"номер\s*:\s*н/д",
        r"тип\s+идентификатора\s*:[^:;]+:\s*н/д",
    )
    return any(re.search(pattern, raw, re.IGNORECASE) for pattern in patterns)


_CONDITIONAL_TOKEN_RE = re.compile(
    r"^[A-ZА-Я]{1,5}[_-]?\w+$|^[A-ZА-Я]{1,5}_\w+$|^\d+[_-]\w+$|^З-\d{1,4}$",
    re.IGNORECASE,
)
_CLASSIFIER_CODE_RE = re.compile(r"^(\d{3}\.\d{2}|\d{6})$")


def extract_conditional_from_kind_path(kind_path_cell: str) -> str:
    text = str(kind_path_cell or "").strip()
    if not text:
        return ""
    if "|" in text:
        return text.split("|")[-1].strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) >= 2:
        return lines[-1]
    if "/" in text:
        last_segment = text.split("/")[-1].strip()
        if _CONDITIONAL_TOKEN_RE.match(last_segment):
            return last_segment
    match = re.search(r"\b([A-ZА-Я]{1,5}[_-]?\w+)\b", text)
    if match and len(match.group(1)) <= 20:
        return match.group(1)
    return lines[0][:40] if lines else text[:40]


def _path_line_before_conditional(kind_path_cell: str, conditional: str) -> str:
    text = str(kind_path_cell or "").strip()
    if not text:
        return ""
    if "|" in text:
        return text.split("|")[0].strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) >= 2:
        return lines[0]
    if conditional and text.endswith(conditional):
        return text[: -len(conditional)].rstrip("/| ").strip()
    if "/" in text:
        parts = [part.strip() for part in text.split("/") if part.strip()]
        if parts and conditional and parts[-1] == conditional:
            parts = parts[:-1]
        if parts:
            return "/".join(parts)
    return text


def extract_classifier_from_kind_path(kind_path_cell: str) -> tuple[str, str]:
    """
    Классификатор из столбца A: значение после последнего «/» в пути
    (между иерархией и условным обозначением объекта).
    Возвращает (текст для отображения, код 3-го уровня).
    """
    text = str(kind_path_cell or "").strip()
    if not text:
        return "", "999.99"

    conditional = extract_conditional_from_kind_path(text)
    path_line = _path_line_before_conditional(text, conditional)

    if "/" in path_line:
        classifier_text = path_line.split("/")[-1].strip()
    else:
        classifier_text = re.sub(r"^\d+(?:\.\d+)?\s+", "", path_line).strip()

    if not classifier_text:
        classifier_text = path_line.strip()

    normalized = classifier_text.replace(" ", "")
    code_match = _CLASSIFIER_CODE_RE.match(normalized)
    if code_match:
        raw_code = code_match.group(1)
        if "." not in raw_code and len(raw_code) == 6:
            code = f"{raw_code[:3]}.{raw_code[3:]}"
        else:
            code = raw_code
        return classifier_text, code

    code = get_classifier_code_3_level(classifier_text)
    return classifier_text, code


def extract_kind_from_kind_path(kind_path_cell: str) -> str:
    classifier_text, _ = extract_classifier_from_kind_path(kind_path_cell)
    if classifier_text:
        return classifier_text.lower()
    first_line = str(kind_path_cell or "").splitlines()[0].strip()
    if "имущественные права" in first_line.lower():
        return "имущественные права"
    return first_line.lower()


def format_asz_display_name(kind_path_cell: str, description_cell: str) -> str:
    """Наименование — первая фраза в столбце C (описание) до «;»."""
    first = str(description_cell or "").split(";")[0].strip()
    if first:
        return truncate_land_plot_display_name(first)
    return truncate_land_plot_display_name(extract_kind_from_kind_path(kind_path_cell))


def should_skip_asz_row(row: list[Any], col_map: dict[str, int]) -> bool:
    kind_path = str(_cell(row, col_map["kind_path"]) or "").strip()
    description = str(_cell(row, col_map["description"]) or "").strip()
    cost = parse_number_cell(_cell(row, col_map["cost"]))
    lower = kind_path.lower()

    if not kind_path and not description:
        return True
    if lower.startswith("итого"):
        return True
    if "перечень залогов к ко" in lower:
        return True
    if lower.startswith("обеспечение, учитываемое"):
        return True
    if re.match(r"^\d+\.\s*(основное|комфортное|бланковое)\s*-?\s*отсутствует", lower):
        return True
    if re.match(r"^\d+\.\s*(основное|комфортное|бланковое)\s*$", lower):
        return True
    if "отсутствует" in lower and cost <= 0 and not description:
        return True
    if cost <= 0 and not description:
        return True
    return False


def _format_liquidity_cell(raw: Any) -> str:
    if raw is None or raw == "":
        return ""
    if isinstance(raw, float):
        if raw == int(raw):
            return str(int(raw))
        return str(raw).strip()
    return str(raw).strip()


def extract_liquidity(row: list[Any], col_map: dict[str, int]) -> str:
    """Ликвидность — значение ячейки столбца L (индекс 11), без связи с описанием в C."""
    return _format_liquidity_cell(_cell(row, col_map.get("liquidity", 11)))


def extract_identifier_from_asz_description(description_cell: str) -> str:
    from_type_colons = _extract_identifier_after_type_colons(description_cell)
    if from_type_colons:
        return from_type_colons

    from_cadastral = _extract_cadastral_number(description_cell)
    if from_cadastral:
        return from_cadastral

    fields = parse_semicolon_description(description_cell)
    cadastral = fields.get("кадастровый номер", "")
    if cadastral:
        return cadastral
    id_type = fields.get("тип идентификатора", "").lower()
    number = fields.get("номер", "")
    if number and ("vin" in id_type or re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", number.upper())):
        return number.upper()
    contract = fields.get("номер контракта/договора", "")
    if contract:
        return contract
    if number:
        return number.upper() if re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", number.upper()) else number

    inventory = fields.get("инвентарный номер", "") or _extract_inventory_number(description_cell)
    if inventory and (_primary_identifier_marked_nd(description_cell) or not number):
        return inventory
    return ""


def parse_asz_row(row: list[Any], col_map: dict[str, int], row_index: int) -> dict[str, Any] | None:
    if should_skip_asz_row(row, col_map):
        return None

    kind_path = str(_cell(row, col_map["kind_path"]) or "").strip()
    description = str(_cell(row, col_map["description"]) or "").strip()
    pledgor = str(_cell(row, col_map["pledgor"]) or "").strip()
    conditional = extract_conditional_from_kind_path(kind_path) or f"Объект_{row_index}"
    classifier_raw, classifier_code = extract_classifier_from_kind_path(kind_path)
    kind_label = classifier_raw.lower() if classifier_raw else extract_kind_from_kind_path(kind_path)
    if classifier_code == "999.99":
        classifier_code = get_classifier_code_3_level(description.split(";")[0])

    valuation_type = "Рыночная" if cost > 0 else "Льготная"
    cost_type = "рыночная" if cost > 0 else "льготная"
    name = format_object_report_name(
        description or kind_path,
        classifier_raw,
        classifier_code,
        identifier,
        liquidity=liquidity,
        valuation_type=valuation_type,
        cost_type=cost_type,
    )
    identifier = extract_identifier_from_asz_description(description)
    cost = parse_number_cell(_cell(row, col_map["cost"]))
    discount = parse_number_cell(_cell(row, col_map["discount"]))
    collateral = parse_number_cell(_cell(row, col_map["collateral"]))
    if collateral <= 0 and cost > 0:
        collateral = cost
    quality = str(_cell(row, col_map["quality"]) or "").strip() or "Стандарт"
    liquidity = extract_liquidity(row, col_map)

    return {
        "conditional": conditional,
        "klassifikator": classifier_code,
        "klassifikator_raw": classifier_raw or kind_path.splitlines()[0][:80],
        "name": name,
        "raw_name": description or kind_path,
        "identifier": identifier,
        "quality_category": quality,
        "valuation_type": "Рыночная" if cost > 0 else "Льготная",
        "cost": cost,
        "collateral_value": collateral,
        "discount": discount,
        "liquidity": liquidity,
        "cost_type": "рыночная" if cost > 0 else "льготная",
        "bank_market_price": round(cost * 1.05, 2) if cost > 0 else 0.0,
        "pledgor": pledgor,
    }
