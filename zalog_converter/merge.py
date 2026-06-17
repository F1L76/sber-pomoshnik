"""Сборка сводного отчёта из PDF и XLSX."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .pdf_extract import ConclusionData, extract_conclusion_from_pdf, parse_conclusion_text
from .report_html import render_full_report
from .risk_minimization import enrich_risks_with_minimization
from .xlsx_extract import CollateralObject, XlsxParseResult, parse_xlsx


@dataclass
class MergedReport:
    conclusion: ConclusionData
    objects: list[CollateralObject]
    html: str
    xlsx_preview: XlsxParseResult | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "conclusion": self.conclusion.to_dict(),
            "objects": [obj.to_dict() for obj in self.objects],
            "object_count": len(self.objects),
        }
        if self.xlsx_preview is not None:
            payload["xlsx_preview"] = self.xlsx_preview.to_dict()
        return payload


def build_report(pdf_bytes: bytes, xlsx_bytes: bytes) -> MergedReport:
    xlsx_result = parse_xlsx(xlsx_bytes)
    conclusion = extract_conclusion_from_pdf(pdf_bytes, object_count=len(xlsx_result.objects))
    enrich_risks_with_minimization(conclusion.risks)
    html = render_full_report(conclusion, xlsx_result.objects)
    return MergedReport(
        conclusion=conclusion,
        objects=xlsx_result.objects,
        html=html,
        xlsx_preview=xlsx_result,
    )


def build_report_from_text(pdf_text: str, xlsx_bytes: bytes) -> MergedReport:
    xlsx_result = parse_xlsx(xlsx_bytes)
    conclusion = parse_conclusion_text(pdf_text, object_count=len(xlsx_result.objects))
    enrich_risks_with_minimization(conclusion.risks)
    html = render_full_report(conclusion, xlsx_result.objects)
    return MergedReport(
        conclusion=conclusion,
        objects=xlsx_result.objects,
        html=html,
        xlsx_preview=xlsx_result,
    )
