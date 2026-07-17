"""Разбор списка VIN из текста или файла."""

from __future__ import annotations

from pathlib import Path


def parse_vins_from_text(text: str) -> list[str]:
    """Извлекает VIN из многострочного текста или CSV."""
    vins: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for part in line.replace(";", ",").split(","):
            part = part.strip()
            if part:
                vins.append(part)
    return vins


def parse_vins_from_file(path: Path) -> list[str]:
    return parse_vins_from_text(path.read_text(encoding="utf-8"))
