#!/usr/bin/env python3
"""Мини-проверка FTS-индекса «Вопросы по заключению»."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "conclusion_qa.sqlite"


def main() -> int:
    assert DB.is_file(), f"нет {DB} — сначала: python3 scripts/build_conclusion_qa.py"
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        n = con.execute("SELECT COUNT(*) FROM qa").fetchone()[0]
        assert n >= 100, f"слишком мало пар: {n}"
        rows = con.execute(
            """
            SELECT qa.question, qa.answer
            FROM qa_fts JOIN qa ON qa.id = qa_fts.rowid
            WHERE qa_fts MATCH '"приоритет"'
            ORDER BY bm25(qa_fts)
            LIMIT 3
            """
        ).fetchall()
        assert rows, "FTS не нашёл «приоритет»"
        assert any("приоритет" in (q + a).lower() for q, a in rows)
        print(f"OK: {n} пар, sample: {rows[0][0][:80]!r}")
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
