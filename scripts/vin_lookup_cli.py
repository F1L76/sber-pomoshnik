#!/usr/bin/env python3
"""JSON CLI для поиска по VIN (вызывается из Node proxy)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_VIN_ROOT = _ROOT / "vin_checker"
if str(_VIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_VIN_ROOT))

from vin_lookup import lookup_batch
from vin_validator.parse import parse_vins_from_text

MAX_VINS = 50


def main() -> int:
    try:
        raw = sys.stdin.read() if not sys.stdin.isatty() else (sys.argv[1] if len(sys.argv) > 1 else "")
        data = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"Некорректный JSON: {exc}"}, ensure_ascii=False))
        return 2

    vins: list[str] = []
    if isinstance(data.get("vins"), list):
        vins = [str(v).strip() for v in data["vins"] if str(v).strip()]
    elif data.get("text"):
        vins = parse_vins_from_text(str(data["text"]))

    if not vins:
        print(json.dumps({"error": "Укажите хотя бы один VIN"}, ensure_ascii=False))
        return 2

    if len(vins) > MAX_VINS:
        print(json.dumps({"error": f"Не более {MAX_VINS} VIN за один запрос"}, ensure_ascii=False))
        return 2

    try:
        results = lookup_batch(vins)
    except Exception as exc:
        print(json.dumps({"error": f"Ошибка поиска: {exc}"}, ensure_ascii=False))
        return 1

    found_count = sum(1 for r in results if r.found)
    print(
        json.dumps(
            {
                "total": len(results),
                "found_count": found_count,
                "not_found_count": len(results) - found_count,
                "results": [r.to_dict() for r in results],
                "source": "drom",
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
