"""Сервис поиска по VIN: онлайн-базы (drom + NHTSA)."""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

from vin_validator.iso3779 import VIN_LENGTH, normalize_vin

from .drom import (
    cooldown_remaining,
    drom_cooling_down,
    lookup_drom,
    lookup_drom_plate,
)
from .autoru import lookup_autoru_plate
from .models import VehicleInfo
from .nhtsa import lookup_nhtsa
from .sravni import lookup_sravni_plate
from .vin_corrections import find_corrected_vin, format_correction_message, is_rate_limited

DROM_TIMEOUT = int(os.environ.get("DROM_TIMEOUT", "45"))
SRAVNI_TIMEOUT = int(os.environ.get("SRAVNI_TIMEOUT", "25"))
AUTORU_TIMEOUT = int(os.environ.get("AUTORU_TIMEOUT", "30"))
NHTSA_TIMEOUT = int(os.environ.get("NHTSA_TIMEOUT", "8"))
# Сколько максимум ждать снятия cooldown, чтобы всё же сходить в онлайн-базу
DROM_WAIT_COOLDOWN = float(os.environ.get("DROM_WAIT_COOLDOWN", "90"))
VIN_CORRECTION_ENABLED = os.environ.get("VIN_CORRECTION", "0").lower() not in (
    "0",
    "false",
    "no",
)
USE_NHTSA = os.environ.get("USE_NHTSA", "1").lower() not in ("0", "false", "no")
USE_DROM_VIN = os.environ.get("DROM_FOR_VIN", "1").lower() not in ("0", "false", "no")


def _preflight(vin: str) -> VehicleInfo | None:
    normalized = normalize_vin(vin)
    if len(normalized) != VIN_LENGTH:
        return VehicleInfo(
            vin=vin,
            normalized=normalized,
            found=False,
            lookup_error=f"VIN должен содержать {VIN_LENGTH} символов (сейчас {len(normalized)})",
        )
    return None


def _lookup_drom_timed(vin: str, normalized: str) -> VehicleInfo:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lookup_drom, vin, normalized)
        try:
            return future.result(timeout=DROM_TIMEOUT)
        except FuturesTimeout:
            return VehicleInfo(
                vin=vin,
                normalized=normalized,
                found=False,
                source="drom",
                sources_used=["drom"],
                lookup_error=f"Превышено время ожидания ({DROM_TIMEOUT} с). Повторите позже.",
            )


def _lookup_nhtsa_timed(vin: str, normalized: str) -> VehicleInfo:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lookup_nhtsa, vin, normalized)
        try:
            return future.result(timeout=NHTSA_TIMEOUT)
        except FuturesTimeout:
            return VehicleInfo(
                vin=vin,
                normalized=normalized,
                found=False,
                source="nhtsa",
                sources_used=["nhtsa"],
            )


def _has_vehicle_data(info: VehicleInfo | None) -> bool:
    if not info:
        return False
    return bool(info.make or info.model or info.model_year or info.vehicle_type)


def _wait_drom_cooldown() -> None:
    """Если база в cooldown — подождать (с потолком), затем пробовать онлайн."""
    wait = cooldown_remaining()
    if wait > 0:
        time.sleep(min(wait, DROM_WAIT_COOLDOWN))


def _attach_correction(
    result: VehicleInfo, raw_vin: str, normalized: str
) -> VehicleInfo:
    if not VIN_CORRECTION_ENABLED:
        return result
    suggested = find_corrected_vin(raw_vin, normalized, _lookup_drom_timed)
    if not suggested or not _has_vehicle_data(suggested):
        return result
    result.suggested_vin = suggested.normalized
    result.vin_correction_message = format_correction_message(
        raw_vin, suggested.normalized, suggested
    )
    result.lookup_error = None
    return result


def _merge_vehicle(base: VehicleInfo, other: VehicleInfo) -> VehicleInfo:
    """Дополняет base полями из other (пустое ← другое)."""
    if not other:
        return base
    if not other.found and not (other.extra or other.make or other.model):
        if other.sources_used:
            base.sources_used = list(
                dict.fromkeys([*(base.sources_used or []), *other.sources_used])
            )
        return base

    fields = (
        "make",
        "model",
        "model_year",
        "manufacturer",
        "series",
        "trim",
        "body_class",
        "vehicle_type",
        "doors",
        "drive_type",
        "fuel_type",
        "color",
        "category",
        "body_number",
        "engine_number",
        "power_hp",
        "power_kw",
        "engine_cylinders",
        "displacement_l",
        "engine_model",
        "engine_configuration",
        "transmission_style",
        "transmission_speeds",
        "plant_country",
        "plant_city",
        "plant_state",
        "gvwr",
    )
    for name in fields:
        if not getattr(base, name) and getattr(other, name):
            setattr(base, name, getattr(other, name))
    if other.extra:
        merged = dict(base.extra or {})
        for k, v in other.extra.items():
            merged.setdefault(k, v)
        base.extra = merged
    base.sources_used = list(
        dict.fromkeys([*(base.sources_used or []), *(other.sources_used or [])])
    )
    if not base.found and other.found:
        base.found = True
        base.lookup_error = None
        base.source = other.source
    return base


# ponytail: drom по госномеру как fallback; DROM_FOR_PLATE=1 — всегда вместе со Сравни
USE_DROM_PLATE = os.environ.get("DROM_FOR_PLATE", "0").lower() in ("1", "true", "yes")
USE_AUTORU_PLATE = os.environ.get("AUTORU_FOR_PLATE", "1").lower() not in ("0", "false", "no")


def _is_soft_miss(info: VehicleInfo | None) -> bool:
    """Пустой ответ источника (не сеть/429) — можно пробовать следующий."""
    if not info or _has_vehicle_data(info):
        return False
    err = (info.lookup_error or "").lower()
    if "429" in err or "недоступен" in err or "сети" in err or "таймаут" in err:
        return False
    return True


def _enrich_by_vin(result: VehicleInfo, vin: str) -> VehicleInfo:
    """Дополняет карточку по VIN из онлайн-баз."""
    normalized = normalize_vin(vin)
    if USE_DROM_VIN:
        if drom_cooling_down():
            _wait_drom_cooldown()
        if not drom_cooling_down():
            drom = _lookup_drom_timed(vin, normalized)
            if _has_vehicle_data(drom):
                result = _merge_vehicle(result, drom)
    if USE_NHTSA:
        nhtsa = _lookup_nhtsa_timed(vin, normalized)
        if _has_vehicle_data(nhtsa) or (nhtsa and nhtsa.extra):
            result = _merge_vehicle(result, nhtsa)
    return result


def lookup_plate(plate: str) -> VehicleInfo:
    from vin_validator.plate import normalize_plate, plate_error

    normalized = normalize_plate(plate)
    err = plate_error(normalized)
    if err:
        return VehicleInfo(
            vin=plate,
            normalized=normalized,
            found=False,
            lookup_error=err,
        )

    # цепочка: Сравни → Авто.ру → drom; следующий только если на предыдущем пусто
    attempts: list[VehicleInfo] = []
    result: VehicleInfo | None = None

    sravni = lookup_sravni_plate(plate, normalized)
    attempts.append(sravni)
    if _has_vehicle_data(sravni):
        result = sravni

    if result is None and USE_AUTORU_PLATE:
        autoru = _lookup_autoru_plate_safe(plate, normalized)
        attempts.append(autoru)
        if _has_vehicle_data(autoru):
            result = autoru

    if result is None or USE_DROM_PLATE:
        if not drom_cooling_down():
            drom = _lookup_drom_plate_safe(plate, normalized)
            attempts.append(drom)
            if _has_vehicle_data(drom):
                result = _merge_vehicle(result, drom) if result else drom

    if result is None:
        result = next((a for a in attempts if a and is_rate_limited(a)), None)
        if result is None:
            result = next(
                (a for a in attempts if a and a.lookup_error and not _is_soft_miss(a)),
                None,
            )
        if result is None:
            result = next((a for a in reversed(attempts) if a and a.lookup_error), None)
        if result is None:
            result = VehicleInfo(vin=plate, normalized=normalized, found=False)
        if not result.lookup_error:
            result.lookup_error = "По этому госномеру данных о марке и модели не найдено"
        return result

    vin = result.extra.get("VIN") or (
        result.normalized if result.normalized and len(result.normalized) == 17 else None
    )
    if vin and len(str(vin)) == 17 and "*" not in str(vin):
        result = _enrich_by_vin(result, str(vin))

    result.found = True
    result.lookup_error = None
    return result


def _lookup_drom_plate_safe(plate: str, normalized: str) -> VehicleInfo:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lookup_drom_plate, plate, normalized)
        try:
            return future.result(timeout=DROM_TIMEOUT)
        except FuturesTimeout:
            return VehicleInfo(
                vin=plate,
                normalized=normalized,
                found=False,
                source="drom",
                sources_used=["drom"],
                lookup_error=f"Превышено время ожидания drom ({DROM_TIMEOUT} с)",
            )


def _lookup_autoru_plate_safe(plate: str, normalized: str) -> VehicleInfo:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lookup_autoru_plate, plate, normalized)
        try:
            return future.result(timeout=AUTORU_TIMEOUT)
        except FuturesTimeout:
            return VehicleInfo(
                vin=plate,
                normalized=normalized,
                found=False,
                source="autoru",
                sources_used=["autoru"],
                lookup_error=f"Превышено время ожидания Авто.ру ({AUTORU_TIMEOUT} с)",
            )


def lookup_query(query: str, *, try_corrections: bool = True) -> VehicleInfo:
    from vin_validator.plate import is_probable_plate

    q = str(query or "").strip()
    if is_probable_plate(q):
        return lookup_plate(q)
    return lookup_vin(q, try_corrections=try_corrections)


def lookup_vin(vin: str, *, try_corrections: bool = True) -> VehicleInfo:
    """Онлайн-поиск по VIN в базах (drom / NHTSA). Без локального WMI."""
    pre = _preflight(vin)
    if pre:
        return pre

    normalized = normalize_vin(vin)

    nhtsa = _lookup_nhtsa_timed(vin, normalized) if USE_NHTSA else None

    drom = None
    if USE_DROM_VIN:
        if drom_cooling_down():
            _wait_drom_cooldown()
        drom = _lookup_drom_timed(vin, normalized)

    if drom and _has_vehicle_data(drom):
        result = _merge_vehicle(drom, nhtsa) if nhtsa else drom
        result.found = True
        result.lookup_error = None
        return result

    if nhtsa and _has_vehicle_data(nhtsa):
        result = nhtsa if not drom else _merge_vehicle(nhtsa, drom)
        result.found = True
        result.lookup_error = None
        return result

    if drom and is_rate_limited(drom):
        return drom

    base = drom if (drom and drom.lookup_error) else (
        nhtsa
        if nhtsa
        else VehicleInfo(
            vin=vin,
            normalized=normalized,
            found=False,
            lookup_error="По этому VIN данных о марке и модели не найдено",
        )
    )
    if not base.lookup_error:
        base.lookup_error = "По этому VIN данных о марке и модели не найдено"

    if try_corrections and not is_rate_limited(base):
        return _attach_correction(base, vin, normalized)
    return base


def lookup_batch(queries: list[str]) -> list[VehicleInfo]:
    try_corrections = len(queries) == 1
    out: list[VehicleInfo] = []
    for i, q in enumerate(queries):
        if i:
            # ponytail: slow batch to reduce 429 from drom
            time.sleep(1.2 if not drom_cooling_down() else 0.3)
        out.append(lookup_query(q, try_corrections=try_corrections))
    return out
