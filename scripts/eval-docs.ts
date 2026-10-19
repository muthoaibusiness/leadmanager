// node scripts/eval-docs.ts — retrieval over the real WECON Markdown documents
// (fixtures/wecon-docs.ts), chunked exactly as indexing chunks them.
//
// Always reports the lexical baseline. Reports embedding retrieval only when
// a real provider is configured:
//   EVAL_EMBED_KEY=...  EVAL_EMBED_MODEL=openai/text-embedding-3-small \
//   EVAL_EMBED_BASE=https://openrouter.ai/api/v1  node scripts/eval-docs.ts
// Without a key it says so and prints no embedding figure.
import { markdownChunks } from "../supabase/functions/_shared/trainer-docs.ts";
import { lexicalScore } from "../supabase/functions/_shared/trainer-core.ts";
import { evaluate } from "../supabase/functions/_shared/trainer-eval.ts";
import { embedRequest } from "../supabase/functions/_shared/trainer-model.ts";
import { WECON_DOCS, WECON_DOC_CASES, WECON_UNKNOWN } from "../supabase/functions/_shared/fixtures/wecon-docs.ts";
import { WECON_PROJECTS } from "../supabase/functions/_shared/fixtures/wecon-projects.ts";

type Chunk = { id: string; key: string; text: string };
const chunks: Chunk[] = WECON_DOCS.flatMap((d) => markdownChunks(d.markdown).map((c) => ({ id: `${d.key}:${c.section.split(" > ").at(-1)}`, key: d.key, text: c.text })));
const scoped = (key: string) => chunks.filter((c) => c.key === key);
const f = (m: { n: number; recallAtK: number; mrr: number }) => `n=${m.n} recall@1=${m.recallAtK.toFixed(3)} mrr=${m.mrr.toFixed(3)}`;

function report(title: string, rank: (c: (typeof WECON_DOC_CASES)[number]) => string[]) {
  // k=1: each project has 2-4 sections, so recall@5 would be trivially 1.
  const r = evaluate(WECON_DOC_CASES, rank, 1);
  console.log(`\n${title}\noverall   ${f(r.overall)}`);
  for (const [l, m] of Object.entries(r.byLanguage)) console.log(`${l.padEnd(9)} ${f(m)}`);
  return r;
}

console.log(`corpus: ${WECON_DOCS.length} documents, ${chunks.length} chunks; ${WECON_DOC_CASES.length} questions (scoped to the named project)`);
report("lexical baseline (shared words + intent vocabulary)", (c) =>
  scoped(c.resolved[0]).map((ch) => ({ id: ch.id, s: lexicalScore(c.query, ch.text, WECON_PROJECTS) })).sort((a, b) => b.s - a.s).map((x) => x.id));

const key = process.env.EVAL_EMBED_KEY, model = process.env.EVAL_EMBED_MODEL, base = process.env.EVAL_EMBED_BASE || "https://openrouter.ai/api/v1";
if (!key || !model) {
  console.log("\nembedding retrieval: NOT RUN (set EVAL_EMBED_KEY and EVAL_EMBED_MODEL to measure a real model)");
} else {
  let tokens = 0;
  const emb = async (t: string) => { const r = await embedRequest(base, key, model, t, { fetch: (u, i) => fetch(u, i as RequestInit) as any }); if (!r.ok) throw new Error(r.error); tokens += r.tokens; return r.vector; };
  const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b) || 1);
  const vec = new Map<string, number[]>();
  for (const ch of chunks) vec.set(ch.id, await emb(ch.text));
  const qv = new Map<string, number[]>();
  for (const c of WECON_DOC_CASES) qv.set(c.query, await emb(c.query));
  report(`embedding retrieval (${model}, ${vec.values().next().value?.length} dims)`, (c) =>
    scoped(c.resolved[0]).map((ch) => ({ id: ch.id, s: cos(qv.get(c.query)!, vec.get(ch.id)!) })).sort((a, b) => b.s - a.s).map((x) => x.id));
  // Hybrid: reciprocal rank fusion of the embedding rank and the lexical rank
  // (k=60, the usual constant), so each method covers the other's misses.
  const lexRank = (c: (typeof WECON_DOC_CASES)[number]) => scoped(c.resolved[0]).map((ch) => ({ id: ch.id, s: lexicalScore(c.query, ch.text, WECON_PROJECTS) })).sort((a, b) => b.s - a.s).map((x) => x.id);
  const embRank = (c: (typeof WECON_DOC_CASES)[number]) => scoped(c.resolved[0]).map((ch) => ({ id: ch.id, s: cos(qv.get(c.query)!, vec.get(ch.id)!) })).sort((a, b) => b.s - a.s).map((x) => x.id);
  report("hybrid (reciprocal rank fusion of embedding + lexical)", (c) => {
    const score = new Map<string, number>();
    for (const list of [embRank(c), lexRank(c)]) list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (60 + i + 1)));
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  });
  // Unscoped: the document editor sets no project, so at runtime a question is
  // matched against every chunk of the company. recall@5 over all 33 chunks.
  const all5 = (rank: (c: (typeof WECON_DOC_CASES)[number]) => string[]) => evaluate(WECON_DOC_CASES, rank, 5).overall;
  const lexAll = (c: (typeof WECON_DOC_CASES)[number]) => chunks.map((ch) => ({ id: ch.id, s: lexicalScore(c.query, ch.text, WECON_PROJECTS) })).sort((a, b) => b.s - a.s).map((x) => x.id);
  const embAll = (c: (typeof WECON_DOC_CASES)[number]) => chunks.map((ch) => ({ id: ch.id, s: cos(qv.get(c.query)!, vec.get(ch.id)!) })).sort((a, b) => b.s - a.s).map((x) => x.id);
  const m1 = all5(lexAll), m2 = all5(embAll);
  console.log(`\nunscoped (all ${chunks.length} chunks, as the runtime searches today)`);
  console.log(`lexical   recall@5=${m1.recallAtK.toFixed(3)} mrr=${m1.mrr.toFixed(3)}`);
  console.log(`embedding recall@5=${m2.recallAtK.toFixed(3)} mrr=${m2.mrr.toFixed(3)}`);
  console.log("\nunknown questions (no section answers them): top cosine score");
  for (const u of WECON_UNKNOWN) {
    const q = await emb(u.query);
    const top = scoped(u.key).map((ch) => cos(q, vec.get(ch.id)!)).sort((a, b) => b - a)[0];
    console.log(`  ${u.language.padEnd(9)} ${top.toFixed(3)}  ${u.query}`);
  }
  console.log(`\nembedding tokens used: ${tokens}`);
}
