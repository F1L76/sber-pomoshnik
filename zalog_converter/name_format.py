"""Формирование краткого понятного наименования объекта залога из ячейки XLSX."""

from __future__ import annotations

import re
from typing import Any

_LAND_PLOT_EXTRA_RE = re.compile(r"^земельный\s+участок(\s+|\s*,\s*).+", re.I)


def truncate_land_plot_display_name(name: str) -> str:
    """Если наименование начинается с «Земельный участок» и далее есть текст — только эта фраза."""
    text = str(name or "").strip()
    if _LAND_PLOT_EXTRA_RE.match(text):
        return "Земельный участок"
    return text

_LABEL_ALIASES: dict[str, str] = {
    "вид обеспечения": "kind",
    "описание обеспечения": "description",
    "местонахождение обеспечения": "location",
    "год выпуска": "year",
    "vin номер": "vin",
    "vin": "vin",
    "vin-код": "vin",
    "кадастровый номер": "cadastral",
    "площадь": "area",
    "марка": "brand",
    "модель": "model",
    "наименование": "description",
    "наименование объекта": "description",
    "категория качества": "quality",
}

_CODE_KIND_LABELS: dict[str, str] = {
    "310.01": "легковой автомобиль",
    "310.02": "грузовой автомобиль",
    "101.01": "квартира",
    "102.03": "коммерческое помещение",
    "101.02": "жилой дом",
    "201.05": "земельный участок",
}

_CLASSIFIER_CODE_RE = re.compile(r"^(\d{3}\.\d{2}|\d{6})$")

_STRUCTURED_MARKERS = re.compile(
    r"вид обеспечения|описание обеспечения|местонахождение обеспечения",
    re.I,
)

_KNOWN_LABELS = set(_LABEL_ALIASES.keys())


def _normalize_label(label: str) -> str:
    return re.sub(r"\s+", " ", label.strip().lower().rstrip(":"))


def _labels_regex() -> str:
    return "|".join(re.escape(key) for key in sorted(_LABEL_ALIASES, key=len, reverse=True))


def _is_known_label(text: str) -> bool:
    return _normalize_label(text) in _KNOWN_LABELS


def _split_segments(text: str) -> list[str]:
    return [segment.strip() for segment in re.split(r"[\n\t]+", text) if segment.strip()]


def merge_fields_from_alternating_segments(segments: list[str]) -> dict[str, str]:
    """Пары «метка / значение» в соседних ячейках или фрагментах строки."""
    fields: dict[str, str] = {}
    index = 0
    while index < len(segments):
        label_norm = _normalize_label(segments[index])
        if label_norm in _LABEL_ALIASES and index + 1 < len(segments):
            next_label = _normalize_label(segments[index + 1])
            if next_label not in _KNOWN_LABELS:
                key = _LABEL_ALIASES[label_norm]
                if key not in fields:
                    fields[key] = segments[index + 1].strip()
                index += 2
                continue
        index += 1
    return fields


def parse_labeled_fields(raw_text: str) -> dict[str, str]:
    """Извлекает пары «метка → значение» из ячейки или склеенного текста строки."""
    text = str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return {}

    fields: dict[str, str] = {}
    labels_re = _labels_regex()

    for match in re.finditer(rf"({labels_re})\s*[:：\-–—]\s*", text, re.I):
        key = _LABEL_ALIASES.get(_normalize_label(match.group(1)))
        if not key or key in fields:
            continue
        start = match.end()
        rest = text[start:]
        end_match = re.search(rf"\s*(?:{labels_re})\s*[:：\-–—]", rest, re.I)
        value = rest[: end_match.start()] if end_match else rest
        value = re.sub(r"[\n\t]+", " ", value).strip(" \t,;")
        if value:
            fields[key] = value

    for match in re.finditer(
        rf"({labels_re})\s+(.+?)(?=(?:\s+(?:{labels_re}))\s+|$)",
        re.sub(r"[\n\t]+", " ", text),
        re.I | re.S,
    ):
        key = _LABEL_ALIASES.get(_normalize_label(match.group(1)))
        if not key or key in fields:
            continue
        value = re.sub(r"\s+", " ", match.group(2)).strip(" \t,;")
        if value:
            fields[key] = value

    fields.update(merge_fields_from_alternating_segments(_split_segments(text)))
    return fields


def row_has_label_value_layout(segments: list[str]) -> bool:
    """Строка Excel, где в соседних ячейках идут метки полей (Вид обеспечения, Описание…)."""
    if not segments:
        return False
    if _is_known_label(segments[0]):
        return True
    return sum(1 for segment in segments if _is_known_label(segment)) >= 2


def collect_row_description_segments(row: list[Any], col_map: dict[str, int]) -> list[str]:
    """Ячейки строки между классификатором и стоимостью — только для layout метка/значение."""
    cost_index = col_map.get("cost", -1)
    if cost_index < 0:
        cost_index = len(row)
    start_index = col_map.get("classifier", 1)
    if start_index < 0:
        start_index = 1

    segments: list[str] = []
    for index in range(start_index, min(cost_index, len(row))):
        value = str(row[index] or "").strip()
        if value:
            segments.append(value)

    if not row_has_label_value_layout(segments):
        return []
    return segments


def merge_description_fields(
    raw_name: str,
    row_segments: list[str] | None = None,
) -> dict[str, str]:
    fields: dict[str, str] = {}
    for source in (raw_name, "\t".join(row_segments or [])):
        if not source:
            continue
        for key, value in parse_labeled_fields(source).items():
            fields.setdefault(key, value)
    if row_segments:
        for key, value in merge_fields_from_alternating_segments(row_segments).items():
            fields.setdefault(key, value)
    return fields


def _classifier_kind_label(classifier_raw: str, classifier_code: str, fields: dict[str, str]) -> str:
    if fields.get("kind"):
        return fields["kind"].strip().lower()
    if classifier_raw and not re.fullmatch(r"[\d.]+", classifier_raw.strip()):
        part = classifier_raw.split("/")[0].strip()
        if part and not _is_known_label(part):
            return part.lower()
    return _CODE_KIND_LABELS.get(classifier_code, "")


def _pick_description_from_segments(
    row_segments: list[str],
    kind: str,
    identifier: str,
) -> str:
    best = ""
    for segment in row_segments:
        text = segment.strip()
        if not text or _is_known_label(text):
            continue
        if kind and text.lower() == kind.lower():
            continue
        if identifier and text == identifier:
            continue
        if re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", text.upper()):
            continue
        if re.fullmatch(r"\d{2}:\d{2}:\d+:\d+", text):
            continue
        if len(text) > len(best):
            best = text
    return best


def _is_vehicle(classifier_code: str, kind: str) -> bool:
    if classifier_code in {"310.01", "310.02"}:
        return True
    return "автомобил" in kind or "транспорт" in kind


def _is_real_estate(classifier_code: str, kind: str) -> bool:
    if classifier_code.startswith(("101.", "102.", "201.")):
        return True
    return any(word in kind for word in ("квартир", "помещен", "участок", "дом", "здани", "офис"))


def _extract_year(value: str) -> str:
    match = re.search(r"\b(19|20)\d{2}\b", value)
    return match.group(0) if match else value.strip()


def _extract_vin(value: str) -> str:
    match = re.search(r"\b[A-HJ-NPR-Z0-9]{11,17}\b", value.upper())
    return match.group(0) if match else value.strip()


def _heuristic_fields(
    combined_text: str,
    classifier_raw: str,
    classifier_code: str,
    identifier: str,
) -> dict[str, str]:
    fields: dict[str, str] = {}
    kind = _classifier_kind_label(classifier_raw, classifier_code, {})
    if kind:
        fields["kind"] = kind

    vin = _extract_vin(combined_text) or _extract_vin(identifier)
    if len(vin) >= 11:
        fields["vin"] = vin

    year_match = re.search(r"год выпуска\s*[:：]?\s*((?:19|20)\d{2})", combined_text, re.I)
    if year_match:
        fields["year"] = year_match.group(1)

    cad_match = re.search(r"кадастровый номер\s*[:：]?\s*(\d{2}:\d{2}:\d+:\d+)", combined_text, re.I)
    if cad_match:
        fields["cadastral"] = cad_match.group(1)
    elif re.search(r"\d{2}:\d{2}:\d+:\d+", identifier):
        fields["cadastral"] = identifier

    desc_match = re.search(
        r"описание обеспечения\s*[:：]?\s*(.+?)(?=(?:вид обеспечения|местонахождение|год выпуска|vin|кадастровый|$))",
        combined_text,
        re.I | re.S,
    )
    if desc_match:
        fields["description"] = re.sub(r"\s+", " ", desc_match.group(1)).strip(" \t,;")

    return fields


def _clean_description_text(text: str) -> str:
    cleaned = re.sub(r"[\n\r\t]+", " ", str(text or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    # Убираем хвост с адресом/местонахождением, если он попал в описание.
    cleaned = re.split(
        r"(?i)\s*(?:местонахождение обеспечения|категория качества|вид стоимости)\s*[:：]?",
        cleaned,
        maxsplit=1,
    )[0].strip(" ,;")
    if len(cleaned) > 160:
        cleaned = cleaned[:157].rstrip() + "…"
    return cleaned


def _build_description(fields: dict[str, str], raw: str, kind: str) -> str:
    description = _clean_description_text(fields.get("description", ""))
    if not description:
        brand = fields.get("brand", "").strip()
        model = fields.get("model", "").strip()
        description = _clean_description_text(" ".join(part for part in (brand, model) if part))

    if description:
        return description

    for line in _split_segments(raw):
        if _is_known_label(line):
            continue
        if re.match(r"^(вид|описание|местонахождение)\s", line, re.I):
            continue
        if kind and line.lower() == kind:
            continue
        if re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", line.upper()):
            continue
        if re.fullmatch(r"\d{2}:\d{2}:\d+:\d+", line):
            continue
        return _clean_description_text(line)
    return ""


def _normalize_classifier_code(value: str) -> str:
    text = str(value or "").replace(" ", "").strip()
    if not text:
        return ""
    if _CLASSIFIER_CODE_RE.match(text):
        if "." in text:
            return text
        if len(text) == 6:
            return f"{text[:3]}.{text[3:]}"
    digits = re.sub(r"\D", "", text)
    if len(digits) == 6:
        return f"{digits[:3]}.{digits[3:]}"
    if len(digits) == 5:
        return f"{digits[:3]}.{digits[3:]}"
    return ""


def _is_classifier_code(value: str) -> bool:
    text = str(value or "").strip()
    if not text or text == "999.99":
        return True
    if _is_known_label(text):
        return False
    compact = text.replace(" ", "")
    if _CLASSIFIER_CODE_RE.match(compact):
        return True
    if re.fullmatch(r"\d{4,6}", compact):
        return True
    return False


def _label_from_code(value: str) -> str:
    normalized = _normalize_classifier_code(value)
    if normalized and normalized in _CODE_KIND_LABELS:
        label = _CODE_KIND_LABELS[normalized]
        return label[:1].upper() + label[1:] if label else ""
    return ""


def format_classifier_display(klassifikator_raw: str, klassifikator: str = "") -> str:
    """Наименование классификатора для отчёта — без кода (310.01, 10101 и т.п.)."""
    raw = str(klassifikator_raw or "").strip()
    code = str(klassifikator or "").strip()

    if raw and not _is_known_label(raw) and not _is_classifier_code(raw):
        return raw

    for candidate in (raw, code):
        label = _label_from_code(candidate)
        if label:
            return label

    if raw and not _is_classifier_code(raw):
        return raw

    return "—"


def resolve_kind_and_code(
    classifier_raw: str,
    classifier_code: str,
    fields: dict[str, str],
) -> tuple[str, str, str]:
    """Возвращает (kind_label, code, classifier_raw_for_display)."""
    from .utils import get_classifier_code_3_level

    kind = _classifier_kind_label(classifier_raw, classifier_code, fields)
    code = get_classifier_code_3_level(kind or classifier_raw)
    if code == "999.99" and classifier_code != "999.99":
        code = classifier_code
    display_raw = classifier_raw
    if _is_known_label(classifier_raw) and kind:
        display_raw = kind
    elif kind and (not classifier_raw or _is_known_label(classifier_raw)):
        display_raw = kind
    return kind, code, display_raw


def _parse_semicolon_fields(text: str) -> dict[str, str]:
    """Поля «ключ: значение» через «;» (формат ASZ в описании объекта)."""
    fields: dict[str, str] = {}
    raw = str(text or "").strip()
    if not raw:
        return fields
    first = raw.split(";")[0].strip()
    if first and ":" not in first:
        fields["_title"] = first
    for part in raw.split(";"):
        chunk = part.strip()
        if not chunk:
            continue
        if ":" in chunk:
            key, _, value = chunk.partition(":")
            key_norm = re.sub(r"\s+", " ", key.strip().lower())
            value = value.strip()
            if key_norm and value and value.lower() not in {"н/д", "не указано"}:
                fields[key_norm] = value
        elif "_title" not in fields:
            fields["_title"] = chunk
    return fields


def _merge_report_fields(raw_name: str, row_segments: list[str] | None) -> dict[str, str]:
    fields: dict[str, str] = {}
    for source in (raw_name, "\t".join(row_segments or [])):
        if not source:
            continue
        for key, value in _parse_semicolon_fields(source).items():
            fields.setdefault(key, value)
        for key, value in parse_labeled_fields(source).items():
            norm = re.sub(r"\s+", " ", key.strip().lower())
            fields.setdefault(norm, value)
        for key, value in merge_fields_from_alternating_segments(_split_segments(source)).items():
            norm = re.sub(r"\s+", " ", key.strip().lower())
            fields.setdefault(norm, value)
    return fields


def _report_field(fields: dict[str, str], *keys: str) -> str:
    for key in keys:
        norm = key.lower()
        if norm in fields:
            return str(fields[norm]).strip()
    for fk, fv in fields.items():
        if fk.startswith("_"):
            continue
        for key in keys:
            if key.lower() in fk:
                return str(fv).strip()
    return ""


def _object_type_label(classifier_raw: str, classifier_code: str, fields: dict[str, str]) -> str:
    display = format_classifier_display(classifier_raw, classifier_code)
    if display and display != "—":
        if "/" in display:
            return display.split("/")[-1].strip()
        return display
    kind = fields.get("_title") or fields.get("kind") or _classifier_kind_label(classifier_raw, classifier_code, fields)
    if kind:
        return kind[:1].upper() + kind[1:]
    return "Объект"


def _format_exposure_days(fields: dict[str, str], liquidity_cell: str) -> str:
    expo = _report_field(
        fields,
        "срок реализации",
        "срок реализации в днях",
        "срок экспозиции",
        "срок экспозиции в днях",
    )
    if expo:
        expo = re.sub(r"\s+", " ", expo).strip()
        if not re.search(r"дн\.?", expo, re.I):
            if re.fullmatch(r"\d+(?:[.,]\d+)?", expo):
                expo = f"{expo.replace(',', '.')} дн."
            else:
                expo = f"{expo} дн."
        return expo
    cell = str(liquidity_cell or "").strip()
    if cell and re.fullmatch(r"\d+(?:[.,]\d+)?", cell):
        return f"{cell.replace(',', '.')} дн."
    return ""


def _format_liquidity_label(fields: dict[str, str], liquidity_cell: str) -> str:
    label = _report_field(fields, "ликвидность")
    if label:
        return label.lower()
    cell = str(liquidity_cell or "").strip()
    if cell and not re.fullmatch(r"\d+(?:[.,]\d+)?", cell):
        return cell.lower()
    return ""


def _join_label_values(pairs: list[tuple[str, str]]) -> str:
    parts = [f"{label}: {value}" for label, value in pairs if value]
    return " | ".join(parts)


def _strip_duplicate_type_paren(
    title: str,
    classifier_raw: str,
    classifier_code: str,
    valuation_type: str = "",
    cost_type: str = "",
    fields: dict[str, str] | None = None,
) -> str:
    """Убирает хвост «(классификатор / тип залога)», если он дублирует столбцы таблицы."""
    text = str(title or "").strip()
    match = re.search(r"\(([^)]+)\)\s*$", text)
    if not match:
        return text

    inner = re.sub(r"\s+", " ", match.group(1)).strip()
    inner_cf = inner.casefold()
    candidates: set[str] = set()
    for value in (
        _object_type_label(classifier_raw, classifier_code, fields or {}),
        format_classifier_display(classifier_raw, classifier_code),
        classifier_raw,
        valuation_type,
        cost_type,
    ):
        chunk = str(value or "").strip()
        if chunk and chunk != "—":
            candidates.add(chunk)
    for part in str(classifier_raw or "").split("/"):
        part = part.strip()
        if part:
            candidates.add(part)

    for cand in candidates:
        cand_cf = cand.casefold()
        if inner_cf == cand_cf or inner_cf in cand_cf or cand_cf in inner_cf:
            return text[: match.start()].strip()
    return text


def format_object_report_name(
    raw_name: str,
    classifier_raw: str,
    classifier_code: str,
    identifier: str = "",
    *,
    row_segments: list[str] | None = None,
    liquidity: str = "",
    valuation_type: str = "",
    cost_type: str = "",
) -> str:
    """
    Многострочное наименование для столбца «Наименование» в перечне залога.
    """
    raw = str(raw_name or "").strip()
    row_segments = row_segments or []
    combined = raw
    if row_segments:
        combined = "\n".join(part for part in (raw, "\t".join(row_segments)) if part).strip()

    fields = _merge_report_fields(raw, row_segments)
    if not fields and combined:
        fields = _heuristic_fields(combined, classifier_raw, classifier_code, identifier)

    kind, classifier_code, _ = resolve_kind_and_code(classifier_raw, classifier_code, fields)

    title = fields.get("_title") or _report_field(
        fields, "описание обеспечения", "description", "kind", "вид обеспечения"
    )
    if not title:
        title = _build_description(fields, combined, kind)
    if not title:
        title = _clean_description_text(_pick_description_from_segments(row_segments, kind, identifier))
    if not title and kind:
        title = kind[:1].upper() + kind[1:]
    if not title and combined:
        title = combined.split(";")[0].strip()[:160]

    title = _strip_duplicate_type_paren(
        title, classifier_raw, classifier_code, valuation_type, cost_type, fields
    )

    cadastral = _report_field(fields, "кадастровый номер", "cadastral") or identifier
    if cadastral and not re.search(r"\d{2}:\d{2}:", cadastral):
        if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", cadastral.upper()):
            cadastral = ""

    area = _report_field(fields, "площадь", "area")
    floor = _report_field(fields, "этаж", "floor")

    line1 = f"[ОБЪЕКТ] {title}" if title else "[ОБЪЕКТ]"

    if _is_vehicle(classifier_code, kind):
        line2 = _join_label_values([
            ("Марка", _report_field(fields, "марка", "brand")),
            ("Модель", _report_field(fields, "модель", "model")),
            ("Год выпуска", _report_field(fields, "год выпуска", "year")),
            ("VIN", _extract_vin(_report_field(fields, "vin", "vin номер") or identifier)),
        ])
    else:
        line2 = _join_label_values([
            ("Площадь", area),
            ("Этаж", floor),
            ("КН", cadastral),
        ])

    rights = _report_field(fields, "права", "право", "вид права", "форма права", "право собственности")
    encumbrance = _report_field(fields, "обременения", "обременение") or "нет"
    line3 = f"[ПРАВА]: {rights or '—'}. Обременения: {encumbrance}."

    liq = _format_liquidity_label(fields, liquidity)
    expo = _format_exposure_days(fields, liquidity)
    line5 = _join_label_values([
        ("Ликвидность", liq),
        ("Срок реализации", expo),
    ])

    eval_date = _report_field(fields, "дата оценки")
    cost_label = (
        (valuation_type or cost_type or _report_field(fields, "вид стоимости", "стоимость") or "")
        .strip()
        .lower()
    )
    line6 = _join_label_values([
        ("Дата оценки", eval_date),
        ("Стоимость", cost_label),
    ])

    provision = _report_field(fields, "обеспеченность", "учитываемое обеспечение", "учет обеспеченности")
    lgd = _report_field(fields, "lgd")
    vat = _report_field(fields, "ндс", "ндс %", "ставка ндс")
    account_bits: list[str] = []
    if provision:
        account_bits.append(f"обеспеченность - {provision.lower()}")
    if lgd:
        account_bits.append(f"LGD - {lgd.lower()}")
    account_left = ", ".join(account_bits)
    account_right = f"НДС: {vat}" if vat else ""
    if account_left and account_right:
        line7 = f"Учет: {account_left} | {account_right}"
    elif account_left:
        line7 = f"Учет: {account_left}"
    elif account_right:
        line7 = f"Учет: {account_right}"
    else:
        line7 = ""

    lines = [line1]
    if line2:
        lines.append(line2)
    lines.append(line3)
    lines.append("[ОЦЕНКА / ЗАЛОГ]")
    if line5:
        lines.append(line5)
    if line6:
        lines.append(line6)
    if line7:
        lines.append(line7)

    if len(lines) <= 3 and not line2 and not line5 and not line6:
        return _format_object_display_name_legacy(
            raw_name,
            classifier_raw,
            classifier_code,
            identifier,
            row_segments=row_segments,
        )

    return "\n".join(lines)


def _format_object_display_name_legacy(
    raw_name: str,
    classifier_raw: str,
    classifier_code: str,
    identifier: str = "",
    *,
    row_segments: list[str] | None = None,
) -> str:
    """
    Собирает краткое наименование для столбца «Наименование».

    Пример: «легковой автомобиль, LADA Aura, год выпуска 2024, vin номер XTAGFL350S0948232»
    """
    raw = str(raw_name or "").strip()
    row_segments = row_segments or []

    row_pairs = merge_fields_from_alternating_segments(row_segments)
    use_row_segments = bool(
        row_pairs
        or _is_known_label(raw)
        or _STRUCTURED_MARKERS.search(raw)
        or len(raw) > 120
    )

    if raw and not use_row_segments:
        kind = _classifier_kind_label(classifier_raw, classifier_code, {})
        if kind and kind.lower() not in raw.lower():
            return f"{kind}, {raw}"
        return raw

    combined = "\t".join(row_segments) if _is_known_label(raw) and row_segments else raw
    if use_row_segments and row_segments:
        combined = "\n".join(part for part in (raw, "\t".join(row_segments)) if part).strip()

    if not combined:
        return "Не указано"

    parse_source = raw if _STRUCTURED_MARKERS.search(raw) or len(raw) > 120 else combined
    fields = merge_description_fields(parse_source, row_segments if use_row_segments else None)
    if not fields and _STRUCTURED_MARKERS.search(parse_source):
        fields = _heuristic_fields(parse_source, classifier_raw, classifier_code, identifier)

    kind, classifier_code, _ = resolve_kind_and_code(classifier_raw, classifier_code, fields)

    if not fields and len(combined) <= 120 and not _STRUCTURED_MARKERS.search(combined):
        if kind and kind not in combined.lower():
            return f"{kind}, {combined}"
        return combined

    description = _build_description(fields, combined, kind)
    if not description:
        description = _clean_description_text(_pick_description_from_segments(row_segments, kind, identifier))
    parts: list[str] = []

    if kind:
        parts.append(kind)
    if description and description.lower() != kind.lower():
        parts.append(description)

    if _is_vehicle(classifier_code, kind):
        year = fields.get("year", "")
        if not year:
            year_match = re.search(r"год выпуска\s*((?:19|20)\d{2})", description, re.I)
            if year_match:
                year = year_match.group(1)
        if year and "год выпуска" not in description.lower():
            parts.append(f"год выпуска {_extract_year(year)}")
        vin_source = fields.get("vin") or identifier
        if vin_source:
            vin = _extract_vin(vin_source)
            if len(vin) >= 11:
                parts.append(f"vin номер {vin}")
    elif _is_real_estate(classifier_code, kind):
        cadastral = fields.get("cadastral") or identifier
        if cadastral and re.search(r"\d{2}:\d{2}:", cadastral):
            parts.append(f"кадастровый номер {cadastral}")
        area = fields.get("area", "").strip()
        if area and area.lower() not in description.lower():
            parts.append(area)
    elif identifier and not _is_known_label(identifier):
        parts.append(identifier)

    if parts:
        return ", ".join(parts)

    return combined[:200] + ("…" if len(combined) > 200 else "")


def format_object_display_name(
    raw_name: str,
    classifier_raw: str,
    classifier_code: str,
    identifier: str = "",
    *,
    row_segments: list[str] | None = None,
    liquidity: str = "",
    valuation_type: str = "",
    cost_type: str = "",
) -> str:
    """Наименование объекта для столбца «Наименование» в перечне."""
    return format_object_report_name(
        raw_name,
        classifier_raw,
        classifier_code,
        identifier,
        row_segments=row_segments,
        liquidity=liquidity,
        valuation_type=valuation_type,
        cost_type=cost_type,
    )
