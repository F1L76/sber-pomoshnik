"""Бесплатное превью Avtocod: https://avtocod.ru/proverkaavto/{VIN}?rd=VIN

Через Playwright + системный Chrome (JS-challenge). Марка и год — из title/превью.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from typing import Any

from .models import VehicleInfo

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# часто встречающиеся кириллические марки → латиница как в остальных источниках
_MAKE_NORM = {
    "УРАЛ": "URAL",
    "УАЗ": "UAZ",
    "ВАЗ": "LADA",
    "ЛАДА": "LADA",
    "LADA (ВАЗ)": "LADA",
    "LADA(ВАЗ)": "LADA",
    "ГАЗ": "GAZ",
    "МАЗ": "MAZ",
    "ЛИАЗ": "LIAZ",
    "ПАЗ": "PAZ",
    "КАВЗ": "KAVZ",
    "НЕФАЗ": "NEFAZ",
    "БЕЛАЗ": "BELAZ",
    "КАМАЗ": "KAMAZ",
    "RENAULT": "RENAULT",
}


def _chrome_path() -> str | None:
    for p in (
        os.environ.get("CHROME_PATH"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
    ):
        if p and os.path.exists(p):
            return p
    return None


def parse_avtocod_preview(title: str, body: str, vin: str) -> dict[str, str | None]:
    """Достаёт make/year/model из title и текста превью (без сети)."""
    make = model = year = None
    title_s = (title or "").replace("\xa0", " ")
    body_s = (body or "").replace("\xa0", " ")
    # ponytail: марка только из title «Проверить {марка} по ВИН» — в body полно рекламных примеров
    m = re.search(r"Проверить\s+(.+?)\s+по\s+ВИН", title_s, re.I)
    if m:
        make = m.group(1).strip()
    # год: сначала явная строка, потом «Марка, 2019 г.» в первых строках body
    m = re.search(r"Год производства:\s*(\d{4})", body_s, re.I)
    if m:
        year = m.group(1)
    head = "\n".join(body_s.splitlines()[:12])
    if not year:
        m = re.search(r",\s*(\d{4})\s*г", head, re.I)
        if m:
            year = m.group(1)
    if not year:
        m = re.search(r",\s*(\d{4})\s*г", title_s, re.I)
        if m:
            year = m.group(1)
    m = re.search(r"^Модель[:\s]+([^\n]+)", body_s, re.I | re.M)
    if m:
        model = m.group(1).strip() or None
    if make:
        make = re.sub(r"^\d+\s*отчет\s+", "", make, flags=re.I).strip()
        make = _MAKE_NORM.get(make.upper(), _MAKE_NORM.get(make, make))
        if re.search(r"ваз|lada", make, re.I):
            make = "LADA"
        elif re.search(r"урал", make, re.I):
            make = "URAL"
        elif re.search(r"renault", make, re.I):
            make = "RENAULT"
    return {"make": make, "model": model, "year": year, "vin": vin}


def _node_script(vin: str) -> str:
    # ponytail: один inline-скрипт, без отдельного .mjs — меньше файлов
    return f"""
const {{ chromium }} = require('playwright-core');
const fs = require('fs');
(async () => {{
  const vin = {json.dumps(vin)};
  const exe = process.env.CHROME_PATH || {json.dumps(_chrome_path() or "")} || undefined;
  const browser = await chromium.launch({{
    headless: true,
    executablePath: exe && fs.existsSync(exe) ? exe : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  }});
  const ctx = await browser.newContext({{
    locale: 'ru-RU',
    userAgent: {json.dumps(USER_AGENT)},
  }});
  const page = await ctx.newPage();
  await page.goto('https://avtocod.ru/proverkaavto/' + vin + '?rd=VIN', {{
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  }});
  try {{
    await page.waitForFunction(
      (v) => {{
        const t = document.title || '';
        const b = (document.body && document.body.innerText) || '';
        return t.includes(v) && /Проверить/i.test(t) && /\\d{{4}}\\s*г/i.test(b.replace(/\\u00a0/g,' '));
      }},
      vin,
      {{ timeout: 45000 }}
    );
  }} catch (_) {{}}
  await page.waitForTimeout(1200);
  const title = await page.title();
  const body = await page.evaluate(() => document.body.innerText.slice(0, 4000));
  await browser.close();
  process.stdout.write(JSON.stringify({{ title, body }}));
}})().catch((e) => {{
  console.error(String(e && e.message || e));
  process.exit(1);
}});
"""


def lookup_avtocod_vin(raw_vin: str, normalized: str | None = None) -> VehicleInfo:
    vin = (normalized or raw_vin or "").strip().upper()
    if len(vin) < 11:
        return VehicleInfo(
            vin=raw_vin,
            normalized=vin,
            found=False,
            source="avtocod",
            sources_used=["avtocod"],
            lookup_error="VIN слишком короткий",
        )
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        proc = subprocess.run(
            ["node", "-e", _node_script(vin)],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=int(os.environ.get("AVTOCOD_TIMEOUT", "90")),
            env={**os.environ, "CHROME_PATH": _chrome_path() or ""},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return VehicleInfo(
            vin=raw_vin,
            normalized=vin,
            found=False,
            source="avtocod",
            sources_used=["avtocod"],
            lookup_error=f"Avtocod: {exc}",
        )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "ошибка Playwright").strip().splitlines()[-1:]
        return VehicleInfo(
            vin=raw_vin,
            normalized=vin,
            found=False,
            source="avtocod",
            sources_used=["avtocod"],
            lookup_error=f"Avtocod: {err[0] if err else 'сбой'}",
        )
    try:
        payload: dict[str, Any] = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return VehicleInfo(
            vin=raw_vin,
            normalized=vin,
            found=False,
            source="avtocod",
            sources_used=["avtocod"],
            lookup_error="Avtocod: некорректный JSON",
        )
    parsed = parse_avtocod_preview(payload.get("title") or "", payload.get("body") or "", vin)
    make, model, year = parsed["make"], parsed["model"], parsed["year"]
    if not (make or model or year):
        return VehicleInfo(
            vin=raw_vin,
            normalized=vin,
            found=False,
            source="avtocod",
            sources_used=["avtocod"],
            lookup_error="Avtocod: нет данных в превью",
        )
    return VehicleInfo(
        vin=raw_vin,
        normalized=vin,
        found=True,
        source="avtocod",
        sources_used=["avtocod"],
        make=make,
        model=model,
        model_year=year,
        extra={"Источник": "Avtocod превью"},
    )


def _selfcheck() -> None:
    p = parse_avtocod_preview(
        "Проверить Урал по ВИН X898060F9K0GG9027 — Автокод",
        "Урал, 2019 г.\n\nVIN: X898060F9K0GG9027\nГод производства: 2019\n",
        "X898060F9K0GG9027",
    )
    assert p["make"] == "URAL", p
    assert p["year"] == "2019", p
    print("avtocod parse self-check ok")


if __name__ == "__main__":
    _selfcheck()
    if os.environ.get("AVTOCOD_LIVE") == "1":
        info = lookup_avtocod_vin("X898060F9K0GG9027")
        print(info.found, info.make, info.model, info.model_year, info.lookup_error)
