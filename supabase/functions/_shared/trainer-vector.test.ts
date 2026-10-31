import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, runTurn, emptyState, chunksFor, retrieve, type ItemRow, type Ports, type SnapshotContent } from "./trainer-core.ts";

// Vector retrieval: rules and behaviour stay in full, facts and examples come
// from the pinned chunks, and any port failure falls back to "full" for the
// turn. Synthetic data and a stub embedder only.
const P = { id: "p-a", kind: "project", revision: 1, status: "active", bots: ["eyad"], project_ref: null, body: { name: "Alpha", aliases: { en: ["alpha"] }, media: {} } } as ItemRow;
const RULE = { id: "r1", kind: "rule", revision: 1, status: "active", bots: ["eyad"], project_ref: null, body: { name: "Tone", when: "always", must: "be brief" } } as ItemRow;
const POOL = { id: "f-pool", kind: "fact", revision: 2, status: "active", bots: ["eyad"], project_ref: "p-a", body: { topic: "amenities", text: "Alpha has a swimming pool." } } as ItemRow;
const PARK = { id: "f-park", kind: "fact", revision: 1, status: "active", bots: ["eyad"], project_ref: "p-a", body: { topic: "parking", text: "Alpha has 40 parking spaces." } } as ItemRow;

const base = freezeContent([P, RULE, POOL, PARK], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
const vec: SnapshotContent = { ...base, retrieval: { mode: "vector", embedding_model: "emb-1", embedding_dim: 3, chunk_ids: ["c-pool", "c-park"], k: 4 } } as SnapshotContent;
const CHUNKS = [
  { id: "c-pool", item_id: "f-pool", item_revision: 2, chunk_no: 0, chunk_text: "amenities: Alpha has a swimming pool.", score: 0.91 },
  { id: "c-park", item_id: "f-park", item_revision: 1, chunk_no: 0, chunk_text: "parking: Alpha has 40 parking spaces.", score: 0.40 },
];

test("chunksFor splits each fact and example into chunks tied to its revision", () => {
  const c = chunksFor(POOL);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].item_id, c[0].item_revision, c[0].chunk_no], ["f-pool", 2, 0]);
  assert.match(c[0].chunk_text, /swimming pool/);
  assert.deepEqual(chunksFor(RULE), [], "rules are never retrieved by similarity");
  const long = { ...POOL, body: { topic: "t", text: Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ") } } as ItemRow;
  assert.ok(chunksFor(long).length > 1 && chunksFor(long).every((x) => x.chunk_text.length <= 1600));
});

test("vector mode keeps rules in full and returns facts by similarity, scope pinned to the snapshot", async () => {
  const calls: any[] = [];
  const ports: Ports = {
    callModel: async () => ({ ok: false, error: "unused" }),
    embed: async (model, text) => { calls.push(["embed", model, text]); return [1, 0, 0]; },
    matchChunks: async (a) => { calls.push(["match", a]); return CHUNKS; },
  };
  const r = await retrieve(vec, "eyad", "is there a pool?", ["p-a"], ports);
  assert.deepEqual(r.items.map((i) => i.id).sort(), ["f-park", "f-pool", "r1"].sort());
  assert.equal(r.trace.mode, "vector");
  const m = calls.find((c) => c[0] === "match")[1];
  assert.deepEqual([m.model, m.chunkIds, m.bot, m.projects, m.k], ["emb-1", ["c-pool", "c-park"], "eyad", ["p-a"], 4]);
  assert.equal(calls[0][1], "emb-1", "query embedded with the snapshot's model");
});

test("a chunk whose item revision is not in the snapshot is ignored", async () => {
  const ports: Ports = { callModel: async () => ({ ok: false, error: "x" }), embed: async () => [1, 0, 0],
    matchChunks: async () => [{ ...CHUNKS[0], item_revision: 1 }] };
  const r = await retrieve(vec, "eyad", "pool?", ["p-a"], ports);
  assert.ok(!r.items.some((i) => i.id === "f-pool"));
});

test("an embedding failure falls back to full selection for the turn and is traced", async () => {
  const ports: Ports = { callModel: async () => ({ ok: false, error: "x" }), embed: async () => { throw new Error("provider down"); }, matchChunks: async () => CHUNKS };
  const r = await retrieve(vec, "eyad", "pool?", ["p-a"], ports);
  assert.equal(r.trace.mode, "full"); assert.equal(r.trace.fallback, "provider down");
  assert.deepEqual(r.items.map((i) => i.id).sort(), ["f-park", "f-pool", "r1"].sort());
  const none = await retrieve(vec, "eyad", "pool?", ["p-a"], { callModel: ports.callModel });
  assert.equal(none.trace.mode, "full"); assert.match(String(none.trace.fallback), /no vector ports/);
});

test("runTurn in vector mode grounds only on what was retrieved", async () => {
  const ports: Ports = {
    callModel: async () => ({ ok: true, cost_usd: 0, text: JSON.stringify({ intent: "info", project_ref: "p-a", language: "en", reply: "Alpha has a swimming pool.", media: [], handoff: false, asked: [], used_item_ids: ["f-pool"], clarify: false }) }),
    embed: async () => [1, 0, 0], matchChunks: async () => [CHUNKS[0]],
  };
  const r = await runTurn({ content: vec, bot: "eyad", text: "alpha pool?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports });
  assert.equal(r.outcome, "ok");
  assert.equal((r.trace.retrieval as any).mode, "vector");
  assert.deepEqual(r.trace.used_item_ids, ["f-pool"]);
  // f-park was not retrieved, so its "40" is not evidence.
  const bad = { ...ports, callModel: async () => ({ ok: true as const, cost_usd: 0, text: JSON.stringify({ intent: "info", project_ref: "p-a", language: "en", reply: "Alpha has 40 spaces.", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false }) }) };
  assert.equal((await runTurn({ content: vec, bot: "eyad", text: "alpha parking?", history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: bad })).outcome, "fallback_invalid_output");
});
