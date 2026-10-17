import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_VERSION, canonicalJson, checksumOf, validateItem, validateScope, contentHash, itemApplies,
} from "./trainer-core.ts";

test("canonicalJson sorts keys recursively and keeps array order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
});

test("checksum is stable across key order", async () => {
  assert.equal(await checksumOf({ x: 1, y: [1, 2] }), await checksumOf({ y: [1, 2], x: 1 }));
  assert.match(await checksumOf({}), /^[0-9a-f]{64}$/);
});

test("CORE_VERSION is set", () => {
  assert.match(CORE_VERSION, /^\d+\.\d+\.\d+$/);
});

test("validateItem: fact needs topic and text", () => {
  assert.deepEqual(validateItem("fact", { topic: "Location", text: "Sector 16" }), []);
  assert.ok(validateItem("fact", { topic: "" }).length > 0);
  assert.ok(validateItem("fact", null).length > 0);
});

test("validateItem: project floor plans are {url,label}", () => {
  const ok = { name: "Wecon Nuznan", aliases: { bn: ["নুজনান"], banglish: ["nuznan"], en: ["nuznan"] },
    media: { photos: [], floor_plans: [{ url: "https://x/a.jpg", label: "Ground" }] } };
  assert.deepEqual(validateItem("project", ok), []);
  const bad = { ...ok, media: { photos: [], floor_plans: ["https://x/a.jpg"] } };
  assert.ok(validateItem("project", bad).length > 0);
});

test("validateItem: example needs conversation, ideal_reply, reason, source", () => {
  const ok = { conversation: [{ role: "customer", text: "dam koto?" }], ideal_reply: "Meeting?", reason: "no price", source: "handwritten" };
  assert.deepEqual(validateItem("example", ok), []);
  assert.ok(validateItem("example", { ...ok, source: "other" }).length > 0);
});

test("validateItem: unknown keys rejected", () => {
  assert.ok(validateItem("rule", { name: "x", when: "w", must: "m", extra: 1 }).length > 0);
});

test("validateScope", () => {
  const ids = new Set(["p1"]);
  assert.deepEqual(validateScope("fact", ["eyad"], "p1", ids), []);
  assert.deepEqual(validateScope("fact", ["eyad", "dubai"], null, ids), []);
  assert.ok(validateScope("fact", [], null, ids).length > 0);
  assert.ok(validateScope("fact", ["both"], null, ids).length > 0);
  assert.ok(validateScope("fact", ["eyad"], "p9", ids).length > 0);
  assert.ok(validateScope("behaviour", ["eyad"], "p1", ids).length > 0);
  assert.ok(validateScope("project", ["eyad"], "p1", ids).length > 0);
});

test("contentHash ignores key order", async () => {
  assert.equal(await contentHash("fact", { topic: "a", text: "b" }), await contentHash("fact", { text: "b", topic: "a" }));
});

test("itemApplies filters by bot and project", () => {
  assert.equal(itemApplies({ bots: ["eyad"], project_ref: null }, "eyad", []), true);
  assert.equal(itemApplies({ bots: ["eyad"], project_ref: null }, "dubai", []), false);
  assert.equal(itemApplies({ bots: ["eyad", "dubai"], project_ref: "p1" }, "dubai", ["p1"]), true);
  assert.equal(itemApplies({ bots: ["eyad", "dubai"], project_ref: "p1" }, "dubai", ["p2"]), false);
});
