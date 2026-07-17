"""Бесплатный превью-данные с vin.drom.ru (марка, модель, год и характеристики)."""

from __future__ import annotations

import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from vin_validator.iso3779 import normalize_vin

from .models import VehicleInfo

DROM_REPORT_URL = "https://vin.drom.ru/report/{vin}/"
DROM_BUY_TOKEN_URL = "https://vin.drom.ru/report/get_buy_token/"
DROM_CAR_DATA_URL = "https://vin.drom.ru/report/get_car_data/"
REQUEST_TIMEOUT = int(os.environ.get("DROM_HTTP_TIMEOUT", "25"))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
# ponytail: file-backed — Node spawns a new Python per request, so memory cache dies
_CACHE_TTL = int(os.environ.get("DROM_CACHE_TTL", "3600"))
_COOLDOWN_SEC = int(os.environ.get("DROM_COOLDOWN_SEC", "120"))
_MIN_GAP_SEC = float(os.environ.get("DROM_MIN_GAP", "8"))
_RETRY_WAIT_SEC = float(os.environ.get("DROM_RETRY_WAIT", "20"))
_MAX_WAIT_SEC = float(os.environ.get("DROM_MAX_WAIT", "50"))
_STATE_PATH = Path(
    os.environ.get(
        "DROM_STATE_PATH",
        str(Path(__file__).resolve().parents[2] / "data" / "drom-rate.json"),
    )
)
_CACHE_FIELDS = (
    "vin",
    "normalized",
    "found",
    "source",
    "sources_used",
    "make",
    "model",
    "model_year",
    "manufacturer",
    "series",
    "trim",
    "body_class",
    "vehicle_type",
    "doors",
    "drive_type",
    "fuel_type",
    "color",
    "category",
    "body_number",
    "engine_number",
    "power_hp",
    "power_kw",
    "engine_cylinders",
    "displacement_l",
    "engine_model",
    "engine_configuration",
    "transmission_style",
    "transmission_speeds",
    "plant_country",
    "plant_city",
    "plant_state",
    "gvwr",
    "extra",
    "lookup_error",
)


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"cooldown_until": 0, "cache": {}}


def _save_state(state: dict[str, Any]) -> None:
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_STATE_PATH)
    except OSError:
        pass


def _info_to_cache(info: VehicleInfo) -> dict[str, Any]:
    return {name: getattr(info, name) for name in _CACHE_FIELDS}


def _info_from_cache(data: dict[str, Any]) -> VehicleInfo:
    kwargs = {name: data.get(name) for name in _CACHE_FIELDS if name in data}
    kwargs.setdefault("vin", "")
    kwargs.setdefault("normalized", "")
    kwargs.setdefault("found", False)
    if kwargs.get("extra") is None:
        kwargs["extra"] = {}
    if kwargs.get("sources_used") is None:
        kwargs["sources_used"] = []
    return VehicleInfo(**kwargs)


def _cache_get(key: str) -> VehicleInfo | None:
    state = _load_state()
    hit = (state.get("cache") or {}).get(key)
    if not hit:
        return None
    if time.time() > float(hit.get("expires") or 0):
        state["cache"].pop(key, None)
        _save_state(state)
        return None
    return _info_from_cache(hit.get("data") or {})


def _cache_set(key: str, info: VehicleInfo) -> None:
    if not info.found:
        return
    state = _load_state()
    cache = state.setdefault("cache", {})
    now = time.time()
    # prune expired
    cache = {
        k: v
        for k, v in cache.items()
        if float(v.get("expires") or 0) > now
    }
    cache[key] = {"expires": now + _CACHE_TTL, "data": _info_to_cache(info)}
    state["cache"] = cache
    _save_state(state)


def drom_cooling_down() -> bool:
    state = _load_state()
    return time.time() < float(state.get("cooldown_until") or 0)


def _mark_rate_limited() -> None:
    state = _load_state()
    state["cooldown_until"] = time.time() + _COOLDOWN_SEC
    _save_state(state)


def _mark_request_done() -> None:
    state = _load_state()
    state["last_request_at"] = time.time()
    # successful request clears hard cooldown early
    state["cooldown_until"] = 0
    _save_state(state)


def _wait_before_request() -> None:
    """Ждём cooldown / минимальный интервал, чтобы не ловить 429 пачкой."""
    state = _load_state()
    now = time.time()
    wait = 0.0
    cooldown = float(state.get("cooldown_until") or 0)
    if now < cooldown:
        wait = max(wait, min(cooldown - now, _MAX_WAIT_SEC))
    last = float(state.get("last_request_at") or 0)
    gap = _MIN_GAP_SEC - (now - last)
    if gap > 0:
        wait = max(wait, gap)
    if wait > 0:
        time.sleep(wait)


def rate_limited_result(raw: str, normalized: str) -> VehicleInfo:
    return VehicleInfo(
        vin=raw,
        normalized=normalized,
        found=False,
        source="drom",
        sources_used=["drom"],
        lookup_error=(
            "Источник временно ограничил запросы. "
            "Повторите через пару минут — обычно помогает."
        ),
    )


def _rate_limited_result(raw: str, normalized: str) -> VehicleInfo:
    return rate_limited_result(raw, normalized)


def _split_make_model(full_model: str) -> tuple[str | None, str | None]:
    parts = full_model.strip().split(maxsplit=1)
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], parts[1]


def _open_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def _post_form(
    opener: urllib.request.OpenerDirector,
    url: str,
    data: dict[str, str],
    referer: str,
) -> dict[str, Any]:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json, text/plain, */*",
            "Referer": referer,
        },
        method="POST",
    )
    with opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _warm_session(opener: urllib.request.OpenerDirector, vin: str) -> str:
    report_url = DROM_REPORT_URL.format(vin=urllib.parse.quote(vin))
    req = urllib.request.Request(
        report_url,
        headers={"User-Agent": USER_AGENT},
    )
    with opener.open(req, timeout=REQUEST_TIMEOUT):
        pass
    return report_url


def _parse_car_data(
    raw_vin: str,
    normalized: str,
    payload: dict[str, Any],
    *,
    plate: str | None = None,
) -> VehicleInfo:
    if not payload.get("status"):
        msg = payload.get("message") or payload.get("error") or "Дром не вернул данные"
        return VehicleInfo(
            vin=raw_vin,
            normalized=normalized,
            found=False,
            source="drom",
            sources_used=["drom"],
            lookup_error=str(msg),
        )

    car = payload.get("carData") or {}
    if not car:
        # ponytail: drom free preview often returns state=no-data for plates with no public cache
        if payload.get("state") == "no-data":
            msg = (
                "По этому госномеру бесплатных данных нет. "
                "Попробуйте VIN, если он известен."
                if plate
                else "По этому VIN бесплатных данных нет."
            )
        else:
            msg = (
                "Сервер не вернул данные по этому госномеру"
                if plate
                else "Сервер не вернул данные по этому VIN"
            )
        return VehicleInfo(
            vin=raw_vin,
            normalized=normalized,
            found=False,
            source="drom",
            sources_used=["drom"],
            lookup_error=msg,
        )

    full_model = str(car.get("model") or "").strip()
    make, model = _split_make_model(full_model)
    year = car.get("year")
    volume = car.get("volume")
    displacement_l = None
    if volume:
        try:
            displacement_l = str(round(float(volume) / 1000.0, 3))
        except (TypeError, ValueError):
            displacement_l = str(volume)

    vin_from_api = _s(car.get("vin")) or normalized
    extra: dict[str, str] = {}
    if volume:
        extra["Объём (см³)"] = str(volume)
    if plate:
        extra["Госномер"] = plate
        if vin_from_api and vin_from_api != plate:
            extra["VIN"] = vin_from_api

    display_normalized = vin_from_api if plate and vin_from_api else normalized

    return VehicleInfo(
        vin=raw_vin,
        normalized=display_normalized,
        found=True,
        source="drom",
        sources_used=["drom"],
        make=make,
        model=model or full_model or None,
        model_year=str(year) if year is not None else None,
        color=_s(car.get("color")),
        vehicle_type=_s(car.get("type")),
        power_hp=str(car.get("power")) if car.get("power") is not None else None,
        displacement_l=displacement_l,
        extra=extra,
    )


def _s(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _fetch_drom_once(
    opener: urllib.request.OpenerDirector,
    raw_query: str,
    normalized: str,
    query_field: str,
    *,
    plate: str | None = None,
) -> VehicleInfo:
    referer = _warm_session(opener, normalized)
    token_payload = _post_form(
        opener,
        DROM_BUY_TOKEN_URL,
        {query_field: normalized},
        referer,
    )
    if not token_payload.get("status") or not token_payload.get("token"):
        return VehicleInfo(
            vin=raw_query,
            normalized=normalized,
            found=False,
            source="drom",
            sources_used=["drom"],
            lookup_error="Не удалось начать проверку. Повторите позже.",
        )

    token = token_payload["token"]
    car_payload: dict[str, Any] = {}
    for attempt in range(3):
        car_payload = _post_form(
            opener,
            DROM_CAR_DATA_URL,
            {query_field: normalized, "token": token},
            referer,
        )
        car = car_payload.get("carData") or {}
        if car_payload.get("status") and car:
            break
        if car_payload.get("state") in ("pending", "loading"):
            time.sleep(0.4 * (attempt + 1))
            continue
        if attempt < 2:
            time.sleep(0.25)
    return _parse_car_data(raw_query, normalized, car_payload, plate=plate)


def _lookup_drom_query(
    raw_query: str,
    normalized: str,
    query_field: str,
    *,
    plate: str | None = None,
) -> VehicleInfo:
    cache_key = f"{query_field}:{normalized}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    _wait_before_request()

    last_exc: BaseException | None = None
    for round_i in range(2):
        try:
            opener = _open_opener()
            result = _fetch_drom_once(
                opener, raw_query, normalized, query_field, plate=plate
            )
            _mark_request_done()
            _cache_set(cache_key, result)
            return result
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code == 429:
                _mark_rate_limited()
                if round_i == 0:
                    time.sleep(_RETRY_WAIT_SEC)
                    continue
                return _rate_limited_result(raw_query, normalized)
            return VehicleInfo(
                vin=raw_query,
                normalized=normalized,
                found=False,
                source="drom",
                sources_used=["drom"],
                lookup_error=f"Ошибка сервера (HTTP {exc.code})",
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            return VehicleInfo(
                vin=raw_query,
                normalized=normalized,
                found=False,
                source="drom",
                sources_used=["drom"],
                lookup_error=f"Ошибка сети: {exc}",
            )

    if isinstance(last_exc, urllib.error.HTTPError) and last_exc.code == 429:
        return _rate_limited_result(raw_query, normalized)
    return VehicleInfo(
        vin=raw_query,
        normalized=normalized,
        found=False,
        source="drom",
        sources_used=["drom"],
        lookup_error="Не удалось получить данные",
    )


def lookup_drom(raw_vin: str, normalized: str | None = None) -> VehicleInfo:
    """
    Получает бесплатный превью с vin.drom.ru (как на странице перед покупкой отчёта).
    Полный отчёт (ДТП, владельцы) — платный, сюда не входит.
    """
    normalized = normalized or normalize_vin(raw_vin)
    if len(normalized) != 17:
        return VehicleInfo(
            vin=raw_vin,
            normalized=normalized,
            found=False,
            source="drom",
            lookup_error="VIN должен содержать 17 символов",
        )

    return _lookup_drom_query(raw_vin, normalized, "vin")


def lookup_drom_plate(raw_plate: str, normalized: str | None = None) -> VehicleInfo:
    """Бесплатный превью по госномеру (vin.drom.ru, поле carplate)."""
    from vin_validator.plate import normalize_plate, plate_error

    normalized = normalized or normalize_plate(raw_plate)
    err = plate_error(normalized)
    if err:
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="drom",
            lookup_error=err,
        )

    return _lookup_drom_query(raw_plate, normalized, "carplate", plate=normalized)
