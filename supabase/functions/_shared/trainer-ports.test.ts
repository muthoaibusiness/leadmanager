import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "./trainer-handler.ts";

// The real Ports adapter the Playground, test runs and test-number turns share.
const ROW = { id: "prop-1", name: "Wecon Nuznan", company_id: "c1", variants: [{ name: "A", size: 1000, listRate: 5000, units: [{ id: "A1", status: "available" }] }] };
const deps = (companyId?: string) => {
  const seen: string[] = [];
  const db = {
    seen,
    async select(path: string) { seen.push(path); return path.startsWith("properties?") && path.includes("company_id=eq.c1") ? [ROW] : []; },
    async insert() { return {}; }, async patch() { return true; }, async rpc() { return { ok: true, data: null }; },
  };
  return { db, llm: { chat: async () => ({ ok: false as const, error: "unused" }) }, env: { budgetUsd: 1, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 1 }, companyId } };
};

test("a billed model failure (tokens spent, no reply) is settled against the budget, an unbilled one released", async () => {
  const d: any = deps("c1");
  const rpcs: any[] = [];
  d.db.rpc = async (fn: string, a: any) => { rpcs.push([fn, a]); return { ok: true, data: fn === "ai_budget_reserve" ? "r1" : null }; };
  d.llm = { chat: async () => ({ ok: false, code: "length", error: "e", prompt_tokens: 1e6, completion_tokens: 2e6 }) };
  const req = { model: "m", max_tokens: 2000, system: "s", messages: [{ role: "user" as const, content: "q" }] };
  assert.equal((await _internals.portsFor(d).callModel(req)).ok, false);
  assert.deepEqual(rpcs.at(-1), ["ai_budget_settle", { p_id: "r1", p_actual: 3 }]);
  d.llm = { chat: async () => ({ ok: false, error: "OpenRouter 500" }) };
  await _internals.portsFor(d).callModel(req);
  assert.equal(rpcs.at(-1)[0], "ai_budget_release");
});

test("the inventory port reads the linked property within the configured company", async () => {
  const d = deps("c1");
  const inv = await _internals.portsFor(d as any).inventory!("prop-1");
  assert.equal(inv?.counts.available, 1);
  assert.ok(d.db.seen.every((p) => p.startsWith("properties?")), "reads only properties");
});

test("vector ports exist only with an embedder, and matching goes through the scoped RPC", async () => {
  const d: any = deps("c1");
  assert.equal(_internals.portsFor(d).embed, undefined, "no embedder, no vector ports");
  const rpcs: any[] = [];
  d.db.rpc = async (fn: string, a: any) => { rpcs.push([fn, a]); return { ok: true, data: fn === "ai_budget_reserve" ? "r1" : [{ id: "c1", item_id: "f1", item_revision: 1, chunk_no: 0, chunk_text: "t", score: 0.9 }] }; };
  d.embedder = async (model: string, text: string) => ({ ok: true, vector: [0.6, 0.8], tokens: text.length, model });
  const p = _internals.portsFor(d);
  assert.deepEqual(await p.embed!("emb-1", "pool?"), [0.6, 0.8]);
  assert.ok(rpcs.some(([fn]) => fn === "ai_budget_reserve"), "embedding draws on the budget");
  const hits = await p.matchChunks!({ chunkIds: ["c1"], model: "emb-1", query: [0.6, 0.8], bot: "eyad", projects: ["p1"], k: 4 });
  assert.equal(hits[0].id, "c1");
  const m = rpcs.find(([fn]) => fn === "ai_match_chunks")[1];
  assert.deepEqual(m, { p_chunk_ids: ["c1"], p_model: "emb-1", p_query: "[0.6,0.8]", p_bot: "eyad", p_projects: ["p1"], p_k: 4 });
});

test("a failed match RPC throws, so the turn falls back to full retrieval", async () => {
  const d: any = deps("c1");
  d.embedder = async () => ({ ok: true, vector: [1], tokens: 1 });
  d.db.rpc = async (fn: string) => (fn === "ai_match_chunks" ? { ok: false, error: "no function" } : { ok: true, data: "r1" });
  await assert.rejects(_internals.portsFor(d).matchChunks!({ chunkIds: [], model: "m", query: [1], bot: "eyad", projects: [], k: 1 }), /no function/);
});

test("without a configured company the port returns nothing rather than reading unscoped", async () => {
  const d = deps(undefined);
  assert.equal(await _internals.portsFor(d as any).inventory!("prop-1"), null);
  assert.equal(d.db.seen.length, 0);
});
