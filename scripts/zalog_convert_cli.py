#!/usr/bin/env python3
"""CLI: PDF + XLSX → JSON (html + data). Вызывается из Node gigachat-proxy."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_PYDEPS = _ROOT / "python-deps"
if _PYDEPS.is_dir():
    sys.path.insert(0, str(_PYDEPS))
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from zalog_converter.merge import build_report  # noqa: E402


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: zalog_convert_cli.py <pdf> <xlsx>"}), file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    xlsx_path = Path(sys.argv[2])
    if not pdf_path.is_file():
        print(json.dumps({"ok": False, "error": f"PDF не найден: {pdf_path}"}, ensure_ascii=False))
        return 1
    if not xlsx_path.is_file():
        print(json.dumps({"ok": False, "error": f"XLSX не найден: {xlsx_path}"}, ensure_ascii=False))
        return 1

    try:
        report = build_report(pdf_path.read_bytes(), xlsx_path.read_bytes())
        print(
            json.dumps(
                {"ok": True, "html": report.html, "data": report.to_dict()},
                ensure_ascii=False,
            )
        )
        return 0
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"Ошибка обработки: {exc}"}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
