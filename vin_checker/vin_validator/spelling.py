"""Проверка правильности написания VIN (опечатки, регистр, похожие символы)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .iso3779 import FORBIDDEN_CHARS, VIN_LENGTH, normalize_vin

# Кириллица, часто путаемая с латиницей при вводе
_CYRILLIC_TO_LATIN: dict[str, str] = {
    "А": "A",
    "В": "B",
    "С": "C",
    "Е": "E",
    "Н": "H",
    "К": "K",
    "М": "M",
    "О": "0",  # в VIN буква O запрещена → цифра 0
    "Р": "P",
    "Т": "T",
    "У": "Y",
    "Х": "X",
    "І": "I",  # украинская I — в VIN запрещена
    "З": "3",
    "Ь": "b",
    "Д": "D",
    "Г": "G",
    "Л": "L",
    "П": "P",
    "Ф": "F",
    "Ц": "C",
    "Ч": "4",
    "Ш": "W",
    "Щ": "W",
    "Ы": "Y",
    "Э": "E",
    "Ю": "U",
    "Я": "R",
}

# Типичные замены при опечатках (латиница)
_LATIN_CONFUSABLES: dict[str, str] = {
    "I": "1",
    "O": "0",
    "Q": "0",
    "l": "1",  # lowercase L
    "o": "0",
    "i": "1",
    "q": "0",
}


class SpellingCode(str, Enum):
    LOWERCASE = "lowercase"
    WHITESPACE = "whitespace"
    SEPARATORS = "separators"
    CYRILLIC = "cyrillic"
    CONFUSABLE = "confusable"
    FORBIDDEN_LETTER = "forbidden_letter"
    EXTRA_CHARS = "extra_chars"
    SUGGESTION = "suggestion"


@dataclass(frozen=True)
class SpellingIssue:
    code: SpellingCode
    message: str
    position: int | None = None
    suggestion: str | None = None


@dataclass
class SpellingResult:
    raw: str
    normalized: str
    suggested: str | None
    spelling_ok: bool
    issues: list[SpellingIssue] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "normalized": self.normalized,
            "suggested": self.suggested,
            "spelling_ok": self.spelling_ok,
            "issues": [
                {
                    "code": i.code.value,
                    "message": i.message,
                    "position": i.position,
                    "suggestion": i.suggestion,
                }
                for i in self.issues
            ],
        }


def _build_suggested(chars: list[str]) -> str:
    return "".join(chars)


def check_spelling(vin: str) -> SpellingResult:
    """
    Проверка написания: регистр, пробелы, кириллица, путаница I/O/Q и похожих символов.
    """
    raw = vin
    issues: list[SpellingIssue] = []

    if not raw or not raw.strip():
        return SpellingResult(
            raw=raw,
            normalized="",
            suggested=None,
            spelling_ok=False,
            issues=[],
        )

    if raw != raw.upper():
        issues.append(
            SpellingIssue(
                code=SpellingCode.LOWERCASE,
                message="VIN должен записываться заглавными латинскими буквами и цифрами",
            )
        )

    if any(c.isspace() for c in raw):
        issues.append(
            SpellingIssue(
                code=SpellingCode.WHITESPACE,
                message="VIN не должен содержать пробелы",
            )
        )

    if "-" in raw:
        issues.append(
            SpellingIssue(
                code=SpellingCode.SEPARATORS,
                message="VIN не должен содержать дефисы",
            )
        )

    # Посимвольный разбор исходной строки (без предварительной нормализации)
    working: list[str] = []
    changed = False

    core = raw.strip().replace("-", "").replace(" ", "")
    for pos, char in enumerate(core, start=1):
        if char in _CYRILLIC_TO_LATIN:
            replacement = _CYRILLIC_TO_LATIN[char]
            issues.append(
                SpellingIssue(
                    code=SpellingCode.CYRILLIC,
                    message=f"Кириллический символ «{char}» в позиции {pos}",
                    position=pos,
                    suggestion=replacement,
                )
            )
            working.append(replacement)
            changed = True
            continue

        if char in _LATIN_CONFUSABLES:
            replacement = _LATIN_CONFUSABLES[char]
            code = (
                SpellingCode.FORBIDDEN_LETTER
                if char.upper() in FORBIDDEN_CHARS
                else SpellingCode.CONFUSABLE
            )
            msg = (
                f"Запрещённая буква «{char}» в позиции {pos} (в VIN используйте «{replacement}»)"
                if char.upper() in FORBIDDEN_CHARS
                else f"Символ «{char}» похож на «{replacement}» (позиция {pos})"
            )
            issues.append(
                SpellingIssue(
                    code=code,
                    message=msg,
                    position=pos,
                    suggestion=replacement,
                )
            )
            working.append(replacement)
            changed = True
            continue

        working.append(char.upper() if char.isalpha() else char)

    suggested = _build_suggested(working) if changed else None
    normalized = normalize_vin(raw)

    if suggested and len(suggested) == VIN_LENGTH and suggested != normalized:
        issues.append(
            SpellingIssue(
                code=SpellingCode.SUGGESTION,
                message=f"Возможный исправленный VIN: {suggested}",
                suggestion=suggested,
            )
        )

    # Лишние символы после нормализации
    if len(normalized) > VIN_LENGTH:
        issues.append(
            SpellingIssue(
                code=SpellingCode.EXTRA_CHARS,
                message=f"Лишние символы: длина {len(normalized)} вместо {VIN_LENGTH}",
            )
        )

    spelling_ok = len(issues) == 0

    return SpellingResult(
        raw=raw,
        normalized=normalized,
        suggested=suggested,
        spelling_ok=spelling_ok,
        issues=issues,
    )
