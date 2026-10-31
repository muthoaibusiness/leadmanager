import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeContent, type ItemRow } from "./trainer-core.ts";
import { indexItems, vectorRetrieval, type IndexPorts } from "./trainer-index.ts";

// Chunk, embed and store every active fact and example; a snapshot can only
// switch to vector retrieval when every chunk it needs exists for the model.
const F = (id: string, rev: number, text: string, bots = ["eyad"]) => ({ id, kind: "fact", revision: rev, status: "active", bots, project_ref: null, body: { topic: "t", text } }) as ItemRow;
const RULE = { id: "r1", kind: "rule", revision: 1, status: "active", bots: ["eyad"], project_ref: null, body: { name: "n", when: "w", must: "m" } } as ItemRow;

function ports(o: { failOn?: string; existing?: any[] } = {}) {
  const stored: any[] = [...(o.existing || [])]; const embedded: string[] = [];
  const p: IndexPorts = {
    embed: async (_m, text) => { if (o.failOn && text.includes(o.failOn)) return { ok: false, error: "provider 503" }; embedded.push(text); return { ok: true, vector: [1, 0, 0], tokens: 3 }; },
    existingChunks: async (model) => stored.filter((c) => c.embedding_model === model),
    insertChunk: async (row) => { const r = { id: `c${stored.length + 1}`, ...row }; stored.push(r); return r; },
  };
  return { p, stored, embedded };
}

test("indexes each active fact and example once per revision and model; rules are not embedded", async () => {
  const { p, stored, embedded } = ports();
  const r = await indexItems([F("f1", 1, "pool"), F("f2", 3, "parking"), RULE], "emb-1", 3, p);
  assert.equal(r.ok, true); assert.equal(r.created, 2); assert.equal(r.reused, 0); assert.deepEqual(r.failed, []);
  assert.deepEqual(stored.map((c) => [c.item_id, c.item_revision, c.chunk_no, c.embedding_model, c.embedding_dim]), [["f1", 1, 0, "emb-1", 3], ["f2", 3, 0, "emb-1", 3]]);
  assert.equal(embedded.length, 2);
  const again = await indexItems([F("f1", 1, "pool"), F("f2", 3, "parking")], "emb-1", 3, p);
  assert.equal(again.created, 0); assert.equal(again.reused, 2); assert.equal(embedded.length, 2, "an unchanged revision is not embedded again");
});

test("a failed embedding is reported per item, never stored, and makes the index incomplete", async () => {
  const { p, stored } = ports({ failOn: "parking" });
  const r = await indexItems([F("f1", 1, "pool"), F("f2", 1, "parking")], "emb-1", 3, p);
  assert.equal(r.ok, false); assert.deepEqual(r.failed, [{ item_id: "f2", error: "provider 503" }]);
  assert.equal(stored.length, 1);
});

test("a vector with the wrong dimension is refused, not stored", async () => {
  const { p, stored } = ports();
  p.embed = async () => ({ ok: true, vector: [1, 0], tokens: 2 });
  const r = await indexItems([F("f1", 1, "pool")], "emb-1", 3, p);
  assert.equal(r.ok, false); assert.match(r.failed[0].error, /dimension/); assert.equal(stored.length, 0);
});

test("vector retrieval is offered only when every chunk exists; otherwise freeze stays full and says why", async () => {
  const content = freezeContent([F("f1", 1, "pool"), F("f2", 1, "parking"), RULE], { reply_model: "m", max_tokens: 600, rubric_version: 1 }).content;
  const chunks = [{ id: "c1", item_id: "f1", item_revision: 1, embedding_model: "emb-1", embedding_dim: 3 }];
  const partial = vectorRetrieval(content, chunks, "emb-1", 3);
  assert.equal(partial.ok, false); assert.deepEqual(partial.missing, ["f2@1"]);
  const all = vectorRetrieval(content, [...chunks, { id: "c2", item_id: "f2", item_revision: 1, embedding_model: "emb-1", embedding_dim: 3 }], "emb-1", 3);
  assert.equal(all.ok, true);
  assert.deepEqual(all.retrieval, { mode: "vector", embedding_model: "emb-1", embedding_dim: 3, chunk_ids: ["c1", "c2"], k: 8 });
  const stale = vectorRetrieval(content, [{ ...chunks[0], item_revision: 0 }, { id: "c2", item_id: "f2", item_revision: 1, embedding_model: "emb-1", embedding_dim: 3 }], "emb-1", 3);
  assert.deepEqual(stale.missing, ["f1@1"], "a chunk for an old revision does not count");
});
