import { BROWSER_HEADERS } from "../https-fetch.mjs";
import { formatPrice, parsePriceText } from "../listing-utils.mjs";

function parseOffersFromHtml(html, query, matchedBy) {
    const blocks = html.split(/data-offer-id="(\d+)"/);
    const offers = [];

    for (let i = 1; i < blocks.length; i += 2) {
        const id = blocks[i];
        const block = blocks[i + 1].slice(0, 14000);
        const url = (block.match(/href="(https:\/\/domclick\.ru\/card\/[^"?]+)/) || [])[1];
        const propHtml = (block.match(/data-test="product-snippet-property-offer"[^>]*>([\s\S]*?)<\/a>/) || [])[1];
        const propText = propHtml ? propHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
        const priceMatch = block.match(/(\d[\d\s]{3,})\s*₽/);
        const price = priceMatch ? parsePriceText(priceMatch[1]) : null;
        const address = (block.match(/data-test="product-snippet-address"[^>]*>([^<]+)/) || [])[1]?.trim() || null;
        const photos = [...block.matchAll(/https:\/\/img\.dmclk\.ru\/[^"\s]+/g)].map((m) => m[0]).slice(0, 8);

        offers.push({
            source: "domclick",
            id,
            title: propText || "Объявление Домклик",
            address,
            description: null,
            price,
            priceFormatted: priceMatch ? priceMatch[0].trim() : formatPrice(price),
            photos,
            url,
            matchedBy,
            searchQuery: query
        });
    }

    return offers;
}

async function searchOnce(query, matchedBy = null) {
    const url = `https://domclick.ru/search?text=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
    const html = await res.text();

    if (!res.ok) {
        throw new Error(`Домклик HTTP ${res.status}`);
    }
    if (html.length < 500) {
        throw new Error("Домклик вернул пустой ответ");
    }

    const matchType = matchedBy || "address";
    return parseOffersFromHtml(html, query, matchType);
}

async function runQueries(queries, matchedBy) {
    const results = [];
    const errors = [];
    for (const query of queries.slice(0, 2)) {
        try {
            const batch = await searchOnce(query, matchedBy);
            results.push(...batch);
            await new Promise((r) => setTimeout(r, 150));
        } catch (e) {
            errors.push(`Домклик («${query}»): ${e.message}`);
        }
    }
    return { results, errors };
}

export async function searchDomclick({ queries, streetQueries = [] }) {
    const seen = new Set(queries);
    const extraStreet = streetQueries.filter((q) => !seen.has(q)).slice(0, 1);
    const { results: precise, errors: e1 } = await runQueries(queries, "address");
    const { results: nearby, errors: e2 } = await runQueries(extraStreet, "street");
    return {
        listings: [...precise, ...nearby],
        errors: [...new Set([...e1, ...e2])]
    };
}
