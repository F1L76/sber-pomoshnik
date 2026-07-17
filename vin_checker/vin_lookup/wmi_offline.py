"""Локальный разбор VIN по WMI и году — без сети (запас, когда drom/NHTSA недоступны)."""

from __future__ import annotations

from datetime import datetime

from .models import VehicleInfo

# ponytail: компактная таблица РФ/СНГ + частые импорты; полный каталог WMI — отдельный датасет
_WMI: dict[str, tuple[str, str, str]] = {
    # make, manufacturer, plant_country
    "XTA": ("LADA", "АВТОВАЗ", "Россия"),
    "XTB": ("LADA", "АВТОВАЗ", "Россия"),
    "XTT": ("UAZ", "УАЗ", "Россия"),
    "XT6": ("GAZ", "ГАЗ", "Россия"),
    "XTC": ("KAMAZ", "КАМАЗ", "Россия"),
    "X7L": ("Renault", "Renault Россия", "Россия"),
    "X7M": ("Renault", "Renault Россия", "Россия"),
    "XUF": ("Chevrolet", "GM-АВТОВАЗ", "Россия"),
    "XW8": ("Volkswagen", "Volkswagen Group Rus", "Россия"),
    "XWB": ("Volkswagen", "Volkswagen Group Rus", "Россия"),
    "XWE": ("Skoda", "Volkswagen Group Rus", "Россия"),
    "XW9": ("Volkswagen", "Volkswagen Group Rus", "Россия"),
    "Z94": ("Hyundai", "Hyundai Motor Manufacturing Rus", "Россия"),
    "Z8T": ("Nissan", "Nissan Manufacturing Rus", "Россия"),
    "Z8Y": ("Nissan", "Nissan Manufacturing Rus", "Россия"),
    "X9L": ("Volvo", "Volvo Cars", "Россия"),
    "X96": ("Ford", "Ford Sollers", "Россия"),
    "X9P": ("BMW", "Автотор", "Россия"),
    "X4X": ("BMW", "Автотор", "Россия"),
    "X89": ("Kia", "Автотор", "Россия"),
    "XU5": ("Kia", "Автотор", "Россия"),
    "Y6D": ("ZAZ", "ЗАЗ", "Украина"),
    "Y6L": ("LuAZ", "ЛуАЗ", "Украина"),
    "XMC": ("Mitsubishi", "PCMA Rus", "Россия"),
    "JTJ": ("Lexus", "Toyota Motor Corporation", "Япония"),
    "JTD": ("Toyota", "Toyota Motor Corporation", "Япония"),
    "JTE": ("Toyota", "Toyota Motor Corporation", "Япония"),
    "JTM": ("Toyota", "Toyota Motor Corporation", "Япония"),
    "JTH": ("Lexus", "Toyota Motor Corporation", "Япония"),
    "JF1": ("Subaru", "Subaru Corporation", "Япония"),
    "JM1": ("Mazda", "Mazda Motor Corporation", "Япония"),
    "JMZ": ("Mazda", "Mazda Motor Corporation", "Япония"),
    "JN1": ("Nissan", "Nissan Motor Co.", "Япония"),
    "JN8": ("Nissan", "Nissan Motor Co.", "Япония"),
    "JS1": ("Suzuki", "Suzuki Motor Corporation", "Япония"),
    "WBA": ("BMW", "BMW AG", "Германия"),
    "WBS": ("BMW", "BMW M", "Германия"),
    "WDB": ("Mercedes-Benz", "Mercedes-Benz", "Германия"),
    "WDD": ("Mercedes-Benz", "Mercedes-Benz", "Германия"),
    "WVW": ("Volkswagen", "Volkswagen AG", "Германия"),
    "WAU": ("Audi", "Audi AG", "Германия"),
    "TMB": ("Skoda", "Skoda Auto", "Чехия"),
    "VF1": ("Renault", "Renault S.A.", "Франция"),
    "VF3": ("Peugeot", "PSA", "Франция"),
    "VF7": ("Citroen", "PSA", "Франция"),
    "UU1": ("Dacia", "Dacia", "Румыния"),
    "KMH": ("Hyundai", "Hyundai Motor Company", "Корея"),
    "KNA": ("Kia", "Kia Motors", "Корея"),
    "KND": ("Kia", "Kia Motors", "Корея"),
    "SAL": ("Land Rover", "Jaguar Land Rover", "Великобритания"),
    "SAJ": ("Jaguar", "Jaguar Land Rover", "Великобритания"),
    "1G1": ("Chevrolet", "General Motors", "США"),
    "1FA": ("Ford", "Ford Motor Company", "США"),
    "1HG": ("Honda", "Honda", "США"),
    "2T1": ("Toyota", "Toyota", "Канада"),
    "3VW": ("Volkswagen", "Volkswagen", "Мексика"),
    "LSV": ("Volkswagen", "FAW-Volkswagen", "Китай"),
    "LFV": ("Volkswagen", "FAW-Volkswagen", "Китай"),
}

# ISO 3779: позиция 10 (индекс 9), цикл 30 лет
_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789"


def decode_model_year(vin: str) -> str | None:
    if len(vin) < 10:
        return None
    code = vin[9]
    if code not in _YEAR_CODES:
        return None
    idx = _YEAR_CODES.index(code)
    now = datetime.now().year
    candidates = [y for y in (1980 + idx, 2010 + idx) if 1980 <= y <= now + 1]
    if not candidates:
        return None
    return str(min(candidates, key=lambda y: abs(now - y)))


def lookup_wmi_offline(raw_vin: str, normalized: str) -> VehicleInfo:
    wmi = normalized[:3]
    make = manufacturer = country = None
    hit = _WMI.get(wmi)
    if hit:
        make, manufacturer, country = hit
    else:
        # 2-char префиксы редки; пробуем известные 2-символьные корни
        for n in (3, 2):
            hit = _WMI.get(normalized[:n])
            if hit:
                make, manufacturer, country = hit
                break

    year = decode_model_year(normalized)
    found = bool(make or year)
    extra: dict[str, str] = {"WMI": wmi}
    if not hit and wmi.startswith("X"):
        extra["Регион WMI"] = "Россия / СНГ (точный завод не определён)"
        country = country or "Россия"
        found = True

    return VehicleInfo(
        vin=raw_vin,
        normalized=normalized,
        found=found,
        source="wmi",
        sources_used=["wmi"],
        make=make,
        manufacturer=manufacturer,
        model_year=year,
        plant_country=country,
        extra=extra,
        lookup_error=None
        if found
        else "Не удалось определить марку по WMI",
    )


def _self_check() -> None:
    r = lookup_wmi_offline("XTA219000Y0123456", "XTA219000Y0123456")
    assert r.make == "LADA" and r.model_year, r
    r2 = lookup_wmi_offline("XW8ZZZ61ZJG012345", "XW8ZZZ61ZJG012345")
    assert r2.make == "Volkswagen", r2
    print("wmi_offline self-check ok:", r.title, "|", r2.title)


if __name__ == "__main__":
    _self_check()
