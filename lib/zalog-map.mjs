/** Маппинг ответа zalog_converter → структура карточки клиента. */

export function mapConverterObject(obj) {
    const cost = Number(obj.cost) || 0;
    const discount = Number(obj.discount) || 0;
    const collateral = Number(obj.collateral_value);
    return {
        conditional: obj.conditional || "",
        klassifikator: obj.klassifikator || "",
        klassifikatorRaw: obj.klassifikator_raw || obj.classifier_name || "",
        classifierName: obj.classifier_name || "",
        name: obj.name || "",
        identifier: obj.identifier || "",
        qualityCategory: obj.quality_category || "Стандарт",
        valuationType: obj.valuation_type || "",
        cost,
        collateralValue: Number.isFinite(collateral) ? collateral : cost,
        discount,
        costType: obj.cost_type || (obj.valuation_type || "").toLowerCase(),
        bankMarketPrice: Number(obj.bank_market_price) || cost * 1.05,
        liquidity: obj.liquidity || ""
    };
}

export function mapConverterToConclusion(data, { html, clientInn } = {}) {
    const c = data?.conclusion || {};
    const objects = (data?.objects || []).map(mapConverterObject);
    let date = String(c.conclusion_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        date = new Date().toISOString().slice(0, 10);
    }

    return {
        id: String(c.conclusion_number || "").trim() || `ASZ${Date.now()}`,
        date,
        clientName: String(c.client_name || "").trim(),
        inn: String(c.borrower_inn || clientInn || "").trim(),
        summary: String(c.summary || "").trim(),
        validityDate: String(c.validity_date || "").trim(),
        creditTerm: String(c.credit_term || "").trim(),
        referenceText: String(c.reference_text || "").trim(),
        risks: (c.risks || []).map((r) => ({
            identifier: String(r.identifier || "—").trim(),
            risk: String(r.risk || "—").trim(),
            minimization: String(r.minimization || "—").trim(),
            riskNumber: String(r.risk_number || "").trim()
        })),
        objects,
        reportHtml: html || "",
        converterSource: "zalog-converter"
    };
}
