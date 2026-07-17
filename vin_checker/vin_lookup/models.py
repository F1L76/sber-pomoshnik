"""Модели результата поиска по VIN."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class GibddChecks:
    """Данные проверок ГИБДД (ограничения, розыск, ДТП)."""

    restrictions_count: int = 0
    restrictions: list[dict[str, Any]] = field(default_factory=list)
    wanted_count: int = 0
    wanted_records: list[dict[str, Any]] = field(default_factory=list)
    accidents_count: int = 0
    accidents: list[dict[str, Any]] = field(default_factory=list)
    ownership_periods: list[dict[str, Any]] = field(default_factory=list)
    utilisation: bool | None = None
    pts_number: str | None = None
    messages: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "restrictions_count": self.restrictions_count,
            "restrictions": self.restrictions,
            "wanted_count": self.wanted_count,
            "wanted_records": self.wanted_records,
            "accidents_count": self.accidents_count,
            "accidents": self.accidents,
            "ownership_periods": self.ownership_periods,
            "utilisation": self.utilisation,
            "pts_number": self.pts_number,
            "messages": self.messages,
        }


@dataclass
class VehicleInfo:
    vin: str
    normalized: str
    found: bool
    source: str = "nhtsa"
    sources_used: list[str] = field(default_factory=list)

    make: str | None = None
    model: str | None = None
    model_year: str | None = None
    manufacturer: str | None = None
    series: str | None = None
    trim: str | None = None
    body_class: str | None = None
    vehicle_type: str | None = None
    doors: str | None = None
    drive_type: str | None = None
    fuel_type: str | None = None
    color: str | None = None
    category: str | None = None
    body_number: str | None = None
    engine_number: str | None = None
    power_hp: str | None = None
    power_kw: str | None = None

    engine_cylinders: str | None = None
    displacement_l: str | None = None
    engine_model: str | None = None
    engine_configuration: str | None = None
    transmission_style: str | None = None
    transmission_speeds: str | None = None
    plant_country: str | None = None
    plant_city: str | None = None
    plant_state: str | None = None
    gvwr: str | None = None

    nhtsa_error_code: str | None = None
    nhtsa_error_text: str | None = None
    extra: dict[str, str] = field(default_factory=dict)
    gibdd: GibddChecks | None = None
    lookup_error: str | None = None
    suggested_vin: str | None = None
    vin_correction_message: str | None = None

    @property
    def title(self) -> str:
        parts = [self.make, self.model, self.model_year]
        return " ".join(p for p in parts if p) or "Данные не найдены"

    def to_dict(self) -> dict[str, Any]:
        return {
            "vin": self.vin,
            "normalized": self.normalized,
            "found": self.found,
            "source": self.source,
            "sources_used": self.sources_used,
            "title": self.title,
            "make": self.make,
            "model": self.model,
            "model_year": self.model_year,
            "manufacturer": self.manufacturer,
            "series": self.series,
            "trim": self.trim,
            "body_class": self.body_class,
            "vehicle_type": self.vehicle_type,
            "doors": self.doors,
            "drive_type": self.drive_type,
            "fuel_type": self.fuel_type,
            "color": self.color,
            "category": self.category,
            "body_number": self.body_number,
            "engine_number": self.engine_number,
            "power_hp": self.power_hp,
            "power_kw": self.power_kw,
            "engine": {
                "cylinders": self.engine_cylinders,
                "displacement_l": self.displacement_l,
                "model": self.engine_model,
                "configuration": self.engine_configuration,
            },
            "transmission": {
                "style": self.transmission_style,
                "speeds": self.transmission_speeds,
            },
            "plant": {
                "country": self.plant_country,
                "city": self.plant_city,
                "state": self.plant_state,
            },
            "gvwr": self.gvwr,
            "nhtsa_error_code": self.nhtsa_error_code,
            "nhtsa_error_text": self.nhtsa_error_text,
            "extra": self.extra,
            "gibdd": self.gibdd.to_dict() if self.gibdd else None,
            "lookup_error": self.lookup_error,
            "suggested_vin": self.suggested_vin,
            "vin_correction_message": self.vin_correction_message,
        }
