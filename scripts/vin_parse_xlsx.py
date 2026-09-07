#!/usr/bin/env python3
"""
Парсинг VIN из xlsx → марка / модель / год (как геокод списка КН).

Бесплатные источники, по приоритету качества:
  1) кэш drom (уже скачанные превью)
  2) NHTSA DecodeVINValuesBatch (быстрый пакетный)
  3) живой drom / NHTSA через lookup_query (по одному, с паузой)

  python3 scripts/vin_parse_xlsx.py [xlsx]
  python3 scripts/vin_parse_xlsx.py --missing   # только пустые / неуспешные
  VIN_PARSE_LIMIT=5 python3 scripts/vin_parse_xlsx.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

_ROOT = Path(__file__).resolve().parent.parent
_VIN_ROOT = _ROOT / "vin_checker"
if str(_VIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_VIN_ROOT))

from vin_lookup.drom import cooldown_remaining, drom_cooling_down, lookup_drom  # noqa: E402
from vin_lookup.service import lookup_query  # noqa: E402
from vin_validator.iso3779 import normalize_vin  # noqa: E402

DEFAULT_XLSX = Path.home() / "Downloads" / "ВИН.xlsx"
OUT_DIR = _ROOT / "data" / "vin-parse"
RESULTS_PATH = OUT_DIR / "results.jsonl"
STATUS_PATH = OUT_DIR / "status.json"
PROGRESS_LOG_PATH = OUT_DIR / "progress.log"
WRITE_XLSX_PY = Path(__file__).resolve().parent / "write-vin-to-xlsx.py"
NHTSA_BATCH_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dir() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def _write_status(status: dict) -> None:
    STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def _log(line: str) -> None:
    print(line, flush=True)
    with PROGRESS_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("null", "not applicable", "n/a", "none"):
        return None
    return text


def _is_complete(row: dict) -> bool:
    return bool(_clean(row.get("make")) and _clean(row.get("model")) and _clean(row.get("year")))


def _merge(dst: dict, src: dict, *, prefer_src: bool = False) -> dict:
    out = dict(dst)
    for key in ("make", "model", "year", "source"):
        sv = _clean(src.get(key))
        if not sv:
            continue
        if prefer_src or not _clean(out.get(key)):
            out[key] = sv
    if src.get("ok"):
        out["ok"] = True
    return out


def load_results() -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not RESULTS_PATH.exists():
        return out
    for line in RESULTS_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        vin = str(row.get("vin") or "").strip().upper()
        if vin:
            out[vin] = row
    return out


def save_results(rows: dict[str, dict]) -> None:
    with RESULTS_PATH.open("w", encoding="utf-8") as fh:
        for vin in sorted(rows):
            fh.write(json.dumps(rows[vin], ensure_ascii=False) + "\n")


def write_xlsx(xlsx: Path) -> None:
    import subprocess

    subprocess.run(
        [sys.executable, str(WRITE_XLSX_PY), str(xlsx), str(RESULTS_PATH)],
        check=False,
        cwd=str(_ROOT),
    )


def read_vins(xlsx: Path) -> list[str]:
    wb = load_workbook(xlsx, data_only=True, read_only=True)
    ws = wb.active
    vins: list[str] = []
    seen: set[str] = set()
    for i, row in enumerate(ws.iter_rows(min_row=1, max_col=1, values_only=True), start=1):
        raw = str(row[0] or "").strip()
        if not raw or raw.upper() in ("VIN", "ВИН"):
            continue
        vin = normalize_vin(raw) if len(raw) >= 11 else raw.upper()
        if len(vin) < 11 or vin in seen:
            continue
        seen.add(vin)
        vins.append(vin)
    wb.close()
    return vins


def nhtsa_batch(vins: list[str]) -> dict[str, dict]:
    if not vins:
        return {}
    body = urllib.parse.urlencode({"format": "json", "DATA": ";".join(vins)}).encode()
    req = urllib.request.Request(
        NHTSA_BATCH_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "sber-pomoshnik-vin-parse/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    out: dict[str, dict] = {}
    for item in payload.get("Results") or []:
        vin = str(item.get("VIN") or "").strip().upper()
        if not vin:
            continue
        make = _clean(item.get("Make")) or _clean(item.get("Manufacturer"))
        model = _clean(item.get("Model"))
        year = _clean(item.get("ModelYear"))
        if not (make or model or year):
            continue
        # NHTSA иногда отдаёт длинный manufacturer вместо марки
        if make and len(make) > 40 and not _clean(item.get("Make")):
            make = make.split(",")[0].strip()[:40]
        out[vin] = {
            "vin": vin,
            "ok": True,
            "make": make,
            "model": model,
            "year": year,
            "source": "nhtsa",
        }
    return out


def try_drom_cache(vin: str) -> dict | None:
    """Тихий lookup_drom: при cooldown вернёт rate-limited без сети; при cache hit — данные."""
    try:
        info = lookup_drom(vin, normalize_vin(vin) if len(vin) == 17 else vin)
    except Exception:
        return None
    if not info.found:
        return None
    return {
        "vin": vin,
        "ok": True,
        "make": _clean(info.make),
        "model": _clean(info.model),
        "year": _clean(info.model_year),
        "source": "drom-cache" if "drom" in (info.sources_used or []) else (info.source or "drom"),
    }


def live_lookup(vin: str) -> dict:
    info = lookup_query(vin, try_corrections=False)
    make = _clean(info.make)
    model = _clean(info.model)
    year = _clean(info.model_year)
    ok = bool(make or model or year)
    return {
        "vin": vin,
        "ok": ok,
        "make": make,
        "model": model,
        "year": year,
        "source": ",".join(info.sources_used or ([info.source] if info.source else [])) or "lookup",
        "err": None if ok else (info.lookup_error or "нет данных"),
    }


def parse_args(argv: list[str]) -> tuple[Path, bool, int]:
    xlsx = DEFAULT_XLSX
    missing = False
    limit = int(os.environ.get("VIN_PARSE_LIMIT") or 0)
    for i, a in enumerate(argv):
        if a == "--missing":
            missing = True
        elif a == "--limit":
            limit = int(argv[i + 1]) if i + 1 < len(argv) else limit
        elif not a.startswith("-"):
            xlsx = Path(a).expanduser()
    return xlsx, missing, limit


def main() -> int:
    xlsx, missing_only, limit = parse_args(sys.argv[1:])
    if not xlsx.exists():
        print(f"нет файла: {xlsx}", file=sys.stderr)
        return 1

    _ensure_dir()
    vins = read_vins(xlsx)
    if limit > 0:
        vins = vins[:limit]
    if not vins:
        print("в файле нет VIN", file=sys.stderr)
        return 1

    rows = load_results()
    queue: list[str] = []
    for vin in vins:
        prev = rows.get(vin)
        if missing_only:
            if prev and _is_complete(prev):
                continue
            queue.append(vin)
        elif prev and _is_complete(prev):
            continue
        else:
            queue.append(vin)

    total = len(vins)
    t0 = time.time()
    started_at = _now()
    recent: list[dict] = []
    processed_run = 0

    def recount() -> tuple[int, int, int]:
        ok_n = sum(
            1
            for v in vins
            if rows.get(v)
            and rows[v].get("ok")
            and (rows[v].get("make") or rows[v].get("model") or rows[v].get("year"))
        )
        fail_n = sum(1 for v in vins if v in rows) - ok_n
        # «обработано» = есть запись в results
        done_n = sum(1 for v in vins if v in rows)
        return done_n, ok_n, max(fail_n, 0)

    def flush(running: bool = True) -> None:
        done_n, ok_n, fail_n = recount()
        elapsed = max(time.time() - t0, 0.001)
        rate = processed_run / elapsed if processed_run else 0
        left = max(total - done_n, 0)
        _write_status(
            {
                "running": running,
                "pid": os.getpid(),
                "total": total,
                "done": done_n,
                "ok": ok_n,
                "fail": fail_n,
                "queue": len(queue),
                "ratePerSec": round(rate, 2) if rate else 0,
                "etaSec": int(left / rate) if rate > 0 else None,
                "startedAt": started_at,
                "updatedAt": _now(),
                "source": str(xlsx.name),
                "xlsx": str(xlsx),
                "recent": recent[-40:],
            }
        )

    def note(vin: str, row: dict, tag: str) -> None:
        nonlocal processed_run
        processed_run += 1
        make = row.get("make") or "—"
        model = row.get("model") or "—"
        year = row.get("year") or "—"
        done_n, ok_n, _ = recount()
        mark = "+" if row.get("ok") and (row.get("make") or row.get("model") or row.get("year")) else "−"
        _log(f"{done_n}/{total} {mark} {vin}  {make}  {model}  {year}  [{tag}]")
        recent.append(
            {
                "vin": vin,
                "ok": bool(row.get("ok")),
                "make": row.get("make"),
                "model": row.get("model"),
                "year": row.get("year"),
                "err": row.get("err"),
            }
        )
        if len(recent) > 40:
            recent[:] = recent[-40:]

    _log(f"старт: {xlsx.name}, всего {total}, к обработке {len(queue)}")
    flush(True)

    # --- pass 1: drom cache (мгновенно) ---
    still: list[str] = []
    for vin in queue:
        cached = try_drom_cache(vin)
        if cached and (cached.get("make") or cached.get("model") or cached.get("year")):
            rows[vin] = _merge(rows.get(vin) or {"vin": vin}, cached, prefer_src=True)
            rows[vin]["ok"] = True
            note(vin, rows[vin], "cache")
            if _is_complete(rows[vin]):
                continue
        still.append(vin)
    if any(v in rows for v in queue):
        save_results(rows)
        write_xlsx(xlsx)
        flush(True)

    # --- pass 2: NHTSA batch ---
    need_nhtsa = [v for v in still if not _is_complete(rows.get(v) or {})]
    if need_nhtsa:
        _log(f"NHTSA batch: {len(need_nhtsa)} VIN…")
        try:
            batch = nhtsa_batch(need_nhtsa)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            _log(f"NHTSA batch ошибка: {exc}")
            batch = {}
        for vin in need_nhtsa:
            hit = batch.get(vin)
            if not hit:
                continue
            before = dict(rows.get(vin) or {"vin": vin})
            rows[vin] = _merge(before, hit)
            rows[vin]["ok"] = bool(rows[vin].get("make") or rows[vin].get("model") or rows[vin].get("year"))
            if rows[vin]["ok"] and (
                rows[vin].get("make") != before.get("make")
                or rows[vin].get("model") != before.get("model")
                or rows[vin].get("year") != before.get("year")
                or vin not in before
            ):
                note(vin, rows[vin], "nhtsa")
        save_results(rows)
        write_xlsx(xlsx)
        flush(True)

    # --- pass 3: live lookup ---
    need_live = [v for v in still if not _is_complete(rows.get(v) or {})]
    # также те, кого NHTSA не закрыл и не было в still как complete
    _log(f"живой поиск: {len(need_live)} VIN (drom+NHTSA, с паузой)")

    for i, vin in enumerate(need_live):
        if drom_cooling_down():
            wait = min(cooldown_remaining() + 0.5, 180)
            _log(f"~ пауза drom {wait:.0f} с…")
            # обновляем статус кусками — экран прогресса не «замирает»
            left = wait
            while left > 0 and drom_cooling_down():
                flush(True)
                step = min(5.0, left)
                time.sleep(step)
                left -= step
        if i:
            time.sleep(1.2 if not drom_cooling_down() else 0.3)
        try:
            live = live_lookup(vin)
        except Exception as exc:
            live = {
                "vin": vin,
                "ok": False,
                "err": str(exc),
                "make": None,
                "model": None,
                "year": None,
                "source": "error",
            }

        rows[vin] = _merge(rows.get(vin) or {"vin": vin}, live, prefer_src=True)
        if live.get("ok"):
            rows[vin]["ok"] = True
            rows[vin].pop("err", None)
        elif not (rows[vin].get("make") or rows[vin].get("model") or rows[vin].get("year")):
            rows[vin]["ok"] = False
            rows[vin]["err"] = live.get("err") or "нет данных"
        else:
            rows[vin]["ok"] = True

        note(vin, rows[vin], rows[vin].get("source") or "live")
        if (i + 1) % 3 == 0 or i + 1 == len(need_live):
            save_results(rows)
            write_xlsx(xlsx)
            flush(True)

    for vin in vins:
        if vin not in rows:
            rows[vin] = {"vin": vin, "ok": False, "err": "не обработан"}
            note(vin, rows[vin], "skip")

    save_results(rows)
    write_xlsx(xlsx)
    done_n, ok_n, fail_n = recount()
    flush(False)
    _log(f"готово: найдено {ok_n}, без данных {fail_n}, файл {xlsx}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        try:
            prev = json.loads(STATUS_PATH.read_text(encoding="utf-8")) if STATUS_PATH.exists() else {}
            prev.update({"running": False, "error": "прервано", "updatedAt": _now()})
            _write_status(prev)
        except Exception:
            pass
        raise SystemExit(130)
