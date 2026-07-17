"""Декодирование VIN через NHTSA vPIC."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from vin_validator.iso3779 import normalize_vin

from .models import VehicleInfo

NHTSA_DECODE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json"
REQUEST_TIMEOUT = 12

_FIELD_MAP: dict[str, str] = {
    "Make": "make",
    "Model": "model",
    "Model Year": "model_year",
    "Manufacturer Name": "manufacturer",
    "Series": "series",
    "Trim": "trim",
    "Body Class": "body_class",
    "Vehicle Type": "vehicle_type",
    "Doors": "doors",
    "Drive Type": "drive_type",
    "Fuel Type - Primary": "fuel_type",
    "Engine Number of Cylinders": "engine_cylinders",
    "Displacement (L)": "displacement_l",
    "Engine Model": "engine_model",
    "Engine Configuration": "engine_configuration",
    "Transmission Style": "transmission_style",
    "Transmission Speeds": "transmission_speeds",
    "Plant Country": "plant_country",
    "Plant City": "plant_city",
    "Plant State": "plant_state",
    "Gross Vehicle Weight Rating From": "gvwr",
    "Error Code": "nhtsa_error_code",
    "Error Text": "nhtsa_error_text",
}

_EXTRA_LABELS: tuple[str, ...] = (
    "Vehicle Descriptor",
    "Series2",
    "Trim2",
    "Note",
    "Base Price ($)",
    "Windows",
    "Wheel Base (inches) From",
    "Curb Weight (pounds)",
    "Engine Brake (hp) From",
    "Fuel Type - Secondary",
    "Turbo",
    "Anti-lock Braking System (ABS)",
    "Electronic Stability Control (ESC)",
)


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("null", "not applicable", "n/a"):
        return None
    return text


def _http_get_json(url: str, timeout: int = REQUEST_TIMEOUT) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "vin-checker/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_nhtsa_row(raw_vin: str, variables: list[dict]) -> VehicleInfo:
    by_name: dict[str, str | None] = {}
    extra: dict[str, str] = {}

    for item in variables:
        name = item.get("Variable")
        if not name:
            continue
        val = _clean(item.get("Value"))
        by_name[name] = val
        if val and name in _EXTRA_LABELS:
            extra[name] = val

    normalized = normalize_vin(raw_vin)
    data: dict[str, str | None] = {}
    for nhtsa_name, attr in _FIELD_MAP.items():
        data[attr] = by_name.get(nhtsa_name)

    make = data.get("make")
    model = data.get("model")
    error_code = data.get("nhtsa_error_code")
    found = bool(make or model or data.get("model_year")) and error_code in (
        None,
        "0",
        "",
    )

    return VehicleInfo(
        vin=raw_vin,
        normalized=normalized,
        found=found,
        source="nhtsa",
        sources_used=["nhtsa"],
        make=make,
        model=model,
        model_year=data.get("model_year"),
        manufacturer=data.get("manufacturer"),
        series=data.get("series"),
        trim=data.get("trim"),
        body_class=data.get("body_class"),
        vehicle_type=data.get("vehicle_type"),
        doors=data.get("doors"),
        drive_type=data.get("drive_type"),
        fuel_type=data.get("fuel_type"),
        engine_cylinders=data.get("engine_cylinders"),
        displacement_l=data.get("displacement_l"),
        engine_model=data.get("engine_model"),
        engine_configuration=data.get("engine_configuration"),
        transmission_style=data.get("transmission_style"),
        transmission_speeds=data.get("transmission_speeds"),
        plant_country=data.get("plant_country"),
        plant_city=data.get("plant_city"),
        plant_state=data.get("plant_state"),
        gvwr=data.get("gvwr"),
        nhtsa_error_code=error_code,
        nhtsa_error_text=data.get("nhtsa_error_text"),
        extra=extra,
    )


def lookup_nhtsa(raw_vin: str, normalized: str) -> VehicleInfo:
    url = NHTSA_DECODE_URL.format(vin=urllib.parse.quote(normalized))
    try:
        payload = _http_get_json(url)
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        reason = getattr(exc, "reason", exc)
        return VehicleInfo(
            vin=raw_vin,
            normalized=normalized,
            found=False,
            source="nhtsa",
            sources_used=["nhtsa"],
            lookup_error=f"Таймаут или ошибка NHTSA: {reason}",
        )

    results = payload.get("Results") or []
    if not results:
        return VehicleInfo(
            vin=raw_vin,
            normalized=normalized,
            found=False,
            source="nhtsa",
            sources_used=["nhtsa"],
            lookup_error="NHTSA не вернула данных по этому VIN",
        )

    return _parse_nhtsa_row(raw_vin, results)
