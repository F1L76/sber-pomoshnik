import assert from "assert";
import { compactPoint, readProgressTail } from "../lib/nspd-geocode-store.mjs";

assert.equal(compactPoint(null), null);
assert.equal(compactPoint({ ok: false, kn: "77:01:0001008:3459" }), null);
assert.equal(compactPoint({ kn: "77:01:0001008:3459", lat: 55.757323261, lon: 37.617424424 }).lat, 55.757323);
assert.equal(compactPoint({ cadastralNumber: "36:34:0403001:3572", lat: 51.65, lon: 39.18, t: "Машино-места" }).t, "Машино-места");
assert.equal(compactPoint({ kn: "", lat: 1, lon: 2 }), null);
assert.ok(Array.isArray(readProgressTail(3)));
console.log("ok: compactPoint");
