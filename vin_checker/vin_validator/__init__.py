"""Проверка VIN по ISO 3779 с контролем написания."""

from .iso3779 import (
    VinValidationResult,
    calculate_check_digit,
    normalize_vin,
    validate_batch,
    validate_iso3779,
)
from .spelling import SpellingResult, check_spelling

__all__ = [
    "VinValidationResult",
    "SpellingResult",
    "calculate_check_digit",
    "normalize_vin",
    "validate_batch",
    "validate_iso3779",
    "check_spelling",
    "validate_full",
]

from dataclasses import dataclass, field


@dataclass
class FullValidationResult:
    """Результат полной проверки: написание + ISO 3779."""

    raw: str
    spelling: SpellingResult
    iso: VinValidationResult
    valid: bool

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "valid": self.valid,
            "spelling": self.spelling.to_dict(),
            "iso3779": self.iso.to_dict(),
        }


def validate_full(vin: str) -> FullValidationResult:
    spelling = check_spelling(vin)
    iso = validate_iso3779(vin)
    valid = spelling.spelling_ok and iso.valid
    return FullValidationResult(raw=vin, spelling=spelling, iso=iso, valid=valid)


def validate_full_batch(vins: list[str]) -> list[FullValidationResult]:
    return [validate_full(v) for v in vins]
