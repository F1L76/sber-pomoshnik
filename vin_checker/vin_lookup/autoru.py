"""Поиск авто по госномеру / VIN через auto.ru/history (бесплатное превью отчёта)."""

from __future__ import annotations

import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any

from .models import VehicleInfo

AUTORU_HISTORY_URL = "https://auto.ru/history/"
AUTORU_RICH_REPORT_URL = "https://auto.ru/-/ajax/desktop/getRichVinReport/"
REQUEST_TIMEOUT = int(os.environ.get("AUTORU_HTTP_TIMEOUT", "25"))
MAX_RETRIES = int(os.environ.get("AUTORU_HTTP_RETRIES", "4"))
# ponytail: curl надёжнее urllib CookieJar на datacenter (Render) — иначе нет _csrf_token
USE_CURL = os.environ.get("AUTORU_CURL", "1").lower() not in ("0", "false", "no")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _s(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _field_text(block: dict[str, Any] | None, key: str) -> str | None:
    if not isinstance(block, dict):
        return None
    raw = block.get(key)
    if isinstance(raw, dict):
        return _s(raw.get("value_text")) or _s(raw.get("value"))
    return _s(raw)


def _csrf_from_set_cookie(headers: Any) -> str | None:
    """Достаёт _csrf_token из сырых Set-Cookie (если CookieJar проглотил)."""
    try:
        raw_list = headers.get_all("Set-Cookie")  # type: ignore[attr-defined]
    except (AttributeError, TypeError):
        single = headers.get("Set-Cookie") if headers else None
        raw_list = [single] if single else []
    for raw in raw_list or []:
        m = re.search(r"(?:^|,\s*)_csrf_token=([^;,\s]+)", str(raw))
        if m:
            return m.group(1)
    return None


def _csrf_from_jar(opener: urllib.request.OpenerDirector) -> str | None:
    jar = None
    for handler in opener.handlers:
        jar = getattr(handler, "cookiejar", None)
        if jar is not None:
            break
    if jar is None:
        return None
    for cookie in jar:
        if cookie.name == "_csrf_token":
            return cookie.value
    return None


def _csrf_from_netscape(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if not line.strip() or line.startswith("#"):
                    # #HttpOnly_ lines still have the name in field 5 after split
                    if not line.startswith("#HttpOnly_"):
                        continue
                    line = line[len("#HttpOnly_") :]
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 7 and parts[5] == "_csrf_token":
                    return parts[6]
    except OSError:
        return None
    return None


def _curl_bin() -> str | None:
    if not USE_CURL:
        return None
    return shutil.which("curl")


def _curl_post_report(query: str) -> dict[str, Any]:
    curl = _curl_bin()
    if not curl:
        raise RuntimeError("curl не найден")

    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with tempfile.TemporaryDirectory(prefix="autoru-") as td:
                jar = os.path.join(td, "cookies.txt")
                warm = subprocess.run(
                    [
                        curl,
                        "-sS",
                        "-L",
                        "--compressed",
                        "--max-time",
                        str(REQUEST_TIMEOUT),
                        "-A",
                        USER_AGENT,
                        "-H",
                        "Accept: text/html,application/xhtml+xml",
                        "-H",
                        "Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                        "-c",
                        jar,
                        "-b",
                        jar,
                        AUTORU_HISTORY_URL,
                    ],
                    capture_output=True,
                    timeout=REQUEST_TIMEOUT + 5,
                )
                if warm.returncode != 0:
                    err = (warm.stderr or warm.stdout or b"").decode("utf-8", "replace")
                    raise RuntimeError(f"curl /history/: {err.strip() or warm.returncode}")

                csrf = _csrf_from_netscape(jar)
                if not csrf:
                    raise RuntimeError("Не удалось получить CSRF auto.ru")

                body = json.dumps(
                    {"vin_or_license_plate": query}, ensure_ascii=False
                ).encode("utf-8")
                post = subprocess.run(
                    [
                        curl,
                        "-sS",
                        "-L",
                        "--compressed",
                        "--max-time",
                        str(REQUEST_TIMEOUT),
                        "-A",
                        USER_AGENT,
                        "-H",
                        "Content-Type: application/json;charset=UTF-8",
                        "-H",
                        "Accept: */*",
                        "-H",
                        "Origin: https://auto.ru",
                        "-H",
                        f"Referer: {AUTORU_HISTORY_URL}",
                        "-H",
                        f"x-csrf-token: {csrf}",
                        "-c",
                        jar,
                        "-b",
                        jar,
                        "--data-binary",
                        "@-",
                        AUTORU_RICH_REPORT_URL,
                    ],
                    input=body,
                    capture_output=True,
                    timeout=REQUEST_TIMEOUT + 5,
                )
                if post.returncode != 0:
                    err = (post.stderr or post.stdout or b"").decode("utf-8", "replace")
                    raise RuntimeError(f"curl report: {err.strip() or post.returncode}")
                text = post.stdout.decode("utf-8", "replace").strip()
                if not text:
                    raise RuntimeError("Пустой ответ Авто.ру")
                return json.loads(text)
        except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError, RuntimeError) as exc:
            last = exc
            time.sleep(0.8 + attempt * 0.5)
    raise RuntimeError(f"Авто.ру (curl): сбой ({last})")


def _open_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def _warm_session(opener: urllib.request.OpenerDirector) -> str:
    # ponytail: CSRF из лендинга /history/ — без него ajax 403; auto.ru часто рвёт TLS
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(
                AUTORU_HISTORY_URL,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
                },
            )
            with opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
                csrf = _csrf_from_jar(opener) or _csrf_from_set_cookie(resp.headers)
            if csrf:
                return csrf
            last = RuntimeError("Не удалось получить CSRF auto.ru")
        except Exception as exc:  # noqa: BLE001 — ретраим сеть
            last = exc
        time.sleep(0.8 + attempt * 0.5)
    raise RuntimeError(f"Авто.ру: не открыть /history/ ({last})")


def _post_report(
    opener: urllib.request.OpenerDirector, csrf: str, query: str
) -> dict[str, Any]:
    body = json.dumps({"vin_or_license_plate": query}, ensure_ascii=False).encode("utf-8")
    last: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(
                AUTORU_RICH_REPORT_URL,
                data=body,
                headers={
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/json;charset=UTF-8",
                    "Accept": "*/*",
                    "Origin": "https://auto.ru",
                    "Referer": AUTORU_HISTORY_URL,
                    "x-csrf-token": csrf,
                },
                method="POST",
            )
            with opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError:
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.8 + attempt * 0.5)
    raise urllib.error.URLError(f"Авто.ру: сбой запроса отчёта ({last})")


def _parse_report(raw_query: str, normalized: str, payload: dict[str, Any]) -> VehicleInfo:
    if payload.get("status") == "ERROR" or payload.get("error"):
        err = _s(payload.get("error")) or "NOT_FOUND"
        if err.upper() in ("NOT_FOUND", "NOT_FOUND_ERROR"):
            msg = "По этому госномеру данных на Авто.ру не найдено"
        else:
            msg = f"Авто.ру: {err}"
        return VehicleInfo(
            vin=raw_query,
            normalized=normalized,
            found=False,
            source="autoru",
            sources_used=["autoru"],
            lookup_error=msg,
        )

    report = payload.get("report") if isinstance(payload.get("report"), dict) else {}
    pts = report.get("pts_info") if isinstance(report.get("pts_info"), dict) else {}
    vehicle = report.get("vehicle") if isinstance(report.get("vehicle"), dict) else {}

    make = _field_text(pts, "mark") or _field_text(vehicle, "mark")
    model = _field_text(pts, "model") or _field_text(vehicle, "model")
    year = _field_text(pts, "year") or _field_text(vehicle, "year")
    if year:
        year = re.sub(r"[^\d]", "", year) or year
    color = _field_text(pts, "color")
    power = _field_text(pts, "horse_power")
    displacement = _field_text(pts, "displacement")
    vin_masked = _s(pts.get("vin")) or _s(report.get("vin"))

    title = _s((report.get("header") or {}).get("title"))
    if not (make or model) and title:
        # «Lexus LX, 2016»
        m = re.match(r"^([^,]+?)(?:,\s*(\d{4}))?$", title)
        if m:
            head = m.group(1).strip()
            parts = head.split(None, 1)
            make = make or (parts[0] if parts else None)
            model = model or (parts[1] if len(parts) > 1 else None)
            year = year or m.group(2)

    if not (make or model or year or vin_masked):
        return VehicleInfo(
            vin=raw_query,
            normalized=normalized,
            found=False,
            source="autoru",
            sources_used=["autoru"],
            lookup_error="По этому госномеру данных на Авто.ру не найдено",
        )

    extra: dict[str, str] = {"Госномер": normalized, "Источник": "Авто.ру История"}
    if vin_masked:
        extra["VIN"] = vin_masked
    if color:
        extra["Цвет"] = color
    if power:
        extra["Мощность"] = power
    if displacement:
        extra["Объём"] = displacement
    if title:
        extra["Заголовок отчёта"] = title

    return VehicleInfo(
        vin=raw_query,
        normalized=normalized,
        found=True,
        source="autoru",
        sources_used=["autoru"],
        make=make,
        model=model,
        model_year=year,
        color=color,
        power_hp=re.sub(r"[^\d]", "", power) if power else None,
        extra=extra,
    )


def lookup_autoru_plate(raw_plate: str, normalized: str | None = None) -> VehicleInfo:
    """Бесплатное превью отчёта Авто.ру по госномеру (или VIN в том же поле)."""
    from vin_validator.plate import normalize_plate, plate_error

    normalized = normalized or normalize_plate(raw_plate)
    err = plate_error(normalized)
    if err:
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="autoru",
            lookup_error=err,
        )

    try:
        # ponytail: сначала curl (cookies на Render), urllib — запасной
        if _curl_bin():
            try:
                payload = _curl_post_report(normalized)
                return _parse_report(raw_plate, normalized, payload)
            except RuntimeError:
                pass

        opener = _open_opener()
        csrf = _warm_session(opener)
        payload = _post_report(opener, csrf, normalized)
        return _parse_report(raw_plate, normalized, payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            msg = (
                "Слишком много запросов к Авто.ру (HTTP 429). "
                "Подождите минуту и повторите."
            )
        elif exc.code in (403, 401):
            msg = "Авто.ру временно недоступен. Повторите позже."
        else:
            msg = f"Ошибка Авто.ру (HTTP {exc.code})"
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="autoru",
            sources_used=["autoru"],
            lookup_error=msg,
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, RuntimeError) as exc:
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="autoru",
            sources_used=["autoru"],
            lookup_error=f"Ошибка сети Авто.ру: {exc}",
        )


if __name__ == "__main__":
    # offline: нормализация + разбор превью (без сети)
    from vin_validator.plate import normalize_plate, plate_error

    n = normalize_plate("O093HP76")
    assert n == "О093НР76" and plate_error(n) is None, n
    sample = {
        "status": "SUCCESS",
        "report": {
            "header": {"title": "Honda CR-V, 2008"},
            "pts_info": {
                "mark": {"value_text": "Honda"},
                "model": {"value_text": "CR-V"},
                "year": {"value_text": "2008"},
                "color": {"value_text": "Серый"},
                "horse_power": {"value_text": "166 л.с."},
                "vin": "SHS**************",
            },
        },
    }
    info = _parse_report("О093НР76", n, sample)
    assert info.found and info.make == "Honda" and info.model == "CR-V"
    assert info.model_year == "2008" and info.extra.get("VIN", "").startswith("SHS")
    print("autoru self-check ok:", info.make, info.model, info.model_year)

    if os.environ.get("AUTORU_LIVE_CHECK", "").lower() in ("1", "true", "yes"):
        live = lookup_autoru_plate("О093НР76")
        assert live.source == "autoru"
        assert live.found, live.lookup_error
        assert live.make, live
        print("autoru live:", live.found, live.make, live.model, live.model_year)
