#!/usr/bin/env python3
"""
Парсинг VIN из xlsx → марка / модель / год (как геокод списка КН).

Бесплатные источники, по приоритету качества:
  1) кэш drom (уже скачанные превью)
  2) локальная расшифровка WMI/год/модели РФ (мгновенно, без сети)
  3) Avtocod превью (марка+год через Chrome/Playwright)
  4) NHTSA DecodeVINValuesBatch (быстрый пакетный)
  5) живой drom / NHTSA через lookup_query (по одному, с паузой)

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

from vin_lookup.avtocod import lookup_avtocod_vin  # noqa: E402
from vin_lookup.drom import cooldown_remaining, drom_cooling_down, lookup_drom  # noqa: E402
from vin_lookup.local_ru import decode_local  # noqa: E402
from vin_lookup.nhtsa import lookup_nhtsa  # noqa: E402
from vin_lookup.service import lookup_query  # noqa: E402
from vin_validator.iso3779 import normalize_vin  # noqa: E402

DEFAULT_XLSX = Path.home() / "Downloads" / "ВИН.xlsx"
OUT_DIR = _ROOT / "data" / "vin-parse"
RESULTS_PATH = OUT_DIR / "results.jsonl"
STATUS_PATH = OUT_DIR / "status.json"
PROGRESS_LOG_PATH = OUT_DIR / "progress.log"
WRITE_XLSX_PY = Path(__file__).resolve().parent / "write-vin-to-xlsx.py"
NHTSA_BATCH_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/"

# ponytail: быстрый режим — не сидим 3 минуты на 429; drom добираем короткими паузами
PARSE_GAP = float(os.environ.get("VIN_PARSE_GAP", "2.5"))
MAX_COOLDOWN_WAIT = float(os.environ.get("VIN_PARSE_MAX_COOLDOWN_WAIT", "8"))


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


def try_local(vin: str) -> dict | None:
    d = decode_local(vin)
    if not (d.make or d.model or d.year):
        return None
    return {
        "vin": vin,
        "ok": True,
        "make": d.make,
        "model": d.model,
        "year": d.year,
        "source": "local",
    }


def try_avtocod(vin: str) -> dict | None:
    info = lookup_avtocod_vin(vin)
    if not info.found:
        return None
    return {
        "vin": vin,
        "ok": True,
        "make": _clean(info.make),
        "model": _clean(info.model),
        "year": _clean(info.model_year),
        "source": "avtocod",
    }


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


def _info_to_row(vin: str, info, source: str) -> dict:
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
        "source": source,
        "err": None if ok else (getattr(info, "lookup_error", None) or "нет данных"),
    }


def live_lookup(vin: str, *, allow_drom: bool = True) -> dict:
    if allow_drom and not drom_cooling_down():
        info = lookup_query(vin, try_corrections=False)
        src = ",".join(info.sources_used or ([info.source] if info.source else [])) or "lookup"
        return _info_to_row(vin, info, src)
    # быстро: только NHTSA, без ожидания drom
    normalized = normalize_vin(vin) if len(vin) >= 11 else vin
    info = lookup_nhtsa(vin, normalized)
    return _info_to_row(vin, info, "nhtsa")


def wait_cooldown_brief() -> bool:
    """Ждём cooldown не дольше MAX_COOLDOWN_WAIT. True = можно снова бить в drom."""
    if not drom_cooling_down():
        return True
    rem = cooldown_remaining()
    if rem > MAX_COOLDOWN_WAIT:
        return False
    left = rem + 0.3
    while left > 0 and drom_cooling_down():
        time.sleep(min(1.0, left))
        left -= 1.0
    return not drom_cooling_down()


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

    # --- pass 0: локальная расшифровка (мгновенно, без сети) ---
    # Заполняем пробелы у всех VIN из файла, не только queue.
    local_hits = 0
    for vin in vins:
        loc = try_local(vin)
        if not loc:
            continue
        before = dict(rows.get(vin) or {"vin": vin})
        rows[vin] = _merge(before, loc, prefer_src=False)  # онлайн-данные важнее
        # но пустые поля берём из local; «год из будущего» тоже чиним
        for key in ("make", "model", "year"):
            cur = _clean(rows[vin].get(key))
            neu = _clean(loc.get(key))
            if not cur and neu:
                rows[vin][key] = loc[key]
            elif key == "year" and neu and cur:
                try:
                    if int(cur) > 2026 and int(neu) <= 2026:
                        rows[vin][key] = loc[key]
                except ValueError:
                    pass
        if rows[vin].get("make") or rows[vin].get("model") or rows[vin].get("year"):
            rows[vin]["ok"] = True
            rows[vin].pop("err", None)
        if rows[vin] != before:
            local_hits += 1
            if vin in queue or not _is_complete(before):
                note(vin, rows[vin], "local")
    if local_hits:
        save_results(rows)
        write_xlsx(xlsx)
        flush(True)
        _log(f"локально дополнено: {local_hits}")

    # --- pass 0b: Avtocod превью (марка/год; правит ошибки local WMI) ---
    need_avtocod = [
        v
        for v in vins
        if not _is_complete(rows.get(v) or {})
        or (
            (rows.get(v) or {}).get("source") == "local"
            and not _clean((rows.get(v) or {}).get("model"))
        )
    ]
    if os.environ.get("VIN_PARSE_SKIP_AVTOCOD", "").lower() not in ("1", "true", "yes"):
        _log(f"Avtocod превью: {len(need_avtocod)} VIN…")
        for i, vin in enumerate(need_avtocod):
            try:
                hit = try_avtocod(vin)
            except Exception as exc:  # noqa: BLE001
                _log(f"~ avtocod {vin}: {exc}")
                hit = None
            if not hit:
                continue
            before = dict(rows.get(vin) or {"vin": vin})
            # ponytail: Avtocod только дополняет пустое — title иногда врёт (Lada вместо URAL)
            merged = _merge(before, {**hit, "ok": True}, prefer_src=False)
            if any(_clean(hit.get(k)) for k in ("make", "model", "year")):
                if "avtocod" not in (merged.get("source") or ""):
                    merged["source"] = ((before.get("source") or "") + "+avtocod").strip("+")
                merged.pop("err", None)
            rows[vin] = merged
            note(vin, rows[vin], "avtocod")
            if (i + 1) % 2 == 0 or i + 1 == len(need_avtocod):
                save_results(rows)
                write_xlsx(xlsx)
                flush(True)
            time.sleep(0.4)

    # пересчитать queue: что ещё неполное
    still: list[str] = [v for v in queue if not _is_complete(rows.get(v) or {})]

    # --- pass 1: drom cache (мгновенно) ---
    still2: list[str] = []
    for vin in still:
        cached = try_drom_cache(vin)
        if cached and (cached.get("make") or cached.get("model") or cached.get("year")):
            rows[vin] = _merge(rows.get(vin) or {"vin": vin}, cached, prefer_src=True)
            rows[vin]["ok"] = True
            note(vin, rows[vin], "cache")
            if _is_complete(rows[vin]):
                continue
        still2.append(vin)
    still = still2
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

    # --- pass 3: живой поиск (быстро: короткие паузы, без ожидания 180с) ---
    need_live = [v for v in still if not _is_complete(rows.get(v) or {})]
    _log(
        f"живой поиск: {len(need_live)} VIN "
        f"(gap={PARSE_GAP}s, max_cooldown_wait={MAX_COOLDOWN_WAIT}s)"
    )

    deferred: list[str] = []
    for i, vin in enumerate(need_live):
        allow_drom = True
        if drom_cooling_down():
            if not wait_cooldown_brief():
                allow_drom = False
                deferred.append(vin)
                # не блокируемся: оставляем то, что уже есть / добьём drom позже
                if rows.get(vin) and (rows[vin].get("make") or rows[vin].get("model") or rows[vin].get("year")):
                    rows[vin]["ok"] = True
                    note(vin, rows[vin], rows[vin].get("source") or "partial")
                    continue
                live = live_lookup(vin, allow_drom=False)
                rows[vin] = _merge(rows.get(vin) or {"vin": vin}, live, prefer_src=True)
                rows[vin]["ok"] = bool(rows[vin].get("make") or rows[vin].get("model") or rows[vin].get("year"))
                if not rows[vin]["ok"]:
                    rows[vin]["err"] = "ждём drom (cooldown)"
                note(vin, rows[vin], "nhtsa-fast")
                if (i + 1) % 5 == 0:
                    save_results(rows)
                    write_xlsx(xlsx)
                    flush(True)
                continue

        if i and allow_drom:
            time.sleep(PARSE_GAP)
        try:
            live = live_lookup(vin, allow_drom=allow_drom)
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
            if "лимит" in str(rows[vin].get("err") or "").lower() or "429" in str(rows[vin].get("err") or ""):
                deferred.append(vin)
        else:
            rows[vin]["ok"] = True

        note(vin, rows[vin], rows[vin].get("source") or "live")
        if (i + 1) % 3 == 0 or i + 1 == len(need_live):
            save_results(rows)
            write_xlsx(xlsx)
            flush(True)

    # --- pass 4: короткий добор drom только по неполным (без долгих sleep) ---
    need_drom = []
    seen = set()
    for vin in deferred + [v for v in still if not _is_complete(rows.get(v) or {})]:
        if vin in seen:
            continue
        seen.add(vin)
        if not _is_complete(rows.get(vin) or {}):
            need_drom.append(vin)

    if need_drom:
        _log(f"добор drom: {len(need_drom)} VIN (без ожидания длинного cooldown)")
        for i, vin in enumerate(need_drom):
            if drom_cooling_down() and not wait_cooldown_brief():
                _log(f"~ drom всё ещё в cooldown — останавливаем добор, осталось {len(need_drom) - i}")
                break
            if i:
                time.sleep(PARSE_GAP)
            try:
                live = live_lookup(vin, allow_drom=True)
            except Exception as exc:
                live = {"vin": vin, "ok": False, "err": str(exc), "make": None, "model": None, "year": None, "source": "error"}
            rows[vin] = _merge(rows.get(vin) or {"vin": vin}, live, prefer_src=True)
            rows[vin]["ok"] = bool(rows[vin].get("make") or rows[vin].get("model") or rows[vin].get("year"))
            if not rows[vin]["ok"]:
                rows[vin]["err"] = live.get("err") or rows[vin].get("err") or "нет данных"
            else:
                rows[vin].pop("err", None)
            note(vin, rows[vin], rows[vin].get("source") or "drom")
            if (i + 1) % 3 == 0 or i + 1 == len(need_drom):
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
