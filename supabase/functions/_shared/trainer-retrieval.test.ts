import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, retrieveContext, buildPrompt, runTurn, emptyState, type ItemRow, type Ports } from "./trainer-core.ts";

// Synthetic content only.
const proj = (id: string, name: string, alias: string[], bots: string[] = ["eyad"]) =>
  ({ id, kind: "project", revision: 1, status: "active", bots, project_ref: null,
    body: { name, aliases: { banglish: alias, en: alias, bn: [] }, media: {} } }) as ItemRow;
const ex = (id: string, q: string, ideal: string, project_ref: string | null = null, bots: string[] = ["eyad"]) =>
  ({ id, kind: "example", revision: 1, status: "active", bots, project_ref,
    body: { conversation: [{ role: "customer", text: q }], ideal_reply: ideal, reason: "r", source: "handwritten" } }) as ItemRow;
const freeze = (rows: ItemRow[]) => freezeContent(rows, { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const ids = (rows: ItemRow[]) => rows.map((r) => r.id);
const filler = (n: number) => Array.from({ length: n }, (_, i) => ex(`e-0${i + 1}`, `zzq${i} yyw${i}`, `xxv${i} wwu${i}`));

test("an example relevant to the customer text is shown even when it is 7th by id", () => {
  const c = freeze([...filler(7), ex("e-08", "swimming pool ache?", "Yes, there is a swimming pool.")]);
  const r = retrieveContext(c, "eyad", "swimming pool ache?", []);
  assert.equal(r.examples[0].id, "e-08");
  assert.ok(buildPrompt(c, "eyad", [], "swimming pool ache?", emptyState(), [], "en").system.includes("[e-08]"));
});

test("irrelevant examples beyond six are excluded, and at most six are shown", () => {
  const c = freeze([...filler(8), ex("e-09", "parking space", "Parking is available.")]);
  const r = retrieveContext(c, "eyad", "parking space", []);
  assert.equal(r.examples.length, 6);
  assert.deepEqual(ids(r.examples), ["e-09", "e-01", "e-02", "e-03", "e-04", "e-05"]);
  // e-09 shares "parking" and "space" (2) and the amenities intent (3).
  assert.deepEqual(r.trace, { mode: "full", examples: r.examples.map((e, i) => ({ id: e.id, score: i === 0 ? 5 : 0 })) });
});

test("ranking is deterministic and ties resolve by id ascending", () => {
  const c = freeze([ex("e-c", "pool", "pool"), ex("e-a", "pool", "pool"), ex("e-b", "pool", "pool")]);
  const first = retrieveContext(c, "eyad", "pool", []);
  assert.deepEqual(ids(first.examples), ["e-a", "e-b", "e-c"]);
  assert.deepEqual(retrieveContext(c, "eyad", "pool", []), first);
});

test("examples of another bot or another project never appear", () => {
  const c = freeze([proj("p-a", "Alpha", ["alpha"]), proj("p-b", "Beta", ["beta"]),
    ex("e-ok", "pool", "pool", "p-a"), ex("e-bot", "pool", "pool", null, ["dubai"]), ex("e-proj", "pool", "pool", "p-b")]);
  assert.deepEqual(ids(retrieveContext(c, "eyad", "alpha pool", ["p-a"]).examples), ["e-ok"]);
});

test("Bangla-script and Banglish queries rank their matching example first", () => {
  const c = freeze([...filler(7), ex("e-08", "দাম কত হবে", "দাম ৩ কোটি থেকে"), ex("e-09", "dam koto hobe", "dam 3 crore theke")]);
  assert.equal(retrieveContext(c, "eyad", "ফ্ল্যাটের দাম কত", []).examples[0].id, "e-08");
  assert.equal(retrieveContext(c, "eyad", "flat er dam koto", []).examples[0].id, "e-09");
});

test("a shared project alias adds a bonus", () => {
  // Same words and intent in both examples; only e-b names the project (by its
  // Bangla alias, so the word itself is not shared), so only the bonus separates them.
  const p = { ...proj("p-a", "Alpha", ["nuznan"]), body: { name: "Alpha", aliases: { banglish: ["nuznan"], en: ["nuznan"], bn: ["নুজনান"] }, media: {} } } as ItemRow;
  const c = freeze([p, ex("e-a", "price list", "price list"), ex("e-b", "নুজনান price list", "price list")]);
  assert.equal(retrieveContext(c, "eyad", "nuznan price list", []).examples[0].id, "e-b");
});

test("a figure only in a non-retrieved example does not ground a reply", async () => {
  const hot = Array.from({ length: 6 }, (_, i) => ex(`e-0${i + 1}`, "pool timing", "pool is open"));
  const c = freeze([...hot, ex("e-07", "zzq", "it costs 9 crore")]);
  const out = JSON.stringify({ intent: "price", project_ref: null, language: "en", reply: "It is 9 crore.", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
  const ports: Ports = { callModel: async () => ({ ok: true, text: out, cost_usd: 0 }) };
  const r = await runTurn({ content: c, bot: "eyad", text: "pool timing", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports });
  assert.equal(r.outcome, "fallback_invalid_output");
});

test("a non-full retrieval mode is rejected", () => {
  const c = { ...freeze([]), retrieval: { mode: "vector" } } as any;
  assert.throws(() => retrieveContext(c, "eyad", "x", []), /vector/);
});

// ── intent vocabulary (paraphrase retrieval) ───────────────────────────────
import { intentsOf } from "./trainer-core.ts";
import { evaluate, rankItems } from "./trainer-eval.ts";
import { R0_CONTENT, R0_CASES } from "./fixtures/r0-synthetic.ts";
import { R0_PARAPHRASE } from "./fixtures/r0-paraphrase.ts";
import { R0_HELDOUT } from "./fixtures/r0-heldout.ts";

test("intent vocabulary maps paraphrases in all three languages to the same intent", () => {
  for (const [q, i] of [["how much would I need to pay", "price"], ["koto taka lagbe", "price"], ["কিনতে কত টাকা লাগবে", "price"],
    ["which neighbourhood is it in", "location"], ["jayga ta kon dike", "location"], ["কোন এলাকায়", "location"],
    ["how big are the flats", "size"], ["koto boro", "size"], ["কত বড়", "size"],
    ["can my kids swim", "amenities"], ["gari rakhar jayga", "amenities"], ["গাড়ি রাখা যাবে", "amenities"],
    ["anything left to buy", "availability"], ["kichu baki ache kinte", "availability"], ["কেনার মতো কিছু বাকি আছে", "availability"]] as const) {
    assert.ok(intentsOf(q).has(i), `${q} -> ${i}`);
  }
  assert.equal(intentsOf("hello there").size, 0);
});

test("paraphrase and held-out retrieval clear the R0 gate; shared wording does not regress", () => {
  const run = (cases: any[]) => evaluate(cases, (c) => rankItems(R0_CONTENT, c.bot, c.query, c.resolved));
  const para = run(R0_PARAPHRASE).overall, held = run(R0_HELDOUT).overall, shared = run(R0_CASES).overall;
  assert.ok(para.recallAtK >= 0.9, `paraphrase recall@5 ${para.recallAtK}`);
  assert.ok(held.recallAtK >= 0.9, `held-out recall@5 ${held.recallAtK}`);
  assert.equal(shared.recallAtK, 1);
  assert.ok(para.mrr >= 0.6 && held.mrr >= 0.6, `mrr ${para.mrr} / ${held.mrr}`);
});
