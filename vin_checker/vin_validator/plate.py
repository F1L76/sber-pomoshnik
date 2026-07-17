"""Нормализация российского госномера (ГРЗ)."""

from __future__ import annotations

import re

# Допустимые буквы на номерных знаках РФ (кириллица)
_PLATE_LETTERS = "АВЕКМНОРСТУХ"
_LATIN_TO_CYR = str.maketrans("ABEKMHOPCTYX", _PLATE_LETTERS)
_PLATE_RE = re.compile(rf"^[{_PLATE_LETTERS}]\d{{3}}[{_PLATE_LETTERS}]{{2}}\d{{2,3}}$")


def normalize_plate(raw: str) -> str:
    s = str(raw or "").upper().strip()
    for ch in (" ", "-", "_", ".", "|"):
        s = s.replace(ch, "")
    if s.endswith("RUS"):
        s = s[:-3]
    s = s.translate(_LATIN_TO_CYR)
    return s


def is_probable_plate(raw: str) -> bool:
    n = normalize_plate(raw)
    if _PLATE_RE.fullmatch(n):
        return True
    if 7 <= len(n) <= 9 and any(c in _PLATE_LETTERS for c in n):
        return not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", n)
    return False


def plate_error(normalized: str) -> str | None:
    if not normalized:
        return "Госномер не указан"
    if len(normalized) < 7 or len(normalized) > 9:
        return f"Госномер должен содержать 7–9 символов (сейчас {len(normalized)})"
    if not _PLATE_RE.fullmatch(normalized):
        return "Неверный формат госномера (пример: А123АА77)"
    return None


if __name__ == "__main__":
    assert normalize_plate("a123aa77") == "А123АА77"
    assert normalize_plate("А123АА77 RUS") == "А123АА77"
    assert is_probable_plate("А123АА77")
    assert plate_error("А123АА77") is None
    print("plate self-check ok")
