"""Сервис поиска по VIN: drom + NHTSA (параллельно, максимум полей)."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

from vin_validator.iso3779 import VIN_LENGTH, normalize_vin

from .drom import drom_cooling_down, lookup_drom, lookup_drom_plate, rate_limited_result
from .models import VehicleInfo
from .nhtsa import lookup_nhtsa
from .sravni import lookup_sravni_plate
from .vin_corrections import find_corrected_vin, format_correction_message, is_rate_limited

DROM_TIMEOUT = int(os.environ.get("DROM_TIMEOUT", "35"))
SRAVNI_TIMEOUT = int(os.environ.get("SRAVNI_TIMEOUT", "25"))
NHTSA_TIMEOUT = int(os.environ.get("NHTSA_TIMEOUT", "15"))
VIN_CORRECTION_ENABLED = os.environ.get("VIN_CORRECTION", "1").lower() not in (
    "0",
    "false",
    "no",
)
# ponytail: NHTSA on by default; set USE_NHTSA=0 to disable
USE_NHTSA = os.environ.get("USE_NHTSA", "1").lower() not in ("0", "false", "no")


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


def _has_vehicle_data(info: VehicleInfo) -> bool:
    if not info.found:
        return False
    return bool(info.make or info.model or info.model_year or info.vehicle_type)


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
        if not getattr(base, name, None) and getattr(other, name, None):
            setattr(base, name, getattr(other, name))

    for key, value in (other.extra or {}).items():
        if value and key not in base.extra:
            base.extra[key] = value

    vin_from_other = (other.extra or {}).get("VIN") or (
        other.normalized if other.normalized and len(other.normalized) == 17 else None
    )
    if vin_from_other and len(str(vin_from_other)) == 17:
        if not base.extra.get("VIN"):
            base.extra["VIN"] = str(vin_from_other)
        if not base.normalized or len(base.normalized) != 17:
            base.normalized = str(vin_from_other)

    base.sources_used = list(
        dict.fromkeys([*(base.sources_used or []), *(other.sources_used or [])])
    )
    if not base.found and other.found:
        base.found = True
        base.lookup_error = None
        base.source = other.source
    return base


# ponytail: plate uses Sravni; drom plate off by default to avoid 429 (DROM_FOR_PLATE=1 to enable)
USE_DROM_PLATE = os.environ.get("DROM_FOR_PLATE", "0").lower() in ("1", "true", "yes")


def _enrich_by_vin(result: VehicleInfo, vin: str) -> VehicleInfo:
    """Дополняет карточку по VIN: drom + NHTSA."""
    normalized = normalize_vin(vin)
    if not drom_cooling_down():
        drom = _lookup_drom_timed(vin, normalized)
        if _has_vehicle_data(drom):
            result = _merge_vehicle(result, drom)
    if USE_NHTSA:
        nhtsa = _lookup_nhtsa_timed(vin, normalized)
        if _has_vehicle_data(nhtsa) or nhtsa.extra:
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

    # Госномер: Сравни. Drom — только по флагу и вне cooldown.
    sravni = lookup_sravni_plate(plate, normalized)
    drom = None
    if USE_DROM_PLATE and not drom_cooling_down():
        drom = _lookup_drom_plate_safe(plate, normalized)

    if _has_vehicle_data(sravni):
        result = _merge_vehicle(sravni, drom) if drom else sravni
    elif drom and _has_vehicle_data(drom):
        result = _merge_vehicle(drom, sravni)
    else:
        result = sravni if (sravni.lookup_error or not drom) else drom
        if drom and is_rate_limited(drom) and not result.lookup_error:
            result = drom
        if not result.lookup_error:
            result.lookup_error = "По этому госномеру данных о марке и модели не найдено"
        return result

    vin = result.extra.get("VIN") or (
        result.normalized if result.normalized and len(result.normalized) == 17 else None
    )
    if vin and len(str(vin)) == 17:
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
            )


def lookup_query(query: str, *, try_corrections: bool = True) -> VehicleInfo:
    from vin_validator.plate import is_probable_plate

    q = str(query or "").strip()
    if is_probable_plate(q):
        return lookup_plate(q)
    return lookup_vin(q, try_corrections=try_corrections)


def lookup_vin(vin: str, *, try_corrections: bool = True) -> VehicleInfo:
    pre = _preflight(vin)
    if pre:
        return pre

    normalized = normalize_vin(vin)

    # Сначала NHTSA (без лимита drom). Drom — только если NHTSA пуст и нет cooldown.
    nhtsa = _lookup_nhtsa_timed(vin, normalized) if USE_NHTSA else None
    if nhtsa and _has_vehicle_data(nhtsa):
        # ponytail: skip drom when NHTSA already enough; set DROM_ALWAYS=1 to always merge
        if os.environ.get("DROM_ALWAYS", "0").lower() not in ("1", "true", "yes"):
            nhtsa.found = True
            nhtsa.lookup_error = None
            return nhtsa
        if drom_cooling_down():
            nhtsa.found = True
            nhtsa.lookup_error = None
            return nhtsa

    if drom_cooling_down():
        if nhtsa and _has_vehicle_data(nhtsa):
            nhtsa.found = True
            nhtsa.lookup_error = None
            return nhtsa
        return rate_limited_result(vin, normalized)

    drom = _lookup_drom_timed(vin, normalized)

    if _has_vehicle_data(drom):
        result = _merge_vehicle(drom, nhtsa) if nhtsa else drom
        result.found = True
        result.lookup_error = None
        return result

    if nhtsa and _has_vehicle_data(nhtsa):
        result = _merge_vehicle(nhtsa, drom)
        result.found = True
        result.lookup_error = None
        return result

    if is_rate_limited(drom):
        return rate_limited_result(vin, normalized)

    base = drom if drom.lookup_error else (nhtsa or drom)
    if not base.lookup_error:
        base.lookup_error = "По этому VIN данных о марке и модели не найдено"

    if try_corrections and not is_rate_limited(base):
        return _attach_correction(base, vin, normalized)
    return base


def lookup_batch(queries: list[str]) -> list[VehicleInfo]:
    import time

    try_corrections = len(queries) == 1
    out: list[VehicleInfo] = []
    for i, q in enumerate(queries):
        if i:
            # ponytail: slow batch to reduce 429 from drom
            time.sleep(1.2 if not drom_cooling_down() else 0.3)
        out.append(lookup_query(q, try_corrections=try_corrections))
    return out
