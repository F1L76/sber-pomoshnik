#!/usr/bin/env python3
"""JSON CLI для поиска по VIN / госномеру (вызывается из Node proxy)."""

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
from vin_validator.plate import is_probable_plate, normalize_plate

MAX_QUERIES = 50


def _parse_queries(data: dict) -> list[str]:
    if isinstance(data.get("queries"), list):
        return [str(v).strip() for v in data["queries"] if str(v).strip()]
    if isinstance(data.get("plates"), list):
        return [str(v).strip() for v in data["plates"] if str(v).strip()]
    if isinstance(data.get("vins"), list):
        return [str(v).strip() for v in data["vins"] if str(v).strip()]
    if data.get("plate"):
        return [str(data["plate"]).strip()]
    if data.get("text"):
        lines = [ln.strip() for ln in str(data["text"]).splitlines() if ln.strip()]
        if not lines:
            return []
        out: list[str] = []
        for ln in lines:
            if is_probable_plate(ln):
                out.append(normalize_plate(ln))
            else:
                out.extend(parse_vins_from_text(ln))
        return out
    return []


def main() -> int:
    try:
        raw = sys.stdin.read() if not sys.stdin.isatty() else (sys.argv[1] if len(sys.argv) > 1 else "")
        data = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"Некорректный JSON: {exc}"}, ensure_ascii=False))
        return 2

    queries = _parse_queries(data)

    if not queries:
        print(json.dumps({"error": "Укажите VIN или госномер"}, ensure_ascii=False))
        return 2

    if len(queries) > MAX_QUERIES:
        print(json.dumps({"error": f"Не более {MAX_QUERIES} номеров за один запрос"}, ensure_ascii=False))
        return 2

    try:
        results = lookup_batch(queries)
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
