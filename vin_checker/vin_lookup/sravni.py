"""Поиск авто по госномеру через sravni.ru (ОСАГО proxy API)."""

from __future__ import annotations

import http.cookiejar
import json
import os
import urllib.error
import urllib.request
from typing import Any

from .models import VehicleInfo

SRAVNI_OSAGO_URL = "https://www.sravni.ru/osago/"
SRAVNI_PREV_POLICY_URL = (
    "https://www.sravni.ru/proxy-osagoinsurance/getPrevCalculationOrPolicy/"
)
REQUEST_TIMEOUT = int(os.environ.get("SRAVNI_HTTP_TIMEOUT", "25"))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _s(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _open_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def _warm_session(opener: urllib.request.OpenerDirector) -> None:
    # ponytail: cookies from landing page are enough; no captcha on this JSON proxy
    req = urllib.request.Request(
        SRAVNI_OSAGO_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
    )
    with opener.open(req, timeout=REQUEST_TIMEOUT):
        pass


def _post_json(
    opener: urllib.request.OpenerDirector, url: str, payload: dict[str, Any]
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Origin": "https://www.sravni.ru",
            "Referer": SRAVNI_OSAGO_URL,
        },
        method="POST",
    )
    with opener.open(req, timeout=REQUEST_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_prev_policy(
    raw_plate: str, normalized: str, payload: dict[str, Any]
) -> VehicleInfo:
    brand = _s(payload.get("brandName"))
    model = _s(payload.get("modelName"))
    year = payload.get("vehicleYear")
    year_s = str(year) if year is not None else None
    car_number = _s(payload.get("carNumber")) or normalized

    if not (brand or model or year_s):
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="sravni",
            sources_used=["sravni"],
            lookup_error="По этому госномеру данных не найдено",
        )

    extra: dict[str, str] = {"Госномер": car_number}
    owner = _s(payload.get("userName"))
    if owner:
        extra["Собственник (из полиса)"] = owner
    company = _s(payload.get("companyName"))
    if company:
        extra["СК (полис)"] = company
    policy_end = _s(payload.get("policyEndDate"))
    if policy_end:
        extra["Окончание полиса"] = policy_end[:10]

    return VehicleInfo(
        vin=raw_plate,
        normalized=normalized,
        found=True,
        source="sravni",
        sources_used=["sravni"],
        make=brand,
        model=model,
        model_year=year_s,
        extra=extra,
    )


def lookup_sravni_plate(raw_plate: str, normalized: str | None = None) -> VehicleInfo:
    """Бесплатные данные по госномеру из превью полиса ОСАГО на sravni.ru."""
    from vin_validator.plate import normalize_plate, plate_error

    normalized = normalized or normalize_plate(raw_plate)
    err = plate_error(normalized)
    if err:
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="sravni",
            lookup_error=err,
        )

    try:
        opener = _open_opener()
        _warm_session(opener)
        payload = _post_json(opener, SRAVNI_PREV_POLICY_URL, {"carNumber": normalized})
        return _parse_prev_policy(raw_plate, normalized, payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            msg = (
                "Слишком много запросов к источнику данных (HTTP 429). "
                "Подождите 1–2 минуты и повторите."
            )
        elif exc.code in (403, 401):
            msg = "Источник временно недоступен. Повторите позже."
        else:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("message")
            except Exception:
                detail = None
            msg = detail or f"Ошибка сервера (HTTP {exc.code})"
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="sravni",
            sources_used=["sravni"],
            lookup_error=msg,
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        return VehicleInfo(
            vin=raw_plate,
            normalized=normalized,
            found=False,
            source="sravni",
            sources_used=["sravni"],
            lookup_error=f"Ошибка сети: {exc}",
        )


if __name__ == "__main__":
    # ponytail: one live check; needs network
    info = lookup_sravni_plate("А123АА77")
    assert info.source == "sravni"
    print("sravni self-check:", info.found, info.make, info.model, info.lookup_error)
