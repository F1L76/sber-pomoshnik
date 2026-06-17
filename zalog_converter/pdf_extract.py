"""Извлечение текста и полей из PDF заключения (без LLM)."""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from io import BytesIO
from typing import Any

import pdfplumber


@dataclass
class ConclusionRisk:
    identifier: str
    risk: str
    minimization: str
    risk_number: str = ""

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass
class ConclusionData:
    conclusion_number: str = ""
    conclusion_date: str = ""
    client_name: str = ""
    borrower_inn: str = ""
    validity_date: str = ""
    credit_term: str = ""
    reference_text: str = ""
    summary: str = ""
    risks: list[ConclusionRisk] = field(default_factory=list)
    raw_text: str = ""
    extraction_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "conclusion_number": self.conclusion_number,
            "conclusion_date": self.conclusion_date,
            "client_name": self.client_name,
            "borrower_inn": self.borrower_inn,
            "validity_date": self.validity_date,
            "credit_term": self.credit_term,
            "reference_text": self.reference_text,
            "summary": self.summary,
            "risks": [risk.to_dict() for risk in self.risks],
            "raw_text_length": len(self.raw_text),
            "extraction_notes": self.extraction_notes,
        }


def _maybe_fix_pdf_encoding(text: str) -> str:
    """Часть PDF отдаёт кириллицу как cp1251-байты в latin-1 (ÈÍÍ вместо ИНН)."""
    if re.search(r"[А-Яа-яЁё]", text):
        return text
    try:
        fixed = text.encode("latin-1").decode("cp1251")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    if re.search(r"[А-Яа-яЁё]", fixed):
        return fixed
    return text


def extract_pdf_text(source: bytes) -> str:
    chunks: list[str] = []
    with pdfplumber.open(BytesIO(source)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                chunks.append(page_text)
    text = "\n".join(chunks)
    text = _maybe_fix_pdf_encoding(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalize_dmy(raw: str) -> str:
    normalized = re.sub(r"[./]", "-", raw.strip())
    parts = normalized.split("-")
    if len(parts) != 3:
        return ""
    if len(parts[0]) == 4:
        year, month, day = parts
    else:
        day, month, year = parts
        if len(year) == 2:
            year = f"20{year}"
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def _normalize_date(match: re.Match[str]) -> str:
    groups = match.groups()
    if len(groups) == 3 and len(groups[0]) == 4:
        year, month, day = groups
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    day, month, year = groups
    if len(year) == 2:
        year = f"20{year}"
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def _is_asz_short_form(text: str) -> bool:
    return "краткая форма залогового заключения" in text.lower()


_LEGAL_PREFIXES = ("ООО", "АО", "ПАО", "ЗАО", "ОАО")


def _title_case_word(word: str) -> str:
    if len(word) > 1 and word.isupper():
        return word[0] + word[1:].lower()
    return word


def _format_client_display(raw: str) -> str:
    """ИП → «ИП Фамилия Имя Отчество»; юрлицо → «ООО \"…\"»."""
    name = re.sub(r"\s+", " ", raw).strip()
    if not name:
        return ""

    entrepreneur = re.match(r"(?i)^предприниматель\s+(.+)$", name)
    if entrepreneur:
        fio = " ".join(_title_case_word(part) for part in entrepreneur.group(1).split())
        return f"ИП {fio}"

    ip_only = re.match(r"(?i)^ип\s+(.+)$", name)
    if ip_only and not re.match(r"(?i)^(ООО|АО|ПАО|ЗАО|ОАО)\b", name):
        fio = " ".join(_title_case_word(part) for part in ip_only.group(1).split())
        return f"ИП {fio}"

    quoted = re.match(
        r"(?i)^(ООО|АО|ПАО|ЗАО|ОАО)\s*[\"«]([^\"»]+)[\"»]\s*$",
        name,
    )
    if quoted:
        prefix, inner = quoted.group(1).upper(), quoted.group(2).strip()
        return f'{prefix} "{inner}"'

    unquoted = re.match(r"(?i)^(ООО|АО|ПАО|ЗАО|ОАО)\s+(.+)$", name)
    if unquoted:
        prefix, inner = unquoted.group(1).upper(), unquoted.group(2).strip().strip("\"«»")
        return f'{prefix} "{inner}"'

    return name


def _clean_organization_name(raw: str) -> str:
    return _format_client_display(raw)


def _parse_asz_short_form_header(text: str) -> dict[str, str]:
    """Шапка табличной краткой формы: ИНН, клиент, дата на одной строке."""
    result = {"conclusion_number": "", "conclusion_date": "", "borrower_inn": "", "client_name": ""}

    number_match = re.search(r"\b(ASZ\d{10,16}(?:-\d+)?)\b", text, re.I)
    if number_match:
        result["conclusion_number"] = number_match.group(1).upper()

    org_line = re.search(
        r"(?m)^(\d{10}|\d{12})\s+"
        r"((?:ООО|АО|ПАО|ИП|ЗАО|ОАО)\s*(?:\"[^\"\n]+\"|«[^»\n]+»|[^\n\d]{3,120}?))"
        r"\s+(\d{2}[./]\d{2}[./]\d{4})\s*$",
        text,
        re.I,
    )
    if org_line:
        result["borrower_inn"] = org_line.group(1)
        result["client_name"] = _clean_organization_name(org_line.group(2))
        result["conclusion_date"] = _normalize_dmy(org_line.group(3))
        return result

    ip_line = re.search(
        r"(?m)^(\d{12})\s+"
        r"(ПРЕДПРИНИМАТЕЛЬ\s+[^\n\d]+?)"
        r"\s+(\d{2}[./-]\d{2}[./-]\d{4})\s*$",
        text,
        re.I,
    )
    if ip_line:
        result["borrower_inn"] = ip_line.group(1)
        name = re.sub(r"\s+", " ", ip_line.group(2)).strip()
        tail = text[ip_line.end() :].lstrip()
        next_line = tail.split("\n", 1)[0].strip() if tail else ""
        if next_line and re.fullmatch(
            r"[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z]+){0,2}",
            next_line,
        ):
            if next_line.upper() not in name.upper():
                name = f"{name} {next_line}"
        result["client_name"] = _format_client_display(name)
        result["conclusion_date"] = _normalize_dmy(ip_line.group(3))

    return result


def _remove_pdf_garbage_layers(text: str) -> str:
    """Убирает битый слой PDF внутри строк, переносы из PDF сохраняются."""
    lines: list[str] = []
    for line in text.split("\n"):
        cleaned = re.sub(
            r"(?:[!\"#$%&'()*+,\-./:;<=>?@A-Z\[\\\]^_`{|}~']\s*){12,}",
            " ",
            line,
        )
        cleaned = re.sub(r"[ \t]+", " ", cleaned).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


def _is_garbage_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    cyr = len(re.findall(r"[А-Яа-яЁё]", stripped))
    sym = len(re.findall(r"[!\"#$%&'()*+,\-./:;<=>?@A-Z\[\\\]^_`{|}~']", stripped))
    if cyr >= 10:
        return False
    if cyr == 0 and sym >= 6:
        return True
    if sym >= 12 and cyr < 5:
        return True
    return False


def _reference_text_from_raw(raw: str) -> str:
    """Текст «Справочной информации» как в PDF, без полей из блока заключения."""
    if not raw.strip():
        return ""

    text = _remove_pdf_garbage_layers(raw.replace("\r", ""))
    text = re.sub(
        r"Срок действия заключения\s*:\s*\d{2}[-./]\d{2}[-./]\d{4}\s*",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"Срок кредита\s*:\s*[^\n]+", "", text, flags=re.I)

    kept: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            if kept and kept[-1] != "":
                kept.append("")
            continue
        lower = line.lower()
        if re.match(r"^срок действия заключения\s*:", lower):
            continue
        if re.match(r"^срок кредита\s*:", lower):
            continue
        if re.fullmatch(r"null[,\s]*", lower):
            continue
        if _is_garbage_line(line):
            continue
        kept.append(line)

    result = "\n".join(kept)
    return re.sub(r"\n{3,}", "\n\n", result).strip()


def _extract_reference_from_pdf_tables(source: bytes) -> str:
    with pdfplumber.open(BytesIO(source)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for index, row in enumerate(table):
                    if not row or not row[0]:
                        continue
                    first = str(row[0]).strip()
                    if first.lower() != "справочная информация":
                        continue
                    chunks: list[str] = []
                    for next_row in table[index + 1 :]:
                        if not next_row or not next_row[0]:
                            continue
                        cell = str(next_row[0]).strip()
                        if cell.lower().startswith("справочная"):
                            continue
                        chunks.append(cell)
                    if chunks:
                        return "\n".join(chunks)
    return ""


def _extract_reference_info(text: str) -> dict[str, str]:
    result = {"validity_date": "", "credit_term": ""}
    section_match = re.search(r"Справочная информация([\s\S]*?)$", text, re.I)
    if not section_match:
        return result

    body = section_match.group(1)
    validity_match = re.search(
        r"Срок действия заключения\s*:\s*(\d{2}[-./]\d{2}[-./]\d{4})",
        body,
        re.I,
    )
    if validity_match:
        result["validity_date"] = _normalize_dmy(validity_match.group(1))

    credit_match = re.search(r"Срок кредита\s*:\s*([^\n]+)", body, re.I)
    if credit_match:
        result["credit_term"] = credit_match.group(1).strip()

    return result


def _extract_reference_section_raw(text: str) -> str:
    section_match = re.search(r"Справочная информация([\s\S]*?)$", text, re.I)
    return section_match.group(1).strip() if section_match else ""


def _apply_reference_section(conclusion: ConclusionData, raw_section: str) -> None:
    if not raw_section:
        conclusion.reference_text = ""
        return
    reference = _extract_reference_info(f"Справочная информация\n{raw_section}")
    if reference["validity_date"]:
        conclusion.validity_date = reference["validity_date"]
    if reference["credit_term"]:
        conclusion.credit_term = reference["credit_term"]
    conclusion.reference_text = _reference_text_from_raw(raw_section)


def _extract_conclusion_number(text: str) -> str:
    if _is_asz_short_form(text):
        header = _parse_asz_short_form_header(text)
        if header["conclusion_number"]:
            return header["conclusion_number"]

    patterns = [
        r"(?:номер\s+заключения|заключение\s*№?|№\s*заключения)\s*[:\-]?\s*(ASZ\d{10,16}(?:-\d+)?)",
        r"\b(ASZ\d{10,16}(?:-\d+)?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1).upper()
    return ""


def _extract_date(text: str) -> str:
    if _is_asz_short_form(text):
        header = _parse_asz_short_form_header(text)
        if header["conclusion_date"]:
            return header["conclusion_date"]

    patterns = [
        r"(?:дата\s+заключения|от)\s*[:\-]?\s*(\d{2}[./]\d{2}[./]\d{4})",
        r"(?:дата\s+заключения|от)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})",
        r"\b(\d{2}[./]\d{2}[./]\d{4})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            raw = match.group(1)
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
                return raw
            return _normalize_dmy(raw)
    return ""


def _extract_inn(text: str) -> str:
    if _is_asz_short_form(text):
        header = _parse_asz_short_form_header(text)
        if header["borrower_inn"]:
            return header["borrower_inn"]

    patterns = [
        r"(?:ИНН|инн)\s*(?:залогодателя|заёмщика|клиента|организации)?\s*[:\-]?\s*(\d{10}|\d{12})",
        r"\bИНН\s*[:\-]?\s*(\d{10}|\d{12})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1)
    return ""


def _extract_client_name(text: str) -> str:
    if _is_asz_short_form(text):
        header = _parse_asz_short_form_header(text)
        if header["client_name"]:
            return header["client_name"]

    patterns = [
        r"(?:наименование\s+залогодателя|залогодатель|клиент|заёмщик)\s*[:\-]?\s*"
        r"((?:ООО|АО|ПАО|ИП|ЗАО|ОАО)\s*[\"«]?[^.\n;]{3,120})",
        r"\b((?:ООО|АО|ПАО|ИП|ЗАО|ОАО)\s+[\"«][^\"»\n]{2,120}[\"»])",
        r"\b((?:ООО|АО|ПАО|ИП|ЗАО|ОАО)\s+[А-ЯЁA-Z][^\n,;]{2,100})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            name = re.sub(r"\s+", " ", match.group(1)).strip(" \"«»")
            if name.count('"') % 2 == 1:
                name = name.rstrip('"')
            if len(name) >= 5:
                return _format_client_display(name)
    return ""


_ID_TOKEN_RE = re.compile(
    r"\b(?:ТС|ИП|МиО|ЗУ|ЗиС|З-\d{1,3})_[\w.,-]+",
    re.I,
)
_NOISE_LINES = {
    "ые номера",
    "объектов не",
    "заполнены",
    "ип_исходн",
    "null,",
}


def _is_noise_line(line: str) -> bool:
    lower = line.lower().strip(" ,.")
    if lower in _NOISE_LINES:
        return True
    if len(line) < 10 and not _ID_TOKEN_RE.search(line):
        return True
    return False


def _collect_object_ids(*chunks: str) -> str:
    seen: set[str] = set()
    result: list[str] = []
    for chunk in chunks:
        for raw in _ID_TOKEN_RE.findall(chunk):
            token = raw.strip().rstrip(",.")
            key = token.lower()
            if key in seen or key.endswith("_исходн"):
                continue
            seen.add(key)
            result.append(token)
    return ", ".join(result)


def _is_garbage_conditional(text: str) -> bool:
    lower = text.lower()
    return any(
        marker in lower
        for marker in ("исходн", "заполнены", "объектов не", "ые номера", "null")
    )


def _objects_from_pdf_cell(raw: str) -> str:
    """Все объекты из ячейки PDF, как в документе (через запятую)."""
    if not raw or _is_garbage_conditional(raw):
        return "—"
    lines = [
        re.sub(r"\s+", " ", line.strip().rstrip(","))
        for line in raw.replace("\r", "").split("\n")
        if line.strip() and not _is_garbage_conditional(line)
    ]
    if not lines:
        return "—"
    return ", ".join(lines)


def _normalize_risk_number(raw: str) -> str:
    return re.sub(r"\s+", "", raw).strip().rstrip(".")


def _normalize_risk_text(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.replace("\n", " ")).strip()


def _risk_text_from_cell(raw: str) -> str:
    """Только формулировка риска из ячейки PDF (без текста минимизации в той же ячейке)."""
    lines = [line.strip() for line in raw.replace("\r", "").split("\n") if line.strip()]
    if not lines:
        return "—"

    parts: list[str] = []
    for line in lines:
        lower = line.lower()
        if parts and (
            lower.startswith("для смены")
            or lower.startswith("до заключения")
            or lower.startswith("категория качества до")
            or lower.startswith("в случае невыполнения")
        ):
            break
        if lower.startswith("риск ") or not parts:
            parts.append(line)
        elif parts:
            break
    return _normalize_risk_text(" ".join(parts)) if parts else _normalize_risk_text(raw)


def _extract_risks_from_pdf_tables(source: bytes) -> list[ConclusionRisk]:
    risks: list[ConclusionRisk] = []
    seen: set[tuple[str, str, str]] = set()

    with pdfplumber.open(BytesIO(source)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                start_row: int | None = None
                for index, row in enumerate(table):
                    if row and row[0] and str(row[0]).strip().lower() == "риски":
                        start_row = index + 1
                        break
                if start_row is None:
                    continue

                for row in table[start_row:]:
                    if not row or not row[0]:
                        continue
                    first_cell = str(row[0]).strip()
                    if first_cell.lower().startswith("справочная"):
                        break

                    conditional = _objects_from_pdf_cell(first_cell)
                    risk_number = _normalize_risk_number(str(row[1] or "")) if len(row) > 1 else ""
                    risk_text = _risk_text_from_cell(str(row[2] or "")) if len(row) > 2 else ""
                    if not risk_text and conditional == "—":
                        continue

                    key = (conditional.lower(), risk_number.lower(), risk_text.lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    risks.append(
                        ConclusionRisk(
                            identifier=conditional,
                            risk_number=risk_number,
                            risk=risk_text or "—",
                            minimization="—",
                        )
                    )
    return risks[:30]


def _is_new_risk_heading(line: str) -> bool:
    lower = line.lower()
    return lower.startswith("риск ") and "минимизир" not in lower


def _is_minimization_line(line: str) -> bool:
    lower = line.lower()
    if "минимизир" in lower:
        return True
    if lower.startswith("до заключения"):
        return True
    if re.match(r"^\d+\.\d+\.", line):
        return True
    if re.match(r"^[А-ЯA-ZЁ][\w.-]*_\d", line):
        return True
    if lower.startswith("для смены категории"):
        return True
    if lower.startswith("в случае невыполнения"):
        return True
    return False


def _extract_risks_asz_short_form(text: str) -> list[ConclusionRisk]:
    section_match = re.search(
        r"\bРиски\b([\s\S]*?)(?:Справочная информация|$)",
        text,
        re.I,
    )
    if not section_match:
        return []

    lines = [line.strip() for line in section_match.group(1).splitlines() if line.strip()]
    blocks: list[list[str]] = []
    current: list[str] = []

    for line in lines:
        if _is_noise_line(line):
            continue
        if _is_new_risk_heading(line):
            if current:
                blocks.append(current)
            current = [line]
            continue
        if current:
            current.append(line)

    if current:
        blocks.append(current)

    risks: list[ConclusionRisk] = []
    seen: set[tuple[str, str, str]] = set()

    for block in blocks:
        risk_text = re.sub(r"\s+", " ", block[0]).strip(" -–—.")
        min_parts: list[str] = []
        for line in block[1:]:
            if _is_minimization_line(line) or min_parts:
                min_parts.append(line)

        minimization = re.sub(r"\s+", " ", " ".join(min_parts)).strip(" -–—.")
        identifier = _collect_object_ids(risk_text, *block[1:])

        key = (identifier.lower(), risk_text.lower(), minimization.lower())
        if key in seen:
            continue
        seen.add(key)
        risks.append(
            ConclusionRisk(
                identifier=identifier or f"Риск-{len(risks) + 1}",
                risk_number="",
                risk=risk_text,
                minimization=minimization or "—",
            )
        )

    return risks[:30]


def _extract_risks(text: str) -> list[ConclusionRisk]:
    if _is_asz_short_form(text):
        asz_risks = _extract_risks_asz_short_form(text)
        if asz_risks:
            return asz_risks

    risks: list[ConclusionRisk] = []
    section_match = re.search(
        r"(?:выявленн\w*\s+риск\w*|риск\w*\s+залогового|таблица\s+риск\w*)([\s\S]{0,6000})",
        text,
        re.I,
    )
    section = section_match.group(1) if section_match else text

    line_pattern = re.compile(
        r"(?P<id>З-\d{1,3}|VIN\s*[A-HJ-NPR-Z0-9]{11,17}|\d{2}:\d{2}:\d{6,7}:\d+)"
        r"\s*[-–—|]\s*(?P<risk>.+?)"
        r"(?:минимизац\w*|мер\w*\s+минимизац\w*)\s*[:\-]\s*(?P<min>.+?)\s*$",
        re.I,
    )
    table_pattern = re.compile(
        r"(?P<id>З-\d{1,3})[\s|]+(?P<risk>[^|;\n]{8,200})[\s|]+(?P<min>[^|;\n]{8,200})",
        re.I,
    )

    seen: set[tuple[str, str]] = set()
    for line in section.splitlines():
        match = line_pattern.search(line.strip())
        if not match:
            match = table_pattern.search(line.strip())
        if not match:
            continue
        identifier = re.sub(r"\s+", " ", match.group("id")).strip()
        risk = re.sub(r"\s+", " ", match.group("risk")).strip(" -–—:|.")
        minimization = re.sub(r"\s+", " ", match.group("min")).strip(" -–—:|.")
        key = (identifier.lower(), risk.lower())
        if key in seen:
            continue
        seen.add(key)
        risks.append(
            ConclusionRisk(
                identifier=identifier,
                risk_number="",
                risk=risk,
                minimization=minimization,
            )
        )

    if not risks:
        bullet_pattern = re.compile(
            r"(?:^|\n)\s*(?:[-•]|\d+[\).])\s*(?P<risk>риск[^:\n]{5,200}?)"
            r"(?:минимизац\w*|мер\w*)\s*[:\-]\s*(?P<min>[^\n]{5,200})",
            re.I,
        )
        for index, match in enumerate(bullet_pattern.finditer(section), start=1):
            risk = re.sub(r"\s+", " ", match.group("risk")).strip(" :-")
            minimization = re.sub(r"\s+", " ", match.group("min")).strip()
            key = (risk.lower(), minimization.lower())
            if key in seen:
                continue
            seen.add(key)
            risks.append(
                ConclusionRisk(
                    identifier=f"Риск-{index}",
                    risk_number="",
                    risk=risk,
                    minimization=minimization,
                )
            )

    return risks[:20]


def _build_template_summary(
    conclusion: ConclusionData,
    object_count: int | None = None,
) -> str:
    parts: list[str] = []
    client = conclusion.client_name or "клиент не указан в PDF"
    number = conclusion.conclusion_number or "номер не распознан"
    date = conclusion.conclusion_date or "дата не распознана"

    parts.append(
        f"Залоговое заключение {number} от {date} подготовлено для {client}."
    )
    if conclusion.borrower_inn:
        parts.append(f"ИНН залогодателя: {conclusion.borrower_inn}.")
    if conclusion.validity_date:
        parts.append(f"Срок действия заключения: до {conclusion.validity_date}.")
    if conclusion.credit_term:
        parts.append(f"Срок кредита: {conclusion.credit_term}.")

    if object_count is not None and object_count > 0:
        parts.append(
            f"В перечне залога указано объектов: {object_count}. "
            "Стоимостные показатели приведены в таблице ниже."
        )

    if conclusion.risks:
        parts.append(
            f"В тексте заключения выявлено рисков: {len(conclusion.risks)}. "
            "Подробности — в разделе «Риски»."
        )
    else:
        parts.append(
            "Явные формулировки рисков в PDF не распознаны автоматически. "
            "Проверьте исходный документ вручную."
        )

    parts.append(
        "Это автоматический пересказ по шаблону без нейросети; "
        "для смыслового резюме текста заключения потребуется подключение GigaChat."
    )
    return " ".join(parts)


def parse_conclusion_text(text: str, object_count: int | None = None) -> ConclusionData:
    conclusion = ConclusionData(raw_text=text)
    if not text or len(text) < 30:
        conclusion.extraction_notes.append(
            "Не удалось извлечь достаточно текста из PDF (возможно, скан без текстового слоя)."
        )
        return conclusion

    conclusion.conclusion_number = _extract_conclusion_number(text)
    conclusion.conclusion_date = _extract_date(text)
    conclusion.borrower_inn = _extract_inn(text)
    conclusion.client_name = _extract_client_name(text)
    if _is_asz_short_form(text):
        _apply_reference_section(conclusion, _extract_reference_section_raw(text))
    conclusion.risks = _extract_risks(text)
    conclusion.summary = _build_template_summary(conclusion, object_count)

    if not conclusion.conclusion_number:
        conclusion.extraction_notes.append("Номер заключения ASZ… не найден в тексте.")
    if not conclusion.conclusion_date:
        conclusion.extraction_notes.append("Дата заключения не распознана.")
    if not conclusion.client_name:
        conclusion.extraction_notes.append("Наименование клиента не распознано.")
    if not conclusion.borrower_inn:
        conclusion.extraction_notes.append("ИНН не найден в тексте PDF.")

    return conclusion


def extract_conclusion_from_pdf(source: bytes, object_count: int | None = None) -> ConclusionData:
    text = extract_pdf_text(source)
    conclusion = parse_conclusion_text(text, object_count=object_count)
    if _is_asz_short_form(text):
        table_ref = _extract_reference_from_pdf_tables(source)
        if table_ref:
            _apply_reference_section(conclusion, table_ref)
        table_risks = _extract_risks_from_pdf_tables(source)
        if table_risks:
            conclusion.risks = table_risks
    return conclusion
