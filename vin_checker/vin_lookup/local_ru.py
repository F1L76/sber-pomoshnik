"""Локальная расшифровка VIN (бесплатно, без сети): WMI → марка, год, частые модели РФ."""

from __future__ import annotations

from dataclasses import dataclass

# ISO 3779 model year (позиция 10), цикл 2010–2039
_YEAR_2010 = {
    "A": 2010,
    "B": 2011,
    "C": 2012,
    "D": 2013,
    "E": 2014,
    "F": 2015,
    "G": 2016,
    "H": 2017,
    "J": 2018,
    "K": 2019,
    "L": 2020,
    "M": 2021,
    "N": 2022,
    "P": 2023,
    "R": 2024,
    "S": 2025,
    "T": 2026,
    "V": 2027,
    "W": 2028,
    "X": 2029,
    "Y": 2030,
    "1": 2031,
    "2": 2032,
    "3": 2033,
    "4": 2034,
    "5": 2035,
    "6": 2036,
    "7": 2037,
    "8": 2038,
    "9": 2039,
}

# WMI → марка (российские и частые импортные в РФ)
_WMI_MAKE: dict[str, str] = {
    "XTA": "LADA",
    "X7L": "RENAULT",
    "X7M": "RENAULT",
    "XW8": "SKODA",
    "XW7": "VOLKSWAGEN",
    "XW1": "VOLKSWAGEN",
    "XWB": "HYUNDAI",
    "XWE": "KIA",
    "X96": "PAZ",
    "XTY": "LIAZ",
    "Y3M": "MAZ",
    "X89": "KAVZ",
    "X90": "GOLAZ",
    "X60": "URAL",
    "X8A": "UAZ",
    "X6Y": "HYUNDAI",
    "X3E": "GAZ",
    "X1F": "NEFAZ",
    "X1M": "MAZ",
    "XVL": "VOLGABUS",
    "XWM": "MAZ",
    "XUB": "BELAZ",
    "Y39": "MZKT",
    "Z0V": "GAZ",
    "LFP": "HONGQI",
    "LZF": "FAW",
    "LXG": "GEELY",
    "LA0": "DONGFENG",
    "VF1": "RENAULT",
    "WBA": "BMW",
    "WBS": "BMW",
    "WMA": "MAN",
    "WDB": "MERCEDES-BENZ",
    "TMB": "SKODA",
    "XTB": "LADA",
}

# VAZ/LADA: первые цифры VDS (позиции 4–7) → модель
_VAZ_MODELS: dict[str, str] = {
    "2101": "2101",
    "2102": "2102",
    "2103": "2103",
    "2104": "2104",
    "2105": "2105",
    "2106": "2106",
    "2107": "2107",
    "2108": "2108",
    "2109": "2109",
    "21099": "21099",
    "2110": "2110",
    "2111": "2111",
    "2112": "2112",
    "2113": "2113",
    "2114": "2114",
    "2115": "2115",
    "2120": "2120",
    "2121": "4x4 / Niva",
    "2123": "Niva / Chevrolet Niva",
    "2129": "4x4",
    "2131": "4x4 5дв.",
    "2170": "Priora",
    "2172": "Priora",
    "2190": "Granta",
    "2192": "Kalina",
    "2194": "Kalina",
    "GFL1": "Vesta",
    "GFL2": "Vesta",
    "GFK1": "XRAY",
}


@dataclass
class LocalDecode:
    make: str | None = None
    model: str | None = None
    year: str | None = None
    source: str = "local"


def year_from_vin(vin: str, *, now_year: int = 2026) -> str | None:
    if len(vin) < 10:
        return None
    code = vin[9].upper()
    year = _YEAR_2010.get(code)
    if year is None:
        return None
    # ponytail: если год «из будущего» — откат на цикл 1980–2009 (−30)
    if year > now_year:
        year -= 30
    if year < 1980 or year > now_year + 1:
        return None
    return str(year)


def _vaz_model(vds: str) -> str | None:
    up = vds.upper()
    for key in ("GFL1", "GFL2", "GFK1", "21099"):
        if up.startswith(key):
            return _VAZ_MODELS[key]
    digits = "".join(ch for ch in up[:5] if ch.isdigit())
    for n in (5, 4):
        if len(digits) >= n and digits[:n] in _VAZ_MODELS:
            return _VAZ_MODELS[digits[:n]]
    return None


def _bus_model(vds: str) -> str | None:
    digits = "".join(ch for ch in vds if ch.isdigit())
    if len(digits) >= 4:
        return digits[:4]
    return None


def decode_local(vin: str) -> LocalDecode:
    raw = "".join(ch for ch in str(vin).upper() if ch.isalnum())
    if len(raw) < 3:
        return LocalDecode()
    wmi = raw[:3]
    vds = raw[3:9] if len(raw) >= 9 else raw[3:]
    make = _WMI_MAKE.get(wmi)
    model = None
    if wmi in ("XTA", "XTB", "ZXV"):
        model = _vaz_model(vds)
    elif wmi in ("XTY", "X96", "X89", "X90", "X1F", "Y3M", "XVL", "XWM", "X1M"):
        model = _bus_model(vds)
    elif wmi == "X8A" and vds.startswith("964"):
        model = "Patriot / Pickup"
    year = year_from_vin(raw)
    if not (make or model or year):
        return LocalDecode()
    return LocalDecode(make=make, model=model, year=year, source="local")


def _selfcheck() -> None:
    d = decode_local("XTA213100D0147841")
    assert d.make == "LADA", d
    assert d.model and "4x4" in d.model, d
    assert d.year == "2013", d
    d2 = decode_local("XTA212300R0908416")
    assert d2.make == "LADA" and d2.year == "2024", d2
    d3 = decode_local("XTY52564350012724")
    assert d3.make == "LIAZ" and d3.model == "5256", d3
    d4 = decode_local("Y3M5440A880000976")
    assert d4.make == "MAZ" and d4.model == "5440", d4
    assert year_from_vin("XXXXXXXXX8XXXXXXX") == "2008"
    print("local_ru self-check ok")


if __name__ == "__main__":
    _selfcheck()
