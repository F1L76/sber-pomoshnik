"""Валидация VIN по ISO 3779 (структура, допустимые символы, контрольная цифра)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable

VIN_LENGTH = 17

# Символы, запрещённые в VIN (путаница с 0 и 1)
FORBIDDEN_CHARS = frozenset("IOQ")

# Допустимые символы: цифры и латиница без I, O, Q
ALLOWED_CHARS = frozenset(
    "0123456789ABCDEFGHJKLMNPRSTUVWXYZ"
)

# Визуальные двойники (скопировали VIN «на глаз» кириллицей)
_CYR_LOOKALIKE: dict[str, str] = {
    "А": "A",
    "В": "B",
    "С": "C",
    "Е": "E",
    "Н": "H",
    "К": "K",
    "М": "M",
    "О": "0",  # в VIN нет O
    "Р": "P",
    "Т": "T",
    "У": "Y",
    "Х": "X",
    "І": "1",  # украинская I → ближе к 1 (I запрещена)
    "З": "3",
}

# ЙЦУКЕН → QWERTY: та же физическая клавиша при ошибочной раскладке
_CYR_LAYOUT: dict[str, str] = {
    "Й": "Q",
    "Ц": "W",
    "У": "E",
    "К": "R",
    "Е": "T",
    "Н": "Y",
    "Г": "U",
    "Ш": "I",
    "Щ": "O",
    "З": "P",
    "Х": "[",
    "Ъ": "]",
    "Ф": "A",
    "Ы": "S",
    "В": "D",
    "А": "F",
    "П": "G",
    "Р": "H",
    "О": "J",
    "Л": "K",
    "Д": "L",
    "Ж": ";",
    "Э": "'",
    "Я": "Z",
    "Ч": "X",
    "С": "C",
    "М": "V",
    "И": "B",
    "Т": "N",
    "Ь": "M",
    "Б": ",",
    "Ю": ".",
    "Ё": "`",
}

# Буквы без латинского «двойника» VIN — признак ошибочной раскладки
_LAYOUT_MARKERS = frozenset("ЙЦГШЩЗЪФЫПЛДЖЭЯЧИЬБЮЁ")


def fix_cyrillic_keyboard(text: str) -> str:
    """
    Кириллица → латиница для VIN.
    Если есть буквы вроде Й/Ц/Ф — считаем ошибкой раскладки (ЙЦУКЕН→QWERTY),
    иначе — визуальные двойники (А→A, Х→X, …).
    """
    if not text or not any(ord(c) > 127 for c in text):
        return text
    use_layout = any(c.upper() in _LAYOUT_MARKERS for c in text)
    table = _CYR_LAYOUT if use_layout else _CYR_LOOKALIKE
    out: list[str] = []
    for ch in text:
        up = ch.upper()
        if up in table:
            out.append(table[up])
        elif ch.lower() != ch and ch.upper() in table:
            out.append(table[ch.upper()])
        else:
            # строчные кириллические
            up2 = ch.upper()
            if up2 in table:
                out.append(table[up2])
            else:
                out.append(ch)
    return "".join(out)


# Транслитерация для расчёта контрольной цифры (позиция 9)
_TRANSLITERATION: dict[str, int] = {
    "A": 1,
    "B": 2,
    "C": 3,
    "D": 4,
    "E": 5,
    "F": 6,
    "G": 7,
    "H": 8,
    "J": 1,
    "K": 2,
    "L": 3,
    "M": 4,
    "N": 5,
    "P": 7,
    "R": 9,
    "S": 2,
    "T": 3,
    "U": 4,
    "V": 5,
    "W": 6,
    "X": 7,
    "Y": 8,
    "Z": 9,
    "0": 0,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
}

# Веса по позициям 1–17 (ISO 3779 / SAE J853)
_POSITION_WEIGHTS: tuple[int, ...] = (
    8,
    7,
    6,
    5,
    4,
    3,
    2,
    10,
    0,
    9,
    8,
    7,
    6,
    5,
    4,
    3,
    2,
)

CHECK_DIGIT_POSITION = 9  # 1-based


class IssueCode(str, Enum):
    EMPTY = "empty"
    WRONG_LENGTH = "wrong_length"
    INVALID_CHAR = "invalid_char"
    FORBIDDEN_CHAR = "forbidden_char"
    CHECK_DIGIT = "check_digit"
    NON_ASCII = "non_ascii"


@dataclass(frozen=True)
class VinIssue:
    code: IssueCode
    message: str
    position: int | None = None  # 1-based, как в стандарте


@dataclass
class VinValidationResult:
    raw: str
    normalized: str
    valid: bool
    issues: list[VinIssue] = field(default_factory=list)
    check_digit_expected: str | None = None
    check_digit_actual: str | None = None
    wmi: str | None = None
    vds: str | None = None
    vis: str | None = None

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "normalized": self.normalized,
            "valid": self.valid,
            "issues": [
                {
                    "code": i.code.value,
                    "message": i.message,
                    "position": i.position,
                }
                for i in self.issues
            ],
            "check_digit_expected": self.check_digit_expected,
            "check_digit_actual": self.check_digit_actual,
            "wmi": self.wmi,
            "vds": self.vds,
            "vis": self.vis,
        }


def normalize_vin(vin: str) -> str:
    """Кириллица→латиница (раскладка/двойники), верхний регистр, без пробелов и дефисов."""
    fixed = fix_cyrillic_keyboard(vin or "")
    return "".join(fixed.upper().split()).replace("-", "")


def calculate_check_digit(vin: str) -> str | None:
    """
    Расчёт контрольной цифры для позиции 9.
    Возвращает None, если VIN не содержит только допустимых символов нужной длины.
    """
    normalized = normalize_vin(vin)
    if len(normalized) != VIN_LENGTH:
        return None

    total = 0
    for i, char in enumerate(normalized):
        if char not in _TRANSLITERATION:
            return None
        total += _TRANSLITERATION[char] * _POSITION_WEIGHTS[i]

    remainder = total % 11
    return "X" if remainder == 10 else str(remainder)


def _split_sections(normalized: str) -> tuple[str | None, str | None, str | None]:
    if len(normalized) != VIN_LENGTH:
        return None, None, None
    return normalized[0:3], normalized[3:9], normalized[9:17]


def validate_iso3779(vin: str) -> VinValidationResult:
    """Полная проверка VIN на соответствие ISO 3779."""
    raw = vin
    issues: list[VinIssue] = []

    if not raw or not raw.strip():
        return VinValidationResult(
            raw=raw,
            normalized="",
            valid=False,
            issues=[
                VinIssue(
                    code=IssueCode.EMPTY,
                    message="VIN не указан",
                )
            ],
        )

    stripped = raw.strip()
    normalized = normalize_vin(raw)

    # Кириллица уже поправлена в normalize_vin; ругаемся только если остались «левые» символы
    if any(ord(c) > 127 for c in normalized):
        issues.append(
            VinIssue(
                code=IssueCode.NON_ASCII,
                message="Обнаружены недопустимые не-ASCII символы",
            )
        )

    if len(normalized) != VIN_LENGTH:
        issues.append(
            VinIssue(
                code=IssueCode.WRONG_LENGTH,
                message=f"Длина VIN должна быть {VIN_LENGTH} символов, получено {len(normalized)}",
            )
        )

    for pos, char in enumerate(normalized, start=1):
        upper = char.upper()
        if upper in FORBIDDEN_CHARS:
            issues.append(
                VinIssue(
                    code=IssueCode.FORBIDDEN_CHAR,
                    message=f"Символ «{upper}» запрещён в VIN (позиция {pos})",
                    position=pos,
                )
            )
        elif upper not in ALLOWED_CHARS:
            issues.append(
                VinIssue(
                    code=IssueCode.INVALID_CHAR,
                    message=f"Недопустимый символ «{char}» (позиция {pos})",
                    position=pos,
                )
            )

    check_expected: str | None = None
    check_actual: str | None = None

    if len(normalized) == VIN_LENGTH and not any(
        i.code in (IssueCode.FORBIDDEN_CHAR, IssueCode.INVALID_CHAR) for i in issues
    ):
        check_expected = calculate_check_digit(normalized)
        check_actual = normalized[CHECK_DIGIT_POSITION - 1]
        if check_expected is not None and check_actual != check_expected:
            issues.append(
                VinIssue(
                    code=IssueCode.CHECK_DIGIT,
                    message=(
                        f"Неверная контрольная цифра в позиции {CHECK_DIGIT_POSITION}: "
                        f"ожидается «{check_expected}», указано «{check_actual}»"
                    ),
                    position=CHECK_DIGIT_POSITION,
                )
            )

    wmi, vds, vis = _split_sections(normalized)
    valid = len(issues) == 0

    return VinValidationResult(
        raw=raw,
        normalized=normalized,
        valid=valid,
        issues=issues,
        check_digit_expected=check_expected,
        check_digit_actual=check_actual,
        wmi=wmi,
        vds=vds,
        vis=vis,
    )


def validate_batch(vins: Iterable[str]) -> list[VinValidationResult]:
    """Групповая проверка списка VIN."""
    return [validate_iso3779(v) for v in vins]


def _self_check() -> None:
    # визуальные двойники
    assert normalize_vin("ХТА219010С0123456") == "XTA219010C0123456"
    # ошибочная раскладка: XWF0AHL35D0011102 → чца0фрд35в0011102
    assert normalize_vin("чца0фрд35в0011102") == "XWF0AHL35D0011102"
    print("iso3779 keyboard self-check ok")


if __name__ == "__main__":
    _self_check()

