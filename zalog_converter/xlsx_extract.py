"""Извлечение перечня объектов залога из XLSX (порт parseXlsxObjects)."""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from typing import Any

from .asz_xlsx import build_asz_col_map, find_asz_header_row, parse_asz_row
from .name_format import (
    collect_row_description_segments,
    format_classifier_display,
    format_object_display_name,
    merge_description_fields,
    resolve_kind_and_code,
    _is_known_label,
)
from .utils import (
    get_classifier_code_3_level,
    is_xlsx_technical_row,
    parse_number_cell,
    should_skip_xlsx_object_row,
)
from .xlsx_scoring import (
    MIN_ACCEPT_SCORE,
    classify_score,
    score_asz_row,
    score_simple_row,
    skip_reason_asz,
)
from .xlsx_sheet import read_xlsx_sheet_rows


@dataclass
class CollateralObject:
    conditional: str
    klassifikator: str
    klassifikator_raw: str
    name: str
    raw_name: str
    identifier: str
    quality_category: str
    valuation_type: str
    cost: float
    collateral_value: float
    discount: float
    cost_type: str
    bank_market_price: float
    parse_score: int = 0
    classifier_name: str = ""
    liquidity: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _with_classifier_name(**fields: Any) -> dict[str, Any]:
    fields["classifier_name"] = format_classifier_display(
        fields.get("klassifikator_raw", ""),
        fields.get("klassifikator", ""),
    )
    return fields


@dataclass
class RowPreview:
    sheet_row: int
    status: str
    score: int
    reasons: list[str]
    conditional: str
    name: str
    raw_preview: str
    cost: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class XlsxParseResult:
    objects: list[CollateralObject]
    format_type: str
    header_row_index: int
    sheet_name: str
    merged_regions_count: int
    min_accept_score: int
    rows: list[RowPreview]
    accepted_count: int
    suspicious_count: int
    skipped_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "format_type": self.format_type,
            "header_row_index": self.header_row_index,
            "sheet_name": self.sheet_name,
            "merged_regions_count": self.merged_regions_count,
            "min_accept_score": self.min_accept_score,
            "accepted_count": self.accepted_count,
            "suspicious_count": self.suspicious_count,
            "skipped_count": self.skipped_count,
            "rows": [row.to_dict() for row in self.rows],
        }


def _find_header_row_index(rows: list[list[Any]]) -> int:
    for index, row in enumerate(rows[:20]):
        text = " ".join(str(cell or "").lower() for cell in row)
        if "условн" in text and ("наименован" in text or "описание" in text) and "стоимост" in text:
            return index
    return 0


def _build_col_map(header_row: list[Any]) -> dict[str, int]:
    col_map = {
        "conditional": -1,
        "classifier": -1,
        "name": -1,
        "identifier": -1,
        "note": -1,
        "cost": -1,
        "discount": -1,
        "collateral": -1,
        "quality": -1,
    }
    for index, cell in enumerate(header_row):
        value = str(cell or "").lower()
        if "условное обозначение" in value or value.strip() == "условное":
            col_map["conditional"] = index
        elif "классификатор" in value:
            col_map["classifier"] = index
        elif "наименование" in value:
            col_map["name"] = index
        elif "описание обеспечения" in value and col_map["name"] == -1:
            col_map["name"] = index
        elif "объект" in value and col_map["name"] == -1:
            col_map["name"] = index
        elif "идентификатор" in value or "vin" in value or "кадастр" in value:
            col_map["identifier"] = index
        elif "примечан" in value:
            col_map["note"] = index
        elif "оценочная стоимость" in value or "стоимость оцен" in value:
            col_map["cost"] = index
        elif "дисконт" in value:
            col_map["discount"] = index
        elif "залоговая стоимость" in value:
            col_map["collateral"] = index
        elif "категория качества" in value:
            col_map["quality"] = index

    defaults = {
        "conditional": 0,
        "classifier": 1,
        "name": 2,
        "identifier": 3,
        "cost": 5,
        "discount": 8,
        "collateral": 9,
        "quality": 10,
    }
    for key, default_index in defaults.items():
        if col_map[key] == -1:
            col_map[key] = default_index
    return col_map


def _cell(row: list[Any], index: int) -> Any:
    if index < 0 or index >= len(row):
        return ""
    return row[index]


def _resolve_raw_name_cell(row: list[Any], col_map: dict[str, int]) -> str:
    primary = str(_cell(row, col_map["name"]) or "").strip()
    note = str(_cell(row, col_map["note"]) or "").strip() if col_map.get("note", -1) >= 0 else ""

    if primary and not _is_known_label(primary):
        return primary
    if _is_known_label(primary) and note:
        return note
    if not primary and note:
        return note
    return primary


def _is_valid_conditional(value: str) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if len(text) > 40:
        return False
    if "\n" in text or "\t" in text:
        return False
    if _is_known_label(text):
        return False
    return True


def _raw_preview(*parts: str, limit: int = 120) -> str:
    text = " | ".join(part.strip() for part in parts if part and str(part).strip())
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def parse_xlsx(source: bytes | str) -> XlsxParseResult:
    sheet_name, rows, merged_regions_count = read_xlsx_sheet_rows(source)

    if not rows or len(rows) < 2:
        raise ValueError("XLSX не содержит данных")

    asz_header_index = find_asz_header_row(rows)
    if asz_header_index is not None:
        return _parse_asz_format(
            rows,
            asz_header_index,
            sheet_name=sheet_name,
            merged_regions_count=merged_regions_count,
        )

    header_index = _find_header_row_index(rows)
    return _parse_simple_format(
        rows,
        header_index,
        sheet_name=sheet_name,
        merged_regions_count=merged_regions_count,
    )


def extract_objects_from_xlsx(source: bytes | str) -> list[CollateralObject]:
    return parse_xlsx(source).objects


def _parse_asz_format(
    rows: list[list[Any]],
    header_index: int,
    *,
    sheet_name: str,
    merged_regions_count: int,
) -> XlsxParseResult:
    col_map = build_asz_col_map(list(rows[header_index]))
    objects: list[CollateralObject] = []
    previews: list[RowPreview] = []
    accepted = suspicious = skipped = 0

    for row_index, raw_row in enumerate(rows[header_index + 1 :], start=1):
        row = list(raw_row)
        sheet_row = header_index + 1 + row_index
        kind_path = str(_cell(row, col_map["kind_path"]) or "").strip()
        description = str(_cell(row, col_map["description"]) or "").strip()
        cost = parse_number_cell(_cell(row, col_map["cost"]))

        skip_reason = skip_reason_asz(row, col_map)
        if skip_reason:
            if kind_path or description:
                previews.append(
                    RowPreview(
                        sheet_row=sheet_row,
                        status="skipped",
                        score=0,
                        reasons=[skip_reason],
                        conditional="",
                        name="",
                        raw_preview=_raw_preview(kind_path, description),
                        cost=cost,
                    )
                )
                skipped += 1
            continue

        parsed = parse_asz_row(row, col_map, row_index)
        if not parsed:
            continue

        score, reasons = score_asz_row(
            row,
            col_map,
            conditional=parsed["conditional"],
            name=parsed["name"],
            identifier=parsed["identifier"],
            description=description,
            kind_path=kind_path,
        )
        status = classify_score(score)

        previews.append(
            RowPreview(
                sheet_row=sheet_row,
                status=status,
                score=score,
                reasons=reasons,
                conditional=parsed["conditional"],
                name=parsed["name"],
                raw_preview=_raw_preview(kind_path, description),
                cost=parsed["cost"],
            )
        )

        if status == "accepted":
            accepted += 1
            object_fields = _with_classifier_name(
                **{k: v for k, v in parsed.items() if k != "pledgor"},
                parse_score=score,
            )
            objects.append(CollateralObject(**object_fields))
        elif status == "suspicious":
            suspicious += 1
        else:
            skipped += 1

    if not objects:
        raise ValueError("Не удалось извлечь объекты из XLSX (формат ASZ)")

    return XlsxParseResult(
        objects=objects,
        format_type="asz",
        header_row_index=header_index,
        sheet_name=sheet_name,
        merged_regions_count=merged_regions_count,
        min_accept_score=MIN_ACCEPT_SCORE,
        rows=previews,
        accepted_count=accepted,
        suspicious_count=suspicious,
        skipped_count=skipped,
    )


def _parse_simple_format(
    rows: list[list[Any]],
    header_index: int,
    *,
    sheet_name: str,
    merged_regions_count: int,
) -> XlsxParseResult:
    col_map = _build_col_map(list(rows[header_index]))
    objects: list[CollateralObject] = []
    previews: list[RowPreview] = []
    accepted = suspicious = skipped = 0

    for row_index, raw_row in enumerate(rows[header_index + 1 :], start=1):
        row = list(raw_row)
        sheet_row = header_index + 1 + row_index
        raw_name_cell = _resolve_raw_name_cell(row, col_map)
        conditional_raw = str(_cell(row, col_map["conditional"]) or "").strip()

        if not raw_name_cell and not conditional_raw:
            continue

        conditional = conditional_raw if _is_valid_conditional(conditional_raw) else f"Объект_{row_index}"
        classifier_raw = str(_cell(row, col_map["classifier"]) or "").strip()
        classifier_code = get_classifier_code_3_level(classifier_raw)
        row_segments = collect_row_description_segments(row, col_map)
        estimated_cost = parse_number_cell(_cell(row, col_map["cost"]))
        identifier = str(_cell(row, col_map["identifier"]) or "").strip()
        if _is_known_label(identifier):
            identifier = ""
        if not identifier:
            for segment in row_segments:
                if re.fullmatch(r"[A-HJ-NPR-Z0-9]{11,17}", segment.upper()):
                    identifier = segment.upper()
                    break
                if re.fullmatch(r"\d{2}:\d{2}:\d+:\d+", segment):
                    identifier = segment
                    break
        name = format_object_display_name(
            raw_name_cell,
            classifier_raw,
            classifier_code,
            identifier,
            row_segments=row_segments,
        )

        fields = merge_description_fields(raw_name_cell, row_segments or None)
        _, classifier_code, classifier_raw = resolve_kind_and_code(classifier_raw, classifier_code, fields)

        hard_skip = False
        skip_reason: str | None = None
        if is_xlsx_technical_row(row, col_map, classifier_code, raw_name_cell, conditional, estimated_cost):
            hard_skip = True
            skip_reason = "служебная/шаблонная строка"
        elif should_skip_xlsx_object_row(raw_name_cell, name):
            hard_skip = True
            skip_reason = "нет осмысленного наименования"

        score, reasons = score_simple_row(
            row,
            col_map,
            conditional=conditional,
            name=name,
            identifier=identifier,
            raw_name=raw_name_cell,
        )
        if skip_reason:
            reasons = [skip_reason, *reasons]
        status = classify_score(score, hard_skip=hard_skip)

        previews.append(
            RowPreview(
                sheet_row=sheet_row,
                status=status,
                score=score,
                reasons=reasons,
                conditional=conditional,
                name=name,
                raw_preview=_raw_preview(conditional_raw, raw_name_cell),
                cost=estimated_cost,
            )
        )

        if status == "accepted":
            accepted += 1
            quality = str(_cell(row, col_map["quality"]) or "").strip() or "Стандарт"
            collateral_value = parse_number_cell(_cell(row, col_map["collateral"]))
            if collateral_value == 0 and estimated_cost > 0:
                collateral_value = estimated_cost
            discount = parse_number_cell(_cell(row, col_map["discount"]))

            object_fields = _with_classifier_name(
                conditional=conditional,
                klassifikator=classifier_code,
                klassifikator_raw=classifier_raw,
                name=name,
                raw_name=raw_name_cell or "\t".join(row_segments),
                identifier=identifier,
                quality_category=quality,
                valuation_type="Рыночная" if estimated_cost > 0 else "Льготная",
                cost=estimated_cost,
                collateral_value=collateral_value,
                discount=discount,
                cost_type="рыночная" if estimated_cost > 0 else "льготная",
                bank_market_price=round(estimated_cost * 1.05, 2) if estimated_cost > 0 else 0.0,
                parse_score=score,
            )
            objects.append(CollateralObject(**object_fields))
        elif status == "suspicious":
            suspicious += 1
        else:
            skipped += 1

    if not objects:
        raise ValueError("Не удалось извлечь объекты из XLSX")

    return XlsxParseResult(
        objects=objects,
        format_type="simple",
        header_row_index=header_index,
        sheet_name=sheet_name,
        merged_regions_count=merged_regions_count,
        min_accept_score=MIN_ACCEPT_SCORE,
        rows=previews,
        accepted_count=accepted,
        suspicious_count=suspicious,
        skipped_count=skipped,
    )
