import assert from "assert";
import { parseNspdSearchBody } from "../lib/cadastral-lookup.mjs";

assert.strictEqual(parseNspdSearchBody("OK"), null);
assert.strictEqual(parseNspdSearchBody(""), null);
assert.strictEqual(parseNspdSearchBody("not-json"), null);

const ok = parseNspdSearchBody(
    JSON.stringify({ data: { type: "FeatureCollection", features: [{ id: 1 }] } })
);
assert.equal(ok.data.type, "FeatureCollection");
assert.equal(ok.data.features.length, 1);

console.log("ok: parseNspdSearchBody");
