"""Бесплатный превью-данные с vin.drom.ru (марка, модель, год и характеристики)."""

from __future__ import annotations

import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from vin_validator.iso3779 import normalize_vin

from .models import VehicleInfo

DROM_REPORT_URL = "https://vin.drom.ru/report/{vin}/"
DROM_BUY_TOKEN_URL = "https://vin.drom.ru/report/get_buy_token/"
DROM_CAR_DATA_URL = "https://vin.drom.ru/report/get_car_data/"
REQUEST_TIMEOUT = int(os.environ.get("DROM_HTTP_TIMEOUT", "25"))
USER_AGENT = "vin-checker/1.0 (preview; +https://vin.drom.ru)"
# ponytail: in-process cache + cooldown after 429; ceiling = one process, upgrade = Redis
_CACHE_TTL = int(os.environ.get("DROM_CACHE_TTL", "3600"))
_COOLDOWN_SEC = int(os.environ.get("DROM_COOLDOWN_SEC", "90"))
_cache: dict[str, tuple[float, VehicleInfo]] = {}
_cooldown_until = 0.0


def _cache_get(key: str) -> VehicleInfo | None:
    hit = _cache.get(key)
    if not hit:
        return None
    expires, info = hit
    if time.time() > expires:
        _cache.pop(key, None)
        return None
    from dataclasses import replace

    return replace(
        info,
        extra=dict(info.extra or {}),
        sources_used=list(info.sources_used or []),
    )


def _cache_set(key: str, info: VehicleInfo) -> None:
    if info.found:
        _cache[key] = (time.time() + _CACHE_TTL, info)


def drom_cooling_down() -> bool:
    return time.time() < _cooldown_until


def _mark_rate_limited() -> None:
    global _cooldown_until
    _cooldown_until = time.time() + _COOLDOWN_SEC


def rate_limited_result(raw: str, normalized: str) -> VehicleInfo:
    return VehicleInfo(
        vin=raw,
        normalized=normalized,
        found=False,
        source="drom",
        sources_used=["drom"],
        lookup_error=(
            "Слишком много запросов к источнику данных (HTTP 429). "
            "Подождите 1–2 минуты и повторите."
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

    if drom_cooling_down():
        return _rate_limited_result(raw_query, normalized)

    try:
        opener = _open_opener()
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
        result = _parse_car_data(raw_query, normalized, car_payload, plate=plate)
        _cache_set(cache_key, result)
        return result

    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            _mark_rate_limited()
            return _rate_limited_result(raw_query, normalized)
        msg = f"Ошибка сервера (HTTP {exc.code})"
        return VehicleInfo(
            vin=raw_query,
            normalized=normalized,
            found=False,
            source="drom",
            sources_used=["drom"],
            lookup_error=msg,
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
