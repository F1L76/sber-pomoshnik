"""Локальные демо-данные, если NHTSA недоступна (для проверки интерфейса)."""

from .models import VehicleInfo

DEMO_VIN = "1HGCM82633A004352"


def demo_vehicle(raw_vin: str, normalized: str) -> VehicleInfo:
    return VehicleInfo(
        vin=raw_vin,
        normalized=normalized,
        found=True,
        source="demo",
        sources_used=["demo"],
        make="HONDA",
        model="Accord",
        model_year="2003",
        manufacturer="AMERICAN HONDA MOTOR CO., INC.",
        trim="EX-V6",
        body_class="Coupe",
        vehicle_type="PASSENGER CAR",
        doors="2",
        fuel_type="Gasoline",
        engine_cylinders="6",
        displacement_l="3.0",
        engine_model="J30A4",
        transmission_style="Automatic",
        transmission_speeds="5",
        plant_country="UNITED STATES (USA)",
        plant_city="MARYSVILLE",
        plant_state="OHIO",
        lookup_error=None,
        extra={"Примечание": "Демо-режим: NHTSA недоступна, показан пример для теста UI"},
    )
