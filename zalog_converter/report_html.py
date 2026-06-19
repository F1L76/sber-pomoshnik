"""HTML-отчёт в стиле прототипа «Сопровождение 2.0»."""

from __future__ import annotations

from typing import Any

from .pdf_extract import ConclusionData, ConclusionRisk
from .sber_styles import SBER_OBJECTS_TABLE_FILTER_SCRIPT, SBER_REPORT_CSS, SBER_REPORT_HEAD_LINKS
from .name_format import format_classifier_display
from .utils import calc_collateral_from_discount, escape_html, format_money
from .xlsx_extract import CollateralObject

REPORT_SCHEMA_VERSION = 7  # 7 = фильтр стоимости «от / до» с вводом на лету


def _unique_sorted(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text == "—" or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return sorted(out, key=lambda s: s.casefold())


def _select_filter(filter_id: str, options: list[str], all_label: str = "Все") -> str:
    opts = [f'<option value="">{escape_html(all_label)}</option>']
    opts.extend(
        f'<option value="{escape_html(o)}">{escape_html(o)}</option>' for o in options
    )
    return (
        f'<select class="form-select form-select-sm" data-obj-filter="{escape_html(filter_id)}" '
        f'aria-label="Фильтр">{"".join(opts)}</select>'
    )


def _text_filter(filter_id: str, placeholder: str, hint: str = "") -> str:
    hint_html = f'<span class="filter-hint">{escape_html(hint)}</span>' if hint else ""
    return (
        f'<input type="text" class="form-control form-control-sm" data-obj-filter="{escape_html(filter_id)}" '
        f'placeholder="{escape_html(placeholder)}" aria-label="Фильтр">{hint_html}'
    )


def _render_objects_filter_row(objects: list[CollateralObject]) -> str:
    classifiers = _unique_sorted([
        o.classifier_name or format_classifier_display(o.klassifikator_raw, o.klassifikator)
        for o in objects
    ])
    qualities = _unique_sorted([o.quality_category for o in objects])
    valtypes = _unique_sorted([o.valuation_type for o in objects])
    liquidities = _unique_sorted([o.liquidity for o in objects if o.liquidity])

    return f"""<tr class="filter-row">
          <th>{_text_filter("code", "Поиск…")}</th>
          <th>{_select_filter("classifier", classifiers)}</th>
          <th>{_text_filter("name", "Поиск…")}</th>
          <th>{_text_filter("identifier", "Поиск…")}</th>
          <th>{_select_filter("quality", qualities)}</th>
          <th>{_select_filter("valtype", valtypes)}</th>
          <th>
            <div class="d-flex flex-column gap-1">
              {_text_filter("costMin", "от")}
              {_text_filter("costMax", "до")}
            </div>
          </th>
          <th></th>
          <th></th>
          <th>
            <div class="d-flex flex-column gap-1 align-items-stretch">
              {_select_filter("liquidity", liquidities)}
              <button type="button" class="btn btn-outline-secondary btn-sm filter-reset-btn" id="objectsFilterReset" title="Сбросить фильтры">
                <i class="fas fa-rotate-left" aria-hidden="true"></i>
              </button>
            </div>
          </th>
        </tr>"""


def render_conclusion_info_block(conclusion: ConclusionData) -> str:
    client_name = conclusion.client_name or "—"
    inn = conclusion.borrower_inn or "—"
    number = conclusion.conclusion_number or "—"
    date = conclusion.conclusion_date or "—"
    validity = conclusion.validity_date or "—"
    credit_term = conclusion.credit_term or "—"
    return f"""<div class="info-card report-block conclusion-info-block">
  <h3 class="section-title"><i class="fas fa-file-contract me-2 text-success" aria-hidden="true"></i>Информация по заключению</h3>
  <dl class="row g-2 mb-0">
    <div class="col-12"><dt>Наименование клиента</dt><dd class="mb-0">{escape_html(client_name)}</dd></div>
    <div class="col-sm-6"><dt>ИНН</dt><dd class="mb-0">{escape_html(inn)}</dd></div>
    <div class="col-sm-6"><dt>Номер заключения</dt><dd class="mb-0">{escape_html(number)}</dd></div>
    <div class="col-sm-6"><dt>Дата заключения</dt><dd class="mb-0">{escape_html(date)}</dd></div>
    <div class="col-sm-6"><dt>Срок действия заключения</dt><dd class="mb-0">{escape_html(validity)}</dd></div>
    <div class="col-sm-6"><dt>Срок кредита</dt><dd class="mb-0">{escape_html(credit_term)}</dd></div>
  </dl>
</div>"""


def render_summary_block(conclusion: ConclusionData) -> str:
    if not conclusion.summary:
        return ""
    return f"""<div class="info-card report-block summary-block">
  <h3 class="section-title"><i class="fas fa-align-left me-2 text-success" aria-hidden="true"></i>Краткий пересказ</h3>
  <div class="mock-ai">
    <p class="mb-0 small">{escape_html(conclusion.summary)}</p>
  </div>
  <p class="hint">Сформировано по шаблону из извлечённых полей PDF (без GigaChat).</p>
</div>"""


def render_reference_block(conclusion: ConclusionData) -> str:
    text = (conclusion.reference_text or "").strip()
    if not text:
        return ""
    return f"""<div class="info-card report-block reference-block">
  <h3 class="section-title"><i class="fas fa-book me-2 text-success" aria-hidden="true"></i>Справочная информация</h3>
  <div class="reference-plain mb-0">{escape_html(text)}</div>
</div>"""


def render_risks_block(conclusion: ConclusionData) -> str:
    risks = conclusion.risks or []
    if not risks:
        return """<div class="info-card report-block risks-block">
  <h3 class="section-title"><i class="fas fa-triangle-exclamation me-2 text-warning" aria-hidden="true"></i>Риски</h3>
  <p class="muted mb-0">В заключении риски не выявлены или не распознаны из PDF автоматически.</p>
</div>"""

    rows = []
    for risk in risks:
        rows.append(
            "<tr>"
            f"<td>{escape_html(risk.identifier)}</td>"
            f"<td>{escape_html(risk.risk)}</td>"
            f"<td>{escape_html(risk.minimization)}</td>"
            "</tr>"
        )
    return f"""<div class="info-card report-block risks-block">
  <h3 class="section-title"><i class="fas fa-triangle-exclamation me-2 text-warning" aria-hidden="true"></i>Риски</h3>
  <p class="hint">Из таблицы PDF ({len(risks)}); минимизация — по справочнику рисков.</p>
  <div class="table-responsive-custom">
    <table class="table table-bordered table-striped table-details risks-table mb-0">
      <thead>
        <tr>
          <th>Объект</th>
          <th>Риск</th>
          <th>Минимизация</th>
        </tr>
      </thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
  </div>
</div>"""


def render_objects_block(objects: list[CollateralObject]) -> str:
    rows: list[str] = []
    total_estimated = 0.0
    total_collateral = 0.0

    for index, obj in enumerate(objects):
        conditional = obj.conditional or f"Obj-{index + 1}"
        klass = obj.classifier_name or format_classifier_display(obj.klassifikator_raw, obj.klassifikator)
        cost_num = float(obj.cost or 0)
        discount = float(obj.discount if obj.discount is not None else 40)
        coll_num = calc_collateral_from_discount(cost_num, discount)
        if obj.collateral_value and obj.collateral_value > 0:
            coll_num = float(obj.collateral_value)
        total_estimated += cost_num
        total_collateral += coll_num

        rows.append(
            "<tr>"
            f'<td class="col-code">{escape_html(conditional)}</td>'
            f'<td class="col-classifier">{escape_html(klass)}</td>'
            f'<td class="col-name">{escape_html(obj.name)}</td>'
            f'<td class="col-id">{escape_html(obj.identifier or "—")}</td>'
            f'<td class="col-quality">{escape_html(obj.quality_category)}</td>'
            f'<td class="col-valtype">{escape_html(obj.valuation_type)}</td>'
            f'<td class="text-end col-num">{format_money(cost_num)}&nbsp;₽</td>'
            f'<td class="text-end col-num">{format_money(coll_num)}&nbsp;₽</td>'
            f'<td class="text-end col-pct">{discount:.1f}%</td>'
            f'<td class="text-end col-liq">{escape_html(obj.liquidity or "—")}</td>'
            "</tr>"
        )

    filter_row = _render_objects_filter_row(objects)

    return f"""<div class="info-card report-block objects-block">
  <h3 class="section-title"><i class="fas fa-list me-2 text-success" aria-hidden="true"></i>Перечень объектов залога</h3>
  <p class="hint"><span class="badge-sber">XLSX: {len(objects)} объект(ов)</span>
    <span class="ms-2">Показано: <strong id="objectsVisibleCount">{len(objects)}</strong></span></p>
  <div class="table-responsive-custom">
    <table class="table table-bordered table-striped table-details table-hover objects-table mb-0">
      <colgroup>
        <col class="col-code">
        <col class="col-classifier">
        <col class="col-name">
        <col class="col-id">
        <col class="col-quality">
        <col class="col-valtype">
        <col class="col-num">
        <col class="col-num">
        <col class="col-pct">
        <col class="col-liq">
      </colgroup>
      <thead>
        <tr>
          <th class="col-code"><span class="th-lines">Условное<br>обозначение</span></th>
          <th class="col-classifier"><span class="th-lines">Классификатор</span></th>
          <th class="col-name"><span class="th-lines">Наименование</span></th>
          <th class="col-id"><span class="th-lines">Идентификатор</span></th>
          <th class="col-quality"><span class="th-lines">Категория<br>качества</span></th>
          <th class="col-valtype"><span class="th-lines">Вид<br>стоимости</span></th>
          <th class="text-end col-num"><span class="th-lines">Оценочная стоимость<br>без НДС</span></th>
          <th class="text-end col-num"><span class="th-lines">Залоговая стоимость<br>без НДС</span></th>
          <th class="text-end col-pct"><span class="th-lines">Дисконт<br>без НДС</span></th>
          <th class="text-end col-liq"><span class="th-lines">Ликвидность</span></th>
        </tr>
        {filter_row}
      </thead>
      <tbody>{"".join(rows)}</tbody>
      <tfoot>
        <tr class="totals-row">
          <td colspan="6" class="text-end"><strong>Итого</strong></td>
          <td class="text-end col-num"><strong data-total-est>{format_money(total_estimated)}&nbsp;₽</strong></td>
          <td class="text-end col-num"><strong data-total-coll>{format_money(total_collateral)}&nbsp;₽</strong></td>
          <td></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
  <script>{SBER_OBJECTS_TABLE_FILTER_SCRIPT}</script>
</div>"""


def render_notes_block(notes: list[str]) -> str:
    if not notes:
        return ""
    items = "".join(f"<li>{escape_html(note)}</li>" for note in notes)
    return f"""<div class="info-card report-block notes-block">
  <h3 class="section-title"><i class="fas fa-circle-info me-2 text-warning" aria-hidden="true"></i>Примечания к распознаванию</h3>
  <ul class="mb-0 ps-3 text-warning-emphasis">{items}</ul>
</div>"""


def render_full_report(
    conclusion: ConclusionData,
    objects: list[CollateralObject],
    *,
    title: str = "Краткая форма залогового заключения — сводный отчёт",
    standalone: bool = True,
) -> str:
    body = "\n".join(
        [
            render_conclusion_info_block(conclusion),
            render_summary_block(conclusion),
            render_reference_block(conclusion),
            render_risks_block(conclusion),
            render_objects_block(objects),
            render_notes_block(conclusion.extraction_notes),
        ]
    )

    if not standalone:
        return body

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{escape_html(title)}</title>
  {SBER_REPORT_HEAD_LINKS}
  <style>{SBER_REPORT_CSS}</style>
</head>
<body>
  <div class="report-page">
    <header class="report-hero d-flex align-items-center gap-3">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="#21A038" stroke="white" stroke-width="1.5"/>
        <path d="M12 20L18 26L28 14" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <h1>{escape_html(title)}</h1>
        <p><i class="fas fa-file-pdf me-1" aria-hidden="true"></i>PDF + <i class="fas fa-file-excel me-1" aria-hidden="true"></i>XLSX → единый отчёт · Сопровождение 2.0</p>
      </div>
    </header>
    {body}
  </div>
</body>
</html>"""
