"""Подбор исправленного VIN при типичных опечатках (не более 3 замен)."""

from __future__ import annotations

import os
from collections import deque
from typing import Callable, Iterator

from vin_validator.iso3779 import ALLOWED_CHARS, VIN_LENGTH, normalize_vin

from .models import VehicleInfo

# Частые путаницы при вводе/OCR (только допустимые символы VIN)
CONFUSION_GROUPS: tuple[frozenset[str], ...] = (
    frozenset("8B"),  # 8 ↔ B (часто путают с похожими символами)
    frozenset("NH"),
    frozenset("PR"),
    frozenset("VW"),
    frozenset("MN"),
    frozenset("69"),
    frozenset("50"),  # 5 ↔ 0
    frozenset("2Z"),
)

MAX_EDITS = int(os.environ.get("VIN_CORRECTION_MAX_EDITS", "3"))
MAX_LOOKUPS = int(os.environ.get("VIN_CORRECTION_MAX_LOOKUPS", "12"))
CORRECTION_DELAY = float(os.environ.get("VIN_CORRECTION_DELAY", "0.8"))


def is_rate_limited(info: VehicleInfo) -> bool:
    err = (info.lookup_error or "").lower()
    return (
        "429" in err
        or "слишком много запросов" in err
        or "временно ограничил" in err
    )


def _build_alt_map() -> dict[str, frozenset[str]]:
    alts: dict[str, set[str]] = {}
    for group in CONFUSION_GROUPS:
        if len(group) < 2:
            continue
        for ch in group:
            if ch not in ALLOWED_CHARS:
                continue
            alts.setdefault(ch, set()).update(
                c for c in group if c != ch and c in ALLOWED_CHARS
            )
    return {k: frozenset(v) for k, v in alts.items()}


_ALT_MAP = _build_alt_map()


def iter_correction_candidates(normalized: str, max_edits: int = MAX_EDITS) -> Iterator[str]:
    """
    Кандидаты в порядке возрастания числа замен (BFS), не более max_edits.
    """
    vin = normalize_vin(normalized)
    if len(vin) != VIN_LENGTH:
        return

    seen: set[str] = {vin}
    queue: deque[tuple[str, int]] = deque([(vin, 0)])

    while queue:
        current, dist = queue.popleft()
        if dist > 0:
            yield current
        if dist >= max_edits:
            continue
        for i, ch in enumerate(current):
            for alt in _ALT_MAP.get(ch, ()):
                candidate = current[:i] + alt + current[i + 1 :]
                if candidate not in seen:
                    seen.add(candidate)
                    queue.append((candidate, dist + 1))


def _edit_distance(a: str, b: str) -> int:
    return sum(1 for x, y in zip(a, b) if x != y)


def _has_vehicle_data(info: VehicleInfo) -> bool:
    if not info.found:
        return False
    return bool(info.make or info.model or info.model_year or info.vehicle_type)


def format_correction_message(
    original_vin: str,
    suggested_vin: str,
    suggested: VehicleInfo,
) -> str:
    title = suggested.title
    edits = _edit_distance(normalize_vin(original_vin), suggested_vin)
    edit_note = f" (исправлено символов: {edits})" if edits else ""
    return (
        f"Возможно, в VIN номере ошибка. "
        f"Возможно, правильный номер: {suggested_vin} — "
        f"по нему найдена информация: {title}.{edit_note}"
    )


def find_corrected_vin(
    raw_vin: str,
    normalized: str,
    lookup_fn: Callable[[str, str], VehicleInfo],
) -> VehicleInfo | None:
    """
    Перебирает близкие VIN; lookup_fn(raw_vin, candidate_normalized) — запрос к источнику.
    """
    import time

    lookups = 0
    for candidate in iter_correction_candidates(normalized):
        if lookups >= MAX_LOOKUPS:
            break
        if lookups:
            time.sleep(CORRECTION_DELAY)
        lookups += 1
        result = lookup_fn(raw_vin, candidate)
        if is_rate_limited(result):
            return None
        if _has_vehicle_data(result):
            return result
    return None
