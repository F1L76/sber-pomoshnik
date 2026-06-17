"""Преобразование краткой формы залогового заключения (PDF + XLSX) в единый отчёт."""

from .merge import build_report
from .pdf_extract import extract_conclusion_from_pdf
from .xlsx_extract import extract_objects_from_xlsx

__all__ = [
    "extract_conclusion_from_pdf",
    "extract_objects_from_xlsx",
    "build_report",
]
