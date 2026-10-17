import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_VERSION, canonicalJson, checksumOf, validateItem, validateScope, contentHash, itemApplies,
} from "./trainer-core.ts";
import { freezeContent, detectLanguage, resolveProject, buildHistory, emptyState, type ItemRow } from "./trainer-core.ts";

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


const P = (id: string, name: string, aliases: any, extra: any = {}): ItemRow => ({
  id, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name, aliases, media: { photos: [], floor_plans: [] }, ...extra },
});
const NUZ = P("p-nuz", "Wecon Nuznan", { bn: ["নুজনান"], banglish: ["nuznan", "nunan"], en: ["nuznan"] }, { tags: ["jolshiri"] });
const OSM = P("p-osm", "Wecon Osman Bellevue", { bn: ["ওসমান"], banglish: ["osman", "bellevue"], en: ["osman bellevue"] }, { tags: ["jolshiri"] });
const SUM = P("p-sum", "Wecon Summer Breeze", { banglish: ["summer breeze"], en: ["summer breeze"] });

test("freezeContent keeps active items, sorts by id, rejects dangling project refs", () => {
  const fact = { id: "f1", kind: "fact", revision: 2, status: "active", bots: ["eyad"], project_ref: "p-nuz", body: { topic: "a", text: "b" } } as ItemRow;
  const dead = { ...fact, id: "f0", status: "retired" } as ItemRow;
  const { content, errors } = freezeContent([fact, NUZ, dead], { reply_model: "m", max_tokens: 600, rubric_version: 1 });
  assert.deepEqual(errors, []);
  assert.deepEqual(content.items.map((i) => i.id), ["f1"]);
  assert.deepEqual(content.projects.map((p) => p.id), ["p-nuz"]);
  const orphan = { ...fact, project_ref: "p-x" } as ItemRow;
  assert.ok(freezeContent([orphan], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).errors.length > 0);
});

test("freezeContent rejects an alias shared by two projects", () => {
  const dup = P("p-2", "Other", { banglish: ["nuznan"] });
  assert.ok(freezeContent([NUZ, dup], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).errors.some((e) => e.includes("alias")));
});

test("detectLanguage", () => {
  assert.equal(detectLanguage("দাম কত?"), "bn");
  assert.equal(detectLanguage("Nuznan er size কত?"), "bn");
  assert.equal(detectLanguage("nuznan er dam koto?"), "banglish");
  assert.equal(detectLanguage("What is the price of Nuznan?"), "en");
  assert.equal(detectLanguage("‌‍"), "en");
});

test("resolveProject: explicit alias wins, Bangla script works", () => {
  const r = resolveProject("ওসমান প্রজেক্টের লোকেশন?", emptyState(), { isAd: false }, [NUZ, OSM, SUM]);
  assert.deepEqual(r, { projects: ["p-osm"], source: "explicit", ambiguous: false });
  assert.deepEqual(resolveProject("nunan er brochure", emptyState(), { isAd: false }, [NUZ, OSM]).projects, ["p-nuz"]);
});

test("resolveProject: two named projects", () => {
  const r = resolveProject("Nuznan ar Osman duitar size?", emptyState(), { isAd: false }, [NUZ, OSM]);
  assert.deepEqual(r.projects.sort(), ["p-nuz", "p-osm"]);
});

test("resolveProject: generic word alone resolves nothing", () => {
  assert.deepEqual(resolveProject("summer", emptyState(), { isAd: false }, [SUM]).projects, []);
});

test("resolveProject: state then ad, ad only when unambiguous", () => {
  const st = { ...emptyState(), active_project: "p-nuz", active_source: "explicit" as const };
  assert.deepEqual(resolveProject("location?", st, { isAd: false }, [NUZ, OSM]), { projects: ["p-nuz"], source: "state", ambiguous: false });
  assert.deepEqual(resolveProject("info", emptyState(), { isAd: true, adText: "Wecon Osman Bellevue Jolshiri" }, [NUZ, OSM]).projects, ["p-osm"]);
  const amb = resolveProject("info", emptyState(), { isAd: true, adText: "Nuznan and Osman" }, [NUZ, OSM]);
  assert.deepEqual(amb, { projects: [], source: null, ambiguous: true });
  assert.deepEqual(resolveProject("price koto?", emptyState(), { isAd: false }, [NUZ, OSM]).projects, []);
});

test("buildHistory excludes every agent slash command and its trailing note (spec 10.5.1, CC-46)", () => {
  const rows = [
    { role: "customer", text: "nuznan er dam koto?" },
    { role: "agent", text: "/fdh this client is looking in the 1st floor with long payment" },
    { role: "agent", text: "  /n you are good that's lets meet in the office" },
    { role: "agent", text: "/t" }, { role: "agent", text: "/FMKT its a testing data" }, { role: "agent", text: "/sendnz" },
    { role: "customer", text: "/fdh" }, { role: "agent", text: "Assalamu alaikum, ami Rahim" },
  ] as any;
  assert.deepEqual(buildHistory(rows), [
    { role: "customer", text: "nuznan er dam koto?" },
    { role: "customer", text: "/fdh" },
    { role: "agent", text: "Assalamu alaikum, ami Rahim" },
  ]);
});

test("buildHistory drops commands, keeps agent label, caps length", () => {
  const rows = [
    { role: "customer", text: "hi" }, { role: "agent", text: "/fdh note about client" },
    { role: "agent", text: "Hello, I am Rahim" }, { role: "bot", text: "" },
  ] as any;
  assert.deepEqual(buildHistory(rows), [{ role: "customer", text: "hi" }, { role: "agent", text: "Hello, I am Rahim" }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ role: "customer", text: String(i) })) as any;
  assert.equal(buildHistory(many).length, 20);
  assert.equal(buildHistory(many)[0].text, "10");
});
