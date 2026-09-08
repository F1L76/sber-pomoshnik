#!/usr/bin/env python3
"""Добор марки/года через Avtocod для строк без полной тройки (марка/модель/год)."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "vin_checker"))

from vin_lookup.avtocod import lookup_avtocod_vin  # noqa: E402

DEFAULT_XLSX = Path.home() / "Downloads" / "ВИН.xlsx"
OUT = _ROOT / "data" / "vin-parse"
RESULTS = OUT / "results.jsonl"
WRITE = _ROOT / "scripts" / "write-vin-to-xlsx.py"


def load_rows() -> dict[str, dict]:
    out: dict[str, dict] = {}
    if RESULTS.exists():
        for line in RESULTS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            out[str(row.get("vin") or "").upper()] = row
    return out


def save_rows(rows: dict[str, dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with RESULTS.open("w", encoding="utf-8") as fh:
        for vin in sorted(rows):
            fh.write(json.dumps(rows[vin], ensure_ascii=False) + "\n")


def incomplete(row: dict) -> bool:
    return not (row.get("make") and row.get("model") and row.get("year"))


def main() -> int:
    xlsx = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else DEFAULT_XLSX
    rows = load_rows()
    # список VIN из xlsx
    from openpyxl import load_workbook

    wb = load_workbook(xlsx, data_only=True, read_only=True)
    vins = []
    for r in wb.active.iter_rows(min_row=2, max_col=1, values_only=True):
        v = str(r[0] or "").strip().upper()
        if v and v != "VIN":
            vins.append(v)
    wb.close()

    todo = [v for v in vins if incomplete(rows.get(v) or {"vin": v})]
    print(f"avtocod fill: {len(todo)} / {len(vins)}", flush=True)
    for i, vin in enumerate(todo, 1):
        info = lookup_avtocod_vin(vin)
        row = dict(rows.get(vin) or {"vin": vin})
        if info.found:
            if info.make and (not row.get("make") or (row.get("source") or "").startswith("local")):
                # только дополняем/правим local
                if not row.get("make"):
                    row["make"] = info.make
            if info.model_year and not row.get("year"):
                row["year"] = info.model_year
            if info.model and not row.get("model"):
                row["model"] = info.model
            row["ok"] = True
            src = row.get("source") or ""
            if "avtocod" not in src:
                row["source"] = (src + "+avtocod").strip("+")
        print(
            f"{i}/{len(todo)} {vin} -> {row.get('make') or '—'} | {row.get('model') or '—'} | {row.get('year') or '—'} [{info.source}]",
            flush=True,
        )
        rows[vin] = row
        if i % 2 == 0 or i == len(todo):
            save_rows(rows)
            subprocess.run([sys.executable, str(WRITE), str(xlsx), str(RESULTS)], check=False)
        time.sleep(0.3)
    save_rows(rows)
    subprocess.run([sys.executable, str(WRITE), str(xlsx), str(RESULTS)], check=False)
    print("done", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
