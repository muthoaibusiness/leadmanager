// Vector index for the AI Trainer (migration 0045). Deno-free.
// indexItems chunks and embeds every active fact and example once per
// (item, revision, model); vectorRetrieval decides whether a frozen snapshot
// may use vector retrieval, which needs a chunk for every item it holds.
import { chunksFor, sha256Hex, type ItemRow, type Retrieval, type SnapshotContent } from "./trainer-core.ts";

export type IndexPorts = {
  embed(model: string, text: string): Promise<{ ok: true; vector: number[]; tokens: number } | { ok: false; error: string }>;
  existingChunks(model: string): Promise<{ id: string; item_id: string; item_revision: number; chunk_no?: number; embedding_model: string; embedding_dim: number }[]>;
  insertChunk(row: Record<string, unknown>): Promise<{ id: string }>;
};
export type IndexResult = { ok: boolean; created: number; reused: number; failed: { item_id: string; error: string }[] };

const indexable = (i: ItemRow) => i.status === "active" && (i.kind === "fact" || i.kind === "example");

export async function indexItems(items: ItemRow[], model: string, dim: number, ports: IndexPorts): Promise<IndexResult> {
  const have = new Set((await ports.existingChunks(model)).filter((c) => c.embedding_dim === dim).map((c) => `${c.item_id}@${c.item_revision}#${c.chunk_no ?? 0}`));
  const res: IndexResult = { ok: true, created: 0, reused: 0, failed: [] };
  for (const item of items.filter(indexable)) {
    for (const ch of chunksFor(item)) {
      if (have.has(`${ch.item_id}@${ch.item_revision}#${ch.chunk_no}`)) { res.reused++; continue; }
      const e = await ports.embed(model, ch.chunk_text).catch((x) => ({ ok: false as const, error: x instanceof Error ? x.message : String(x) }));
      if (!e.ok) { res.failed.push({ item_id: item.id, error: e.error }); break; }
      if (e.vector.length !== dim) { res.failed.push({ item_id: item.id, error: `embedding dimension ${e.vector.length}, expected ${dim}` }); break; }
      await ports.insertChunk({ item_id: ch.item_id, item_revision: ch.item_revision, chunk_no: ch.chunk_no, chunk_text: ch.chunk_text,
        bots: item.bots, project_ref: item.project_ref, embedding_model: model, embedding_dim: dim,
        embedding: `[${e.vector.join(",")}]`, text_sha256: await sha256Hex(ch.chunk_text) });
      res.created++;
    }
  }
  res.ok = res.failed.length === 0;
  return res;
}

// Every fact and example in the snapshot needs at least one chunk for this
// exact revision and model; otherwise the snapshot stays on "full".
export function vectorRetrieval(content: SnapshotContent, chunks: { id: string; item_id: string; item_revision: number; embedding_model: string; embedding_dim: number }[], model: string, dim: number, k = 8):
  { ok: true; retrieval: Retrieval } | { ok: false; missing: string[] } {
  const usable = chunks.filter((c) => c.embedding_model === model && c.embedding_dim === dim);
  const need = content.items.filter((i) => (i.kind === "fact" || i.kind === "example") && chunksFor(i).length);
  const missing = need.filter((i) => !usable.some((c) => c.item_id === i.id && c.item_revision === i.revision)).map((i) => `${i.id}@${i.revision}`);
  if (missing.length) return { ok: false, missing };
  const ids = usable.filter((c) => need.some((i) => i.id === c.item_id && i.revision === c.item_revision)).map((c) => c.id).sort();
  return { ok: true, retrieval: { mode: "vector", embedding_model: model, embedding_dim: dim, chunk_ids: ids, k } };
}
