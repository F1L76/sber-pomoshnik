#!/usr/bin/env python3
"""Правка явных орфоошибок в conclusion_qa_rag.xlsx + пересборка sqlite.

ponytail: точечный словарь замен, без полного spellcheck; ceiling — новые опечатки
вне списка; upgrade — hunspell/LanguageTool по корпусу.
"""

from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "conclusion_qa_rag.xlsx"
DB = ROOT / "data" / "conclusion_qa.sqlite"

# (wrong, right) — целые слова / короткие фразы, регистр восстанавливаем
_WORD_FIXES: list[tuple[str, str]] = [
    ("обьекту", "объекту"),
    ("обьекты", "объекты"),
    ("обьект", "объект"),
    ("небходимо", "необходимо"),
    ("несоотвествия", "несоответствия"),
    ("несоотвествий", "несоответствий"),
    ("колличества", "количества"),
    ("коментарии", "комментарии"),
    ("зарегестрировано", "зарегистрировано"),
    ("расчитанная", "рассчитанная"),
    ("расчитан", "рассчитан"),
    ("дааных", "данных"),
    ("данныи", "данным"),
    ("перевсти", "перевести"),
    ("наличиии", "наличии"),
    ("назодится", "находится"),
    ("ходите получить", "хотите получить"),
    ("посегменту", "по сегменту"),
]

# после правок не должно остаться (word-boundary)
_MUST_GONE = [
    r"обьект\w*",
    r"небходимо",
    r"несоотвеств\w*",
    r"колличеств\w*",
    r"коментар\w*",
    r"зарегестр\w*",
    r"\bрасчита\w*",
    r"дааных",
    r"данныи",
    r"перевсти",
    r"наличиии+",
    r"назодится",
]


def _preserve_case(src: str, replacement: str) -> str:
    if src.isupper():
        return replacement.upper()
    if src[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def fix_text(text: str) -> str:
    if not text:
        return text
    out = text
    for wrong, right in _WORD_FIXES:
        if " " in wrong:
            pat = re.compile(re.escape(wrong), re.I)
        else:
            pat = re.compile(rf"\b{re.escape(wrong)}\b", re.I)

        def repl(m: re.Match[str], r: str = right) -> str:
            return _preserve_case(m.group(0), r)

        out = pat.sub(repl, out)
    return out


def fix_xlsx(path: Path) -> int:
    import openpyxl

    wb = openpyxl.load_workbook(path)
    changed = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is None or not isinstance(cell.value, str):
                    continue
                neu = fix_text(cell.value)
                if neu != cell.value:
                    cell.value = neu
                    changed += 1
    wb.save(path)
    return changed


def rebuild_db() -> int:
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_conclusion_qa import build

    return build(XLSX, DB)


def remaining_typos(db: Path) -> list[tuple[int, str, str]]:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rx = re.compile("|".join(f"(?:{_})" for _ in _MUST_GONE), re.I)
        bad: list[tuple[int, str, str]] = []
        for sid, q, a in con.execute("SELECT id, question, answer FROM qa"):
            blob = f"{q}\n{a}"
            m = rx.search(blob)
            if m:
                bad.append((sid, m.group(0), blob[max(0, m.start() - 20) : m.end() + 20]))
        return bad
    finally:
        con.close()


def _selfcheck() -> None:
    assert fix_text("перевсти обьект") == "перевести объект"
    assert fix_text("Обьекты МиО") == "Объекты МиО"
    assert fix_text("В Коментарии указать") == "В Комментарии указать"
    assert fix_text("при наличиии обременений") == "при наличии обременений"
    assert fix_text("По данныи ГИБДД") == "По данным ГИБДД"
    assert fix_text("небходимо предоставить") == "необходимо предоставить"
    # не трогаем правильное
    assert "разделах" in fix_text("в разделах «Допущения»")
    print("fix_conclusion_qa_typos self-check ok")


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--selfcheck":
        _selfcheck()
        return 0
    if not XLSX.is_file():
        print(f"нет {XLSX}", file=sys.stderr)
        return 1
    _selfcheck()
    n_cells = fix_xlsx(XLSX)
    n_pairs = rebuild_db()
    left = remaining_typos(DB)
    print(f"xlsx ячеек изменено: {n_cells}")
    print(f"sqlite пар: {n_pairs}")
    if left:
        print("остались совпадения:", file=sys.stderr)
        for row in left[:10]:
            print(row, file=sys.stderr)
        return 1
    print("OK: известные опечатки убраны")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
