/**
 * Регрессия RAG по эталону data/gl_rag/eval-gold.json.
 * Usage:
 *   node scripts/eval-conclusion-qa.mjs          # только поиск (hit)
 *   node scripts/eval-conclusion-qa.mjs --ask    # + ответ через /ask (нужен прокси)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { searchConclusionQa } from "../lib/conclusion-qa.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(__dirname, "..", "data", "gl_rag", "eval-gold.json");
const OUT = path.join(__dirname, "..", "data", "gl_rag", "eval-last.json");
const ASK = process.argv.includes("--ask");
const PROXY = process.env.GIGACHAT_PROXY || "http://127.0.0.1:8787";

function norm(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/ё/g, "е");
}

function hasMarker(blob, marker) {
    const m = norm(marker);
    if (!m) return false;
    // фраза с пробелом — как есть; иначе префикс/вхождение токена
    if (m.includes(" ")) return blob.includes(m);
    return blob.includes(m);
}

function scoreMust(blob, must = [], mustAny = []) {
    const b = norm(blob);
    const mustHits = must.filter((m) => hasMarker(b, m));
    const mustOk = must.length === 0 || mustHits.length >= Math.min(2, must.length) || mustHits.length === must.length;
    let anyOk = true;
    const anyHits = [];
    for (const group of mustAny) {
        const g = Array.isArray(group) ? group : [group];
        const hit = g.find((m) => hasMarker(b, m));
        if (hit) anyHits.push(hit);
        else anyOk = false;
    }
    return {
        ok: mustOk && anyOk,
        mustHits,
        anyHits,
        mustNeed: must,
        anyNeed: mustAny
    };
}

async function askProxy(question) {
    const res = await fetch(`${PROXY}/api/conclusion-qa/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, nocache: true })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function main() {
    const gold = JSON.parse(fs.readFileSync(GOLD, "utf8"));
    const items = gold.items || [];
    const rows = [];

    for (const it of items) {
        const search = searchConclusionQa(it.q, { limit: 5 });
        const hits = search.hits || [];
        const hitBlob = hits.map((h) => `${h.question}\n${h.answer}`).join("\n");
        const hitScore = scoreMust(hitBlob, it.must, it.must_any || []);
        const top1 = hits[0] || null;
        rows.push({
            id: it.id,
            q: it.q,
            has_correction: !!it.has_correction,
            hit_count: hits.length,
            hit_ok: hitScore.ok && hits.length > 0,
            hit_must: hitScore.mustHits,
            hit_any: hitScore.anyHits,
            top1_score: top1?.score ?? null,
            top1_q: top1 ? String(top1.question || "").slice(0, 120) : null,
            offTopic: !!search.offTopic,
            ask_ok: null,
            ask_must: null
        });
    }

    const runAsk = async () => {
        for (const row of rows) {
            const it = items.find((x) => x.id === row.id);
            try {
                const data = await askProxy(it.q);
                const sc = scoreMust(data.answer || "", it.must, it.must_any || []);
                row.ask_ok = sc.ok;
                row.ask_must = sc.mustHits;
                row.ask_any = sc.anyHits;
                row.answer_preview = String(data.answer || "").slice(0, 180);
            } catch (e) {
                row.ask_ok = false;
                row.ask_error = e.message || String(e);
            }
        }
    };

    const finish = () => {
        const n = rows.length;
        const hitOk = rows.filter((r) => r.hit_ok).length;
        const corr = rows.filter((r) => r.has_correction);
        const corrHit = corr.filter((r) => r.hit_ok).length;
        const askRows = rows.filter((r) => r.ask_ok !== null);
        const askOk = askRows.filter((r) => r.ask_ok).length;

        const summary = {
            at: new Date().toISOString(),
            mode: ASK ? "search+ask" : "search",
            total: n,
            hit_ok: hitOk,
            hit_rate: n ? +(hitOk / n).toFixed(3) : 0,
            corrected_total: corr.length,
            corrected_hit_ok: corrHit,
            corrected_hit_rate: corr.length ? +(corrHit / corr.length).toFixed(3) : null,
            ask_total: askRows.length || null,
            ask_ok: askRows.length ? askOk : null,
            ask_rate: askRows.length ? +(askOk / askRows.length).toFixed(3) : null,
            fails: rows
                .filter((r) => !r.hit_ok || r.ask_ok === false)
                .map((r) => ({
                    id: r.id,
                    q: r.q,
                    hit_ok: r.hit_ok,
                    ask_ok: r.ask_ok,
                    top1_q: r.top1_q,
                    ask_error: r.ask_error || undefined
                }))
        };

        fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2), "utf8");

        console.log(`Эталон: ${n} вопросов`);
        console.log(`Поиск (маркеры в top-5): ${hitOk}/${n} (${(summary.hit_rate * 100).toFixed(1)}%)`);
        console.log(
            `Из них с ручной корректировкой: ${corrHit}/${corr.length}` +
                (summary.corrected_hit_rate != null
                    ? ` (${(summary.corrected_hit_rate * 100).toFixed(1)}%)`
                    : "")
        );
        if (ASK) {
            console.log(`Ответ ask: ${askOk}/${askRows.length} (${(summary.ask_rate * 100).toFixed(1)}%)`);
        }
        if (summary.fails.length) {
            console.log("\nПромахи:");
            for (const f of summary.fails.slice(0, 20)) {
                console.log(
                    `  #${f.id} hit=${f.hit_ok}${f.ask_ok == null ? "" : ` ask=${f.ask_ok}`} — ${f.q}`
                );
            }
            if (summary.fails.length > 20) console.log(`  … ещё ${summary.fails.length - 20}`);
        }
        console.log(`\nДетали: ${OUT}`);
    };

    if (ASK) {
        runAsk().then(finish).catch((e) => {
            console.error(e);
            process.exit(1);
        });
    } else {
        finish();
    }
}

main();
