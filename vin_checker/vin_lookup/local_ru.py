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

# WMI → марка (российские, китайские и частые импортные в РФ)
_WMI_MAKE: dict[str, str] = {
    # Российские легковые, грузовые, автобусы, прицепы
    "XTA": "LADA",
    "XTB": "LADA",
    "ZXV": "LADA",
    "XTC": "KAMAZ",
    "Z9M": "KAMAZ",
    "XDF": "IVECO-AMT",
    "X1F": "NEFAZ",
    "XTY": "LIAZ",
    "X90": "GOLAZ",
    "X96": "PAZ",
    "X1M": "PAZ",
    "X89": "KAVZ",
    "X60": "URAL",
    "XZB": "URAL",
    "X8A": "UAZ",
    "XTT": "UAZ",
    "XKM": "TREKOL",
    "X3E": "GAZ",
    "Z0V": "GAZ",
    "XU4": "VIS",
    "X6D": "VIS",
    "XVL": "VOLGABUS",
    "Z7N": "VOLGABUS",
    "XZG": "TONAR",
    "Z07": "SESPEL",
    "Z0G": "GRUNWALD",
    "Z9G": "GRUNWALD",
    "X0T": "MAZ-KUPAVA",
    "XZV": "CHAYKA-SERVIS",
    "XU5": "LUIDOR",
    "Z7C": "PROMTECH",
    "X8B": "AMZ",
    "XJY": "SPECAVTO",
    "X6S": "SIBIR-TRAILER",
    "XZP": "CHMZAP",
    "Z8J": "NAZ",
    "Z8C": "KLINTSY",
    "X24": "SIBTRAC",
    "XDC": "BETSEMA",
    "X1Y": "SAV",
    "X5J": "AVTOMASTER",
    "XD4": "NOVTRAK",
    "XTP": "MAZ-MAN",
    # Беларусь
    "Y3M": "MAZ",
    "XWM": "MAZ",
    "Y3H": "MAZ-MAN",
    "Y39": "MZKT",
    "XUB": "BELAZ",
    "Y4K": "BELARUS",
    "Y4R": "MTZ",
    # Сборка в РФ и СНГ
    "X7L": "RENAULT",
    "X7M": "RENAULT",
    "XW8": "SKODA",
    "TMB": "SKODA",
    "XW7": "VOLKSWAGEN",
    "XW1": "VOLKSWAGEN",
    "XWB": "HYUNDAI",
    "X6Y": "HYUNDAI",
    "Z94": "HYUNDAI",
    "XWE": "KIA",
    "X4X": "AVTOTOR",
    "X9P": "VOLVO",
    "EBE": "EVOLUTE",
    # Китайские марки
    "LVV": "CHERY",
    "HLX": "EXEED",
    "EDX": "JAECOO",
    "RUN": "OMODA",
    "LW4": "JETOUR",
    "LZZ": "SITRAK",
    "LZG": "SHACMAN",
    "LGA": "DONGFENG",
    "LDP": "DONGFENG",
    "LFC": "DONGFENG",
    "LA0": "DONGFENG",
    "LB3": "GEELY",
    "L6T": "GEELY",
    "LGC": "GEELY",
    "LXG": "GEELY",
    "LWL": "LIVAN",
    "LVT": "FOTON",
    "L5E": "FOTON",
    "LGW": "HAVAL",
    "HJR": "TANK",
    "LFW": "FAW",
    "LZF": "FAW",
    "LZY": "YUTONG",
    "LMG": "GAC",
    "LVG": "GAC",
    "LS4": "CHANGAN",
    "LS5": "CHANGAN",
    "LJ1": "JAC",
    "LSJ": "MG",
    "LSC": "MAXUS",
    "LRD": "LI AUTO",
    "LVB": "BAIC",
    "LFP": "HONGQI",
    "LKL": "KING LONG",
    "CLG": "LIUGONG",
    # Европейские грузовики и полуприцепы
    "XLR": "DAF",
    "XLD": "DAF",
    "YS2": "SCANIA",
    "9BS": "SCANIA",
    "XLE": "SCANIA",
    "WMA": "MAN",
    "WJM": "IVECO",
    "YV1": "VOLVO",
    "YV2": "VOLVO",
    "YV3": "VOLVO",
    "WDB": "MERCEDES-BENZ",
    "WDC": "MERCEDES-BENZ",
    "W1N": "MERCEDES-BENZ",
    "W1V": "MERCEDES-BENZ",
    "WSM": "SCHMITZ",
    "Z9L": "SCHMITZ",
    "WKE": "KASSBOHRER",
    "WK0": "KRONE",
    "XD2": "KRONE",
    "VF6": "RENAULT TRUCKS",
    "SUD": "WIELTON",
    "WFD": "FLIEGL",
    # Зарубежные легковые
    "WBA": "BMW",
    "WBS": "BMW",
    "WMW": "MINI",
    "WAU": "AUDI",
    "WA1": "AUDI",
    "WVW": "VOLKSWAGEN",
    "WV1": "VOLKSWAGEN",
    "WV2": "VOLKSWAGEN",
    "WV3": "VOLKSWAGEN",
    "WVG": "VOLKSWAGEN",
    "LSV": "VOLKSWAGEN",
    "WP0": "PORSCHE",
    "WP1": "PORSCHE",
    "VF1": "RENAULT",
    "VF3": "PEUGEOT",
    "VF7": "CITROEN",
    "ZFA": "FIAT",
    "VSS": "SEAT",
    "VSK": "NISSAN",
    "SJN": "NISSAN",
    "SAL": "LAND ROVER",
    "SAJ": "JAGUAR",
    "SHS": "HONDA",
    "SHH": "HONDA",
    "JTJ": "LEXUS",
    "JTH": "LEXUS",
    "JTM": "TOYOTA",
    "JTE": "TOYOTA",
    "JTD": "TOYOTA",
    "JTN": "TOYOTA",
    "JT1": "TOYOTA",
    "JT2": "TOYOTA",
    "JT3": "TOYOTA",
    "JT4": "TOYOTA",
    "4T3": "TOYOTA",
    "5TD": "TOYOTA",
    "KMH": "HYUNDAI",
    "KNA": "KIA",
    "KNM": "RENAULT SAMSUNG",
    "KL1": "CHEVROLET",
    "KL7": "DAEWOO",
    "UU1": "DACIA",
    "1C6": "RAM",
    "JF1": "SUBARU",
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
    "2191": "Granta",
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
    if up.startswith("KS") or up.startswith("RS"):
        return "Largus"
    for key in ("GFL1", "GFL2", "GFK1", "21099"):
        if up.startswith(key):
            return _VAZ_MODELS[key]
    digits = "".join(ch for ch in up[:5] if ch.isdigit())
    for n in (5, 4):
        if len(digits) >= n and digits[:n] in _VAZ_MODELS:
            return _VAZ_MODELS[digits[:n]]
    return None


def _bus_model(vds: str) -> str | None:
    up = vds.upper()
    if up.startswith("A32R") or up.startswith("A31R"):
        return "Vector Next"
    if up.startswith("A21R") or up.startswith("A22R"):
        return "GAZelle Next"
    if up.startswith("C41R") or up.startswith("C42R"):
        return "GAZon Next"
    digits = "".join(ch for ch in up if ch.isdigit())
    if len(digits) >= 4:
        return digits[:4]
    return None


def _uaz_model(vds: str) -> str | None:
    up = vds.upper()
    digits = "".join(ch for ch in up if ch.isdigit())
    if digits.startswith("3163") or up.startswith("964"):
        return "Patriot"
    if digits.startswith("2363"):
        return "Pickup"
    if digits.startswith("2360"):
        return "Profi"
    if digits.startswith("3909"):
        return "3909"
    if digits.startswith("3741"):
        return "3741"
    if digits.startswith("3303"):
        return "3303"
    if digits.startswith("3151"):
        return "Hunter"
    if len(digits) >= 4:
        return digits[:4]
    return None


def _foreign_model(wmi: str, vds: str) -> str | None:
    up = vds.upper()
    # Hyundai Solaris / Creta (сборка РФ)
    if wmi == "Z94":
        if up.startswith("G") or up.startswith("C"):
            return "Solaris"
        if up.startswith("K"):
            return "Creta"
    # Renault РФ
    if wmi == "X7L":
        if "HSR" in up:
            return "Duster"
        if "LSR" in up:
            return "Logan"
        if "4SR" in up:
            return "Sandero"
        if "BSR" in up:
            return "Kaptur"
    # Chery
    if wmi == "LVV":
        if up.startswith("DC"):
            return "Tiggo 4 Pro"
        if up.startswith("DB"):
            return "Tiggo 7 Pro Max"
        if up.startswith("DD") or up.startswith("DA"):
            return "Tiggo 8 Pro Max"
        if up.startswith("DE"):
            return "Arrizo 8"
    # Exeed / Jaecoo / Omoda / Jetour / Tank
    if wmi == "HLX" and up.startswith("33B1"):
        return "LX"
    if wmi == "EDX" and up.startswith("FB32"):
        return "J7"
    if wmi == "RUN":
        if up.startswith("T6EP"):
            return "C5"
        if up.startswith("PSEP"):
            return "S5"
    if wmi == "LW4" and up.startswith("33B1"):
        return "Dashing"
    if wmi == "HJR" and up.startswith("PBG"):
        return "300"
    # Haval
    if wmi == "LGW":
        if up.startswith("FF6") or up.startswith("FF7"):
            return "Jolion"
        if up.startswith("FF9"):
            return "F7"
        if up.startswith("DAE"):
            return "Dargo"
        if up.startswith("FGN"):
            return "M6"
        if up.startswith("CC"):
            return "H9"
    # Geely
    if wmi in ("LB3", "L6T", "LGC"):
        if "7852" in up:
            return "Monjaro"
        if "79T2" in up or "79ZC" in up:
            return "Tugella"
        if "777A" in up or "77H" in up:
            return "Atlas"
        if "7622" in up:
            return "Emgrand"
        if "FX1S" in up:
            return "Coolray"
    # Livan
    if wmi == "LWL":
        if "YUAJ" in up:
            return "X6 Pro"
        if "DMDC" in up or "DMBU" in up:
            return "X3 Pro"
        if "DAAJ" in up:
            return "S6 Pro"
    # Hongqi
    if wmi == "LFP":
        if "H4AC" in up:
            return "H5"
        if "M4AP" in up:
            return "HQ9"
        if "H4CP" in up:
            return "HS5"
    # Sitrak / Howo
    if wmi == "LZZ":
        if "7CC" in up:
            return "C7H"
        if "7CM" in up:
            return "C7H MAX"
        if "1DX" in up or "7NA" in up:
            return "HOWO T5G"
    # Shacman
    if wmi == "LZG":
        if "JL4" in up or "JR4" in up or "JX4" in up:
            return "X3000"
        if "JD3" in up or "JL3" in up:
            return "F3000"
        if "JL5" in up:
            return "X5000"
    # FAW
    if wmi in ("LFW", "LZF"):
        if "RRX" in up:
            return "J7"
        if "MXX" in up or "NHX" in up or "H25T" in up or "H25W" in up or "H18X" in up:
            return "J6P"
        if "KVX" in up or "LWX" in up:
            return "Tiger V"
    # Foton
    if wmi in ("LVT", "L5E"):
        if "DD24" in up:
            return "Auman EST A"
        if "DB21" in up:
            return "Auman GTL"
        if "DD21" in up:
            return "Auman"
    # Dongfeng
    if wmi in ("LGA", "LDP"):
        if "G3D" in up:
            return "GX"
        if "95E" in up or "95H" in up or "E62" in up:
            return "Captain-T"
    # Changan
    if wmi in ("LS4", "LS5"):
        if "ASE2" in up:
            return "CS55 Plus"
        if "A3DK" in up:
            return "UNI-K"
        if "A2DK" in up:
            return "CS75 Plus"
    # JAC
    if wmi == "LJ1":
        if "1PAB" in up:
            return "J7"
        if "8R2B" in up:
            return "T6 / T8"
    # Yutong
    if wmi == "LZY":
        if "TBG" in up or "TMT" in up:
            return "ZK6122"
        if "TCT" in up:
            return "ZK6129"
    # DAF
    if (wmi == "XLR" or wmi == "XLD") and up.startswith("TEH"):
        return "XF 105 / 106"
    # Scania
    if wmi in ("YS2", "9BS", "XLE"):
        if "R6X" in up or "R4X" in up:
            return "R-Series"
        if "G4X" in up or "G6X" in up:
            return "G-Series"
        if "P4X" in up or "P6X" in up:
            return "P-Series"
    # Nissan
    if wmi in ("VSK", "SJN"):
        if "D40" in up:
            return "Navara / Pathfinder"
        if "F15" in up:
            return "Juke"
    # Toyota USA
    if wmi == "5TD":
        return "Highlander"
    # Volvo Trucks & Volvo Vostok
    if wmi in ("YV2", "X9P"):
        if "RG1" in up or "RG3" in up or "RSK" in up:
            return "FH"
        if "RG2" in up or "RT4" in up:
            return "FM / FMX"
    # Audi
    if wmi in ("WAU", "WA1"):
        if "4G" in up or "F2" in up:
            return "A6"
        if "4M" in up:
            return "Q7"
        if "FY" in up:
            return "Q5"
        if "F1" in up:
            return "A1"
    # Tonar
    if wmi == "XZG":
        if "FE04" in up:
            return "9523 (полуприцеп)"
        if "FF06" in up:
            return "95892 (полуприцеп)"
        if "FF07" in up:
            return "95894 (полуприцеп)"
    # Mercedes Kamaz
    if wmi == "Z9M":
        if up.startswith("963"):
            return "5490 / Actros"
        if up.startswith("934"):
            return "Axor"
        if up.startswith("944"):
            return "Arocs"
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
    elif wmi in ("XTC", "XTY", "X96", "X89", "X90", "X1F", "Y3M", "XVL", "XWM", "X1M", "X3E", "Z0V", "XUB", "X60", "Y39", "XU4", "X6D", "Z7N", "Z8J", "Z8C", "XDF", "XKM"):
        model = _bus_model(vds)
    elif wmi in ("XTT", "X8A"):
        model = _uaz_model(vds)
    else:
        model = _foreign_model(wmi, vds)

    # fallback для КАМАЗ/Mercedes
    if not model and wmi == "Z9M":
        digits = "".join(ch for ch in vds if ch.isdigit())
        if len(digits) >= 3:
            model = digits[:3]

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
    d5 = decode_local("XTC549015N2565466")
    assert d5.make == "KAMAZ" and d5.model == "5490" and d5.year == "2022", d5
    d6 = decode_local("LVVDC21B1PD196821")
    assert d6.make == "CHERY" and d6.model == "Tiggo 4 Pro" and d6.year == "2023", d6
    d7 = decode_local("LZZ7CCWD5PC474830")
    assert d7.make == "SITRAK" and d7.model == "C7H" and d7.year == "2023", d7
    assert year_from_vin("XXXXXXXXX8XXXXXXX") == "2008"
    print("local_ru self-check ok")


if __name__ == "__main__":
    _selfcheck()
