"""Сервис поиска по VIN через Drom (быстро, без долгого NHTSA)."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

from vin_validator.iso3779 import VIN_LENGTH, normalize_vin

from .drom import lookup_drom, lookup_drom_plate
from .models import VehicleInfo
from .sravni import lookup_sravni_plate
from .vin_corrections import find_corrected_vin, format_correction_message, is_rate_limited

DROM_TIMEOUT = int(os.environ.get("DROM_TIMEOUT", "35"))
SRAVNI_TIMEOUT = int(os.environ.get("SRAVNI_TIMEOUT", "25"))
VIN_CORRECTION_ENABLED = os.environ.get("VIN_CORRECTION", "1").lower() not in (
    "0",
    "false",
    "no",
)
USE_NHTSA_FALLBACK = os.environ.get("USE_NHTSA_FALLBACK", "").lower() in (
    "1",
    "true",
    "yes",
)


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


def _lookup_sravni_plate_timed(plate: str, normalized: str) -> VehicleInfo:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lookup_sravni_plate, plate, normalized)
        try:
            return future.result(timeout=SRAVNI_TIMEOUT)
        except FuturesTimeout:
            return VehicleInfo(
                vin=plate,
                normalized=normalized,
                found=False,
                source="sravni",
                sources_used=["sravni"],
                lookup_error=f"Превышено время ожидания Сравни ({SRAVNI_TIMEOUT} с).",
            )


def _lookup_drom_plate_timed(plate: str, normalized: str) -> VehicleInfo:
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
                lookup_error=f"Превышено время ожидания ({DROM_TIMEOUT} с). Повторите позже.",
            )


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

    # Основной источник госномера — Сравни; drom — запасной, если превью пустое.
    result = _lookup_sravni_plate_timed(plate, normalized)
    if _has_vehicle_data(result):
        return result

    fallback = _lookup_drom_plate_timed(plate, normalized)
    if _has_vehicle_data(fallback):
        fallback.sources_used = list(
            dict.fromkeys([*(result.sources_used or []), *(fallback.sources_used or [])])
        )
        return fallback

    if result.lookup_error:
        return result
    if fallback.lookup_error:
        return fallback
    result.lookup_error = "По этому госномеру данных о марке и модели не найдено"
    return result


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
    drom = _lookup_drom_timed(vin, normalized)
    if _has_vehicle_data(drom):
        return drom

    if USE_NHTSA_FALLBACK:
        from .nhtsa import lookup_nhtsa

        nhtsa = lookup_nhtsa(vin, normalized)
        if _has_vehicle_data(nhtsa):
            return nhtsa
        if drom.lookup_error:
            base = drom
        else:
            base = nhtsa
        if try_corrections:
            return _attach_correction(base, vin, normalized)
        return base

    if not drom.lookup_error:
        drom.lookup_error = "По этому VIN данных о марке и модели не найдено"

    if try_corrections and not is_rate_limited(drom):
        return _attach_correction(drom, vin, normalized)
    return drom


def lookup_batch(queries: list[str]) -> list[VehicleInfo]:
    import time

    try_corrections = len(queries) == 1
    out: list[VehicleInfo] = []
    for i, q in enumerate(queries):
        if i:
            time.sleep(0.5)
        out.append(lookup_query(q, try_corrections=try_corrections))
    return out
