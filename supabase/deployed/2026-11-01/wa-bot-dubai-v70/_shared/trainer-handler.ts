// ai-trainer request handler. Deno-free: the Edge Function passes in real
// database and OpenRouter ports, the Node tests pass in-memory ones. Every
// action requires the acting CRM user to be an active Management or Master
// account (see isManager). Actor names in audit rows are claimed, not verified.
import {
  CORE_VERSION, KINDS, validateItem, validateScope, contentHash, freezeContent, checksumOf, canonicalJson, sha256Hex,
  runTurn, emptyState, validateTestSpec, runChecks, buildJudgePrompt, parseJudge, judgeVerdict, finalVerdict,
  publishGate, redactTurns, RUBRIC_V1, type ItemRow, type Kind, type Bot, type SnapshotContent, type TestSpec,
  type Ports, type ConvState,
} from "./trainer-core.ts";
import { PROVIDERS, REPLY_LIMITS, validateConfig, validKey, maskKey, hostOf, type ModelConfig } from "./trainer-model.ts";
import { withSystemPrompt, promptLimits, type SystemPrompt } from "./trainer-prompt.ts";
import { indexItems, vectorRetrieval } from "./trainer-index.ts";
import { markdownChunks } from "./trainer-docs.ts";
import { lookupInventory } from "./trainer-inventory.ts";
import { brochureCatalog, verifyBrochure, type Probe } from "./trainer-brochure.ts";
import { docAssociation, type ProjectName } from "./trainer-docs.ts";

export type Db = {
  select(path: string): Promise<any[]>;
  insert(table: string, row: object): Promise<any>;
  patch(table: string, filter: string, patch: object): Promise<boolean>;
  rpc(fn: string, args: object): Promise<{ ok: boolean; data?: any; error?: string }>;
};
export type Llm = {
  chat(req: { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] }):
    Promise<{ ok: true; text: string; prompt_tokens: number; completion_tokens: number } | { ok: false; error: string; code?: string }>;
};
// companyId scopes the live inventory read; without it the trainer states no live stock.
// embeddingModel/embeddingDim switch on vector indexing (task 5); unset keeps every snapshot on "full".
export type Env = { budgetUsd: number; replyModel: string; judgeModel: string; pricePerMTok: { in: number; out: number }; companyId?: string;
  embeddingModel?: string; embeddingDim?: number };
// modelLlm builds an Llm for a stored Playground model config and its key. It
// is optional: without it, or without a saved config, the Playground uses llm.
// embedder enables vector retrieval; without it every turn uses "full".
export type Embedder = (model: string, text: string) => Promise<{ ok: true; vector: number[]; tokens: number } | { ok: false; error: string }>;
// probe checks a brochure URL (first bytes only); without it no brochure is offered.
type Deps = { db: Db; llm: Llm; env: Env; now?: () => Date; probe?: Probe; modelLlm?: (cfg: ModelConfig, key: string) => Llm; embedder?: Embedder ; embedWith?: (cfg: ModelConfig & { dim: number }, key: string) => (text: string) => Promise<{ ok: true; vector: number[]; tokens: number } | { ok: false; error: string }> };
type Res = { status: number; body: any };

const ok = (data: unknown): Res => ({ status: 200, body: { ok: true, data } });
const fail = (status: number, code: string, message: string, details?: unknown): Res =>
  ({ status, body: { ok: false, error: { code, message, details } } });

// The CRM has no Supabase Auth session, so access is the acting user's role in
// the users table, the same check as wa-send (isAdminUser in wa.ts, which this
// Deno-free file cannot import). The id is claimed by the browser: this stops
// a non-Management account, not someone holding the anon key.
async function isManager(db: Db, userId: unknown): Promise<boolean> {
  if (typeof userId !== "string" || !userId) return false;
  const u = (await db.select(`users?id=eq.${encodeURIComponent(userId)}&select=role,is_active`))[0];
  return !!u && u.is_active !== false && (u.role === "MANAGEMENT" || u.role === "MASTER");
}

// Failed sign-ins per IP: 10 in 10 minutes locks that IP out for 10 minutes.
// Kept in module memory, so it resets on a cold start; that only loosens the
// limit briefly and never lets a refused account through.
const fails = new Map<string, number[]>();
function limited(ip: string, now: number): boolean {
  const xs = (fails.get(ip) || []).filter((t) => now - t < 600_000);
  fails.set(ip, xs);
  return xs.length >= 10;
}

// Reserve the maximum cost of a call before making it; settle with the real
// usage afterwards, or release if the call never reached the provider.
async function withBudget<T>(deps: Deps, estimateUsd: number, fn: () => Promise<{ value: T; actualUsd: number | null }>): Promise<T | "over_budget"> {
  const r = await deps.db.rpc("ai_budget_reserve", { p_pool: "trainer", p_estimate: estimateUsd, p_limit: deps.env.budgetUsd });
  if (!r.ok || !r.data) return "over_budget";
  try {
    const { value, actualUsd } = await fn();
    if (actualUsd === null) await deps.db.rpc("ai_budget_release", { p_id: r.data });
    else await deps.db.rpc("ai_budget_settle", { p_id: r.data, p_actual: actualUsd });
    return value;
  } catch (e) {
    await deps.db.rpc("ai_budget_settle", { p_id: r.data, p_actual: estimateUsd });
    throw e;
  }
}

const cost = (env: Env, pin: number, pout: number) => (pin * env.pricePerMTok.in + pout * env.pricePerMTok.out) / 1e6;
const estimate = (env: Env, chars: number, maxTokens: number) => cost(env, Math.ceil(chars / 3) + 200, maxTokens);

// One budgeted model call shaped as trainer-core's Ports.callModel.
function portsFor(deps: Deps, llm: Llm = deps.llm): Ports {
  return {
    callModel: async (req) => {
      const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
      const r = await withBudget(deps, estimate(deps.env, chars, req.max_tokens), async () => {
        const x = await llm.chat(req);
        if (!x.ok) return { value: x, actualUsd: null };
        return { value: x, actualUsd: cost(deps.env, x.prompt_tokens, x.completion_tokens) };
      });
      if (r === "over_budget") throw new BudgetError();
      if (!r.ok) return { ok: false, error: r.error, code: r.code };
      return { ok: true, text: r.text, cost_usd: cost(deps.env, r.prompt_tokens, r.completion_tokens) };
    },
    inventory: async (propertyId) =>
      deps.env.companyId ? lookupInventory(deps.db, { propertyId, companyId: deps.env.companyId }, deps.now) : null,
    // No sendDocument here: the Playground, prompt tests and test runs check
    // brochure files but never send one.
    // The same first-bytes check confirms a photo, plan or map is an image.
    ...(deps.probe ? { probeDocument: deps.probe, probeImage: deps.probe } : {}),
    ...(deps.embedder ? vectorPorts(deps, deps.embedder) : {}),
  };
}

// Embedding draws on the trainer budget like a reply call. A failure throws,
// and trainer-core's retrieve() turns that into a "full" fallback for the turn.
function vectorPorts(deps: Deps, embedder: Embedder): Pick<Ports, "embed" | "matchChunks"> {
  return {
    embed: async (model, text) => {
      const r = await withBudget(deps, estimate(deps.env, text.length, 1), async () => {
        const x = await embedder(model, text);
        return { value: x, actualUsd: x.ok ? cost(deps.env, x.tokens, 0) : null };
      });
      if (r === "over_budget") throw new BudgetError();
      if (!r.ok) throw new Error(r.error);
      return r.vector;
    },
    matchChunks: async (a) => {
      const r = await deps.db.rpc("ai_match_chunks", { p_chunk_ids: a.chunkIds, p_model: a.model, p_query: `[${a.query.join(",")}]`,
        p_bot: a.bot, p_projects: a.projects, p_k: a.k });
      if (!r.ok) throw new Error(r.error || "ai_match_chunks failed");
      return Array.isArray(r.data) ? r.data : [];
    },
  };
}
class BudgetError extends Error { constructor() { super("over_budget"); } }

const activeProjectIds = async (db: Db) =>
  new Set((await db.select("ai_trainer_items?kind=eq.project&status=eq.active&select=id")).map((r) => r.id));

// An example taken from a real chat (a corrected live reply) is redacted here,
// on the server, the same way importPreview redacts legacy corrections, so no
// caller can store a customer's phone, email or link. A handwritten or
// Playground example is the author's own text and is kept as written.
function redactRealExample(body: any): { body: any; rejected: boolean } {
  if (!body || body.source !== "real" || !Array.isArray(body.conversation)) return { body, rejected: false };
  const one = (s: unknown) => (typeof s === "string" && s ? redactTurns([{ role: "customer", text: s }], []).turns[0]?.text ?? "" : s);
  const conv = redactTurns(body.conversation, []);
  const out = { ...body, conversation: conv.turns.length ? conv.turns : [{ role: "customer", text: "(no text)" }],
    ideal_reply: one(body.ideal_reply), ...(body.original_reply !== undefined ? { original_reply: one(body.original_reply) } : {}) };
  const left = redactTurns([{ role: "customer", text: [out.ideal_reply, out.original_reply].filter(Boolean).join(" ") || "-" }], []);
  return { body: out, rejected: conv.rejected || left.rejected };
}

async function saveItem(deps: Deps, p: any, actor: string, expected: number, reason: string | null): Promise<Res> {
  if (!KINDS.includes(p.kind)) return fail(422, "schema", "unknown kind");
  if (p.kind === "example") {
    const red = redactRealExample(p.body);
    if (red.rejected) return fail(422, "redaction", "This example still contains personal data after redaction. Edit it out first.");
    p = { ...p, body: red.body };
  }
  const errs = [...validateItem(p.kind as Kind, p.body), ...validateScope(p.kind, p.bots, p.project_ref ?? null, await activeProjectIds(deps.db))];
  if (errs.length) return fail(422, "schema", "invalid item", errs);
  const item = { id: p.id, kind: p.kind, bots: p.bots, project_ref: p.project_ref ?? null, body: p.body,
    content_hash: await contentHash(p.kind, p.body), status: p.status || "active" };
  const r = await deps.db.rpc("ai_item_save", { p_item: item, p_expected_revision: expected, p_actor: actor, p_reason: reason });
  if (!r.ok) {
    if (r.error?.includes("revision_conflict")) return fail(409, "revision_conflict", "Someone else changed this item. Reload and try again.");
    if (r.error?.includes("duplicate_content")) return fail(409, "duplicate", "An active item with the same content already exists.");
    if (r.error?.includes("reason_required")) return fail(422, "reason_required", "A reason is required.");
    if (r.error?.includes("not_found")) return fail(404, "not_found", "Item not found.");
    return fail(500, "db", r.error || "save failed");
  }
  return ok(r.data);
}

async function loadDrafts(db: Db): Promise<ItemRow[]> {
  return (await db.select("ai_trainer_items?status=eq.active&select=*")) as ItemRow[];
}

async function contentFor(deps: Deps, source: string, snapshotId?: string): Promise<{ content: SnapshotContent; checksum: string; errors: string[] }> {
  if (source === "drafts") {
    const { content, errors } = freezeContent(await loadDrafts(deps.db), { reply_model: deps.env.replyModel, max_tokens: REPLY_LIMITS.max_tokens, rubric_version: 1 });
    return { content, checksum: await checksumOf(content), errors };
  }
  const s = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(snapshotId || "")}&select=*`))[0];
  if (!s) throw new Error("snapshot not found");
  const sum = await checksumOf(s.content);
  if (sum !== s.checksum) throw new Error("snapshot checksum mismatch");
  return { content: s.content, checksum: sum, errors: [] };
}

function wordsFromKnowledge(body: string): "rule" | "behaviour" | "fact" {
  const b = body.toLowerCase();
  if (/(never|always|must|only|offer|do not|don't)/.test(b)) return "rule";
  if (/(tone|friendly|polite|style|emoji)/.test(b)) return "behaviour";
  return "fact";
}

async function importPreview(deps: Deps): Promise<Res> {
  const rows: any[] = [];
  const existing = new Set((await deps.db.select("ai_trainer_items?status=eq.active&select=content_hash")).map((r) => r.content_hash));
  for (const p of await deps.db.select("wa_projects?select=*")) {
    const labels: string[] = p.floor_plan_labels || [];
    const body: any = {
      name: p.name, aliases: { banglish: p.keywords || [], en: [String(p.name || "").toLowerCase()] },
      region: p.region || undefined, type: p.nature || undefined, address: p.address || undefined,
      size_text: p.sft ? `${p.sft} sft` : undefined, tags: /jolshiri/i.test(p.address || "") ? ["jolshiri"] : undefined,
      media: { photos: p.photos || [], floor_plans: (p.floor_plans || []).map((u: string, i: number) => (labels[i] ? { url: u, label: labels[i] } : { url: u })),
        brochure: p.brochure_url || undefined, map_image: p.map_image_url || undefined, video: p.video_url || undefined },
      send_code: p.send_code || undefined, legacy_wa_project_id: p.id,
    };
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
    const errs = validateItem("project", body);
    const hash = await contentHash("project", body);
    rows.push({ source: "wa_projects", source_id: p.id, proposed: { kind: "project", bots: ["eyad", "dubai"], body },
      status: errs.length ? "rejected" : existing.has(hash) ? "duplicate" : "ready", errors: errs,
      warnings: (p.floor_plans || []).length > labels.length ? ["some floor plans have no label"] : [] });
  }
  for (const k of await deps.db.select("wa_knowledge?select=*")) {
    const kind = wordsFromKnowledge(k.body || "");
    const body = kind === "rule" ? { name: k.title, when: k.title, must: k.body }
      : kind === "behaviour" ? { aspect: "tone", instruction: k.body } : { topic: k.title, text: k.body };
    const hash = await contentHash(kind, body);
    rows.push({ source: "wa_knowledge", source_id: k.id, proposed: { kind, bots: ["eyad", "dubai"], body },
      status: existing.has(hash) ? "duplicate" : "ready", errors: validateItem(kind, body) });
  }
  for (const c of await deps.db.select("wa_message_corrections?select=*")) {
    const red = redactTurns([{ role: "customer", text: c.customer_message || "" }], []);
    const body = { conversation: red.turns.length ? red.turns : [{ role: "customer", text: "" }], original_reply: c.original_reply || undefined,
      ideal_reply: c.corrected_reply || "", reason: c.note || "imported correction", source: "real" };
    rows.push({ source: "wa_message_corrections", source_id: c.id, proposed: { kind: "example", bots: ["eyad", "dubai"], body },
      status: red.rejected ? "rejected" : "ready", errors: red.rejected ? ["redaction check failed"] : validateItem("example", body) });
  }
  return ok({ rows });
}

async function importCommit(deps: Deps, p: any, actor: string): Promise<Res> {
  const decisions: any[] = Array.isArray(p.decisions) ? p.decisions : [];
  const report: any[] = [];
  for (const d of decisions) {
    if (d.decision !== "import") { report.push({ ...d.ref, result: "rejected", reason: d.reason || "rejected by reviewer" }); continue; }
    const r = await saveItem(deps, d.item, actor, 0, null);
    report.push({ ...d.ref, result: r.status === 200 ? "imported" : r.body.error.code === "duplicate" ? "duplicate" : "rejected",
      item_id: r.body?.data?.id, reason: r.body?.error?.message, kind: d.item.kind });
  }
  await deps.db.insert("ai_trainer_imports", { source: "legacy", report, actor_claimed: actor });
  return ok({ report });
}

async function saveTest(deps: Deps, p: any, actor: string, create: boolean): Promise<Res> {
  const errs = [...validateTestSpec(p.spec), ...validateScope("fact", p.bots, null, new Set())];
  if (!["playground", "real", "handwritten"].includes(p.origin)) errs.push("origin is not allowed");
  if (errs.length) return fail(422, "schema", "invalid test", errs);
  if (create) {
    const row = await deps.db.insert("ai_tests", { bots: p.bots, spec: p.spec, origin: p.origin, revision: 1, status: "active" });
    await deps.db.insert("ai_test_revisions", { test_id: row.id, revision: 1, status: "active", bots: p.bots, spec: p.spec });
    await deps.db.insert("ai_trainer_audit", { entity: "test", entity_id: row.id, action: "create", after: row, actor_claimed: actor });
    return ok({ id: row.id, revision: 1 });
  }
  if (!p.reason?.trim()) return fail(422, "reason_required", "A reason is required to change a test.");
  const cur = (await deps.db.select(`ai_tests?id=eq.${encodeURIComponent(p.id)}&select=*`))[0];
  if (!cur) return fail(404, "not_found", "Test not found.");
  if (cur.revision !== p.revision) return fail(409, "revision_conflict", "Someone else changed this test.");
  const next = cur.revision + 1;
  await deps.db.patch("ai_tests", `id=eq.${cur.id}`, { spec: p.spec, bots: p.bots, revision: next, updated_at: new Date().toISOString() });
  await deps.db.insert("ai_test_revisions", { test_id: cur.id, revision: next, status: cur.status, bots: p.bots, spec: p.spec, change_reason: p.reason });
  await deps.db.insert("ai_trainer_audit", { entity: "test", entity_id: cur.id, action: "update", before: cur, after: { ...cur, spec: p.spec, revision: next }, reason: p.reason, actor_claimed: actor });
  return ok({ id: cur.id, revision: next });
}

async function retireTest(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!p.reason?.trim()) return fail(422, "reason_required", "A reason is required to retire a test.");
  const cur = (await deps.db.select(`ai_tests?id=eq.${encodeURIComponent(p.id)}&select=*`))[0];
  if (!cur) return fail(404, "not_found", "Test not found.");
  if (cur.revision !== p.revision) return fail(409, "revision_conflict", "Someone else changed this test.");
  await deps.db.patch("ai_tests", `id=eq.${cur.id}`, { status: "retired", retired_reason: p.reason, revision: cur.revision + 1 });
  await deps.db.insert("ai_test_revisions", { test_id: cur.id, revision: cur.revision + 1, status: "retired", bots: cur.bots, spec: cur.spec, change_reason: p.reason });
  await deps.db.insert("ai_trainer_audit", { entity: "test", entity_id: cur.id, action: "retire", before: cur, reason: p.reason, actor_claimed: actor });
  return ok({ id: cur.id, revision: cur.revision + 1 });
}

// ── Playground history (migration 0040) ─────────────────────────────────────
// Every Playground turn is saved to ai_playground_turns under one
// ai_playground_conversations row, kept apart from WhatsApp (wa_messages) and
// the live trainer path (ai_turns). A continued conversation is rebuilt from
// what was saved: the history and the state the model sees come from the
// database, never from the browser. client_turn_id makes a retry return the
// saved turn instead of running the model a second time.
const PG_TURN_COLS = "id,conversation_id,seq,client_turn_id,customer_text,setup,returning_contact,state_before,state_after,reply,media,handoff,outcome,trace,error,checksum,core_version,created_at,finished_at";

async function pgTurns(db: Db, conversationId: string): Promise<any[]> {
  const rows = await db.select(`ai_playground_turns?conversation_id=eq.${encodeURIComponent(conversationId)}&select=${PG_TURN_COLS}&order=seq.asc`);
  return [...rows].sort((a, b) => a.seq - b.seq);
}

const pgHistory = (turns: any[]) => turns.flatMap((t) => [{ role: "customer", text: t.customer_text }, ...(t.reply ? [{ role: "bot", text: t.reply }] : [])]);

async function playgroundTurn(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 2000) return fail(422, "schema", "text is required (max 2000 characters)");
  // The browser sends one id per send so a retry is recognised. An older
  // caller without one still works, it just gets no retry protection.
  if (p.client_turn_id === undefined) p = { ...p, client_turn_id: crypto.randomUUID() };
  if (typeof p.client_turn_id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(p.client_turn_id)) return fail(422, "schema", "client_turn_id must be 8-64 letters, digits, - or _");
  const source = p.source === "snapshot" ? "snapshot" : "drafts";
  const snapshotId = source === "snapshot" ? String(p.snapshot_id || "") : null;
  if (source === "snapshot" && !snapshotId) return fail(422, "schema", "snapshot_id is required for a snapshot");

  // Continue a saved conversation, or start one. An unknown id is an error,
  // never a silent new conversation.
  let conv: any = null;
  if (p.conversation_id) {
    conv = (await deps.db.select(`ai_playground_conversations?id=eq.${encodeURIComponent(String(p.conversation_id))}&select=*`))[0];
    if (!conv) return fail(404, "not_found", "That Playground conversation no longer exists. Start a new one.");
    if (conv.bot !== p.bot || conv.source !== source || (conv.snapshot_id ?? null) !== snapshotId) {
      return fail(409, "mismatch", "This conversation was started with another bot or version. Start a new conversation to switch.");
    }
  } else {
    // A retried first turn: find the conversation its earlier attempt created.
    const prior = (await deps.db.select(`ai_playground_turns?client_turn_id=eq.${encodeURIComponent(p.client_turn_id)}&seq=eq.1&select=conversation_id`))[0];
    if (prior) conv = (await deps.db.select(`ai_playground_conversations?id=eq.${encodeURIComponent(prior.conversation_id)}&select=*`))[0] || null;
  }
  if (conv) {
    const done = (await pgTurns(deps.db, conv.id)).find((t) => t.client_turn_id === p.client_turn_id);
    if (done) return ok({ conversation_id: conv.id, conversation: conv, turn: done, duplicate: true });
  }

  const { content: frozen, checksum, errors } = await contentFor(deps, source, snapshotId ?? undefined);
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  const pm = await playgroundModel(deps);
  if ("error" in pm) return pm.error;
  // The configured model replaces the content's model for this call only; the
  // snapshot and its checksum are unchanged.
  // A snapshot carries the System Prompt it was frozen with; drafts use the
  // bot's published prompt, or its newest draft when the tester asks for it.
  const withPrompt = source === "snapshot" && frozen.system_prompts ? frozen
    : withSystemPrompt(frozen, { [p.bot]: await promptFor(deps.db, p.bot, p.prompt === "draft" ? "draft" : "published") });
  const content = pm.cfg ? { ...withPrompt, model_config: { ...withPrompt.model_config, reply_model: pm.cfg.model } } : withPrompt;

  const setup = conv ? conv.setup : { isAd: !!p.setup?.isAd, adText: p.setup?.isAd ? String(p.setup?.adText || "").slice(0, 500) : "", returning: !!p.setup?.returning };
  if (!conv) {
    conv = await deps.db.insert("ai_playground_conversations", { bot: p.bot, source, snapshot_id: snapshotId, setup, state: null,
      title: p.text.trim().slice(0, 80), turn_count: 0, created_by_claimed: actor });
  }
  const prev = await pgTurns(deps.db, conv.id);
  const stateBefore: ConvState = { ...emptyState(), ...(prev.at(-1)?.state_after || {}) };
  const returning = !!setup.returning || prev.length > 0;
  const startedAt = new Date().toISOString();
  const result = await runTurn({ content, bot: p.bot, text: p.text, history: pgHistory(prev), state: stateBefore,
    ad: { isAd: !!setup.isAd, adText: setup.adText || undefined }, returning, ports: { ...portsFor(deps, pm.llm), searchDocs: await docSearchPort(deps) } });
  result.trace.model = content.model_config.reply_model;
  result.trace.model_source = pm.cfg ? `playground config (${pm.cfg.provider})` : "server default";
  const now = new Date().toISOString();
  let saved: any;
  try {
    saved = await deps.db.insert("ai_playground_turns", {
      conversation_id: conv.id, seq: prev.length + 1, client_turn_id: p.client_turn_id, customer_text: p.text,
      setup, returning_contact: returning, state_before: prev.length ? stateBefore : null, state_after: result.stateNext,
      reply: result.reply || null, media: result.media, handoff: result.handoff, outcome: result.outcome, trace: result.trace,
      error: (result.trace.model_error as string) || null, checksum, core_version: CORE_VERSION, created_at: startedAt, finished_at: now,
    });
  } catch (e) {
    // Two requests raced on the same turn: the other one saved it first.
    const done = (await pgTurns(deps.db, conv.id)).find((t) => t.client_turn_id === p.client_turn_id);
    if (done) return ok({ conversation_id: conv.id, conversation: conv, turn: done, duplicate: true });
    throw e;
  }
  await deps.db.patch("ai_playground_conversations", `id=eq.${encodeURIComponent(conv.id)}`, { state: result.stateNext, turn_count: prev.length + 1, last_activity_at: now });
  return ok({ conversation_id: conv.id, conversation: { ...conv, state: result.stateNext, turn_count: prev.length + 1, last_activity_at: now },
    turn: saved, result, checksum, core_version: CORE_VERSION });
}

// ── Playground model configuration (migration 0043) ─────────────────────────
// Non-secret settings live in ai_model_configs; the key is a Vault secret
// reached only through the ai_model_key_set / ai_model_key_get RPCs. No action
// returns the key: the browser sees only whether one is set and its last 4.
const MC_COLS = "scope,provider,base_url,model,key_host,key_last4,key_set_at,last_test,updated_at,updated_by_claimed";
const mcRow = async (db: Db) => (await db.select(`ai_model_configs?scope=eq.playground&select=${MC_COLS}`))[0] || null;
const mcView = (row: any) => row && { provider: row.provider, base_url: row.base_url, model: row.model,
  key: row.key_last4 ? { set: true, masked: maskKey(row.key_last4), set_at: row.key_set_at } : { set: false, masked: null, set_at: null },
  last_test: row.last_test, updated_at: row.updated_at, updated_by: row.updated_by_claimed };

async function mcKey(db: Db): Promise<string | null> {
  const r = await db.rpc("ai_model_key_get", { p_scope: "playground" });
  return r.ok && typeof r.data === "string" && r.data ? r.data : null;
}

// The model the Playground calls: the saved config with its key, or the
// server default when nothing is saved. A saved config without a usable key
// is an error, never a silent fall back to the server key.
async function playgroundModel(deps: Deps): Promise<{ cfg: ModelConfig | null; llm: Llm } | { error: Res }> {
  const row = await mcRow(deps.db);
  if (!row) return { cfg: null, llm: deps.llm };
  const v = validateConfig(row);
  if (!v.ok) return { error: fail(422, "model_config", `The saved Playground model settings are invalid: ${v.errors.join("; ")}`) };
  if (!deps.modelLlm) return { error: fail(500, "model_config", "This server cannot use a custom Playground model.") };
  if (!row.key_last4) return { error: fail(422, "model_config", "The Playground model settings have no API key. Add one in Model & API.") };
  // The key is bound to the host it was entered for (key_host, set by
  // ai_model_key_set). A row pointing anywhere else never receives it.
  if (!row.key_host || row.key_host !== hostOf(v.value.base_url)) {
    return { error: fail(422, "model_config", "The stored API key was entered for a different host. Enter the key again in Model & API.") };
  }
  const key = await mcKey(deps.db);
  if (!key) return { error: fail(422, "model_config", "The Playground model settings have no API key. Add one in Model & API.") };
  return { cfg: v.value, llm: deps.modelLlm(v.value, key) };
}

async function modelConfigGet(deps: Deps): Promise<Res> {
  return ok({ config: mcView(await mcRow(deps.db)), providers: PROVIDERS,
    server_default: { provider: "openrouter", model: deps.env.replyModel } });
}

async function modelConfigSave(deps: Deps, p: any, actor: string): Promise<Res> {
  const v = validateConfig(p);
  if (!v.ok) return fail(422, "schema", v.errors.join("; "), v.errors);
  if (p.api_key !== undefined && p.api_key !== "" && !validKey(p.api_key)) return fail(422, "schema", "api_key must be 8-512 printable characters with no spaces");
  const before = await mcRow(deps.db);
  if (!before && !p.api_key) return fail(422, "schema", "An API key is required the first time.");
  if (before && !p.api_key && hostOf(before.base_url) !== hostOf(v.value.base_url)) {
    return fail(422, "key_required", "Enter the API key again: a stored key is never sent to a different host.");
  }
  const row = { ...v.value, updated_at: new Date().toISOString(), updated_by_claimed: actor,
    // A changed endpoint or model invalidates the last test result.
    ...(before && (before.provider !== v.value.provider || before.base_url !== v.value.base_url || before.model !== v.value.model) ? { last_test: null } : {}) };
  if (before) await deps.db.patch("ai_model_configs", "scope=eq.playground", row);
  else await deps.db.insert("ai_model_configs", { scope: "playground", ...row });
  if (p.api_key) {
    // The key is bound to the base URL saved just above. If another save
    // changed the host in between, the RPC refuses and stores nothing.
    const r = await deps.db.rpc("ai_model_key_set", { p_scope: "playground", p_key: p.api_key, p_actor: actor, p_expected_base_url: v.value.base_url });
    if (!r.ok && /host_mismatch/.test(r.error || "")) return fail(409, "conflict", "The settings were changed by someone else while saving. The API key was not stored. Reload and try again.");
    if (!r.ok) return fail(500, "secret", "Settings were saved, but the API key could not be stored. Try saving the key again.");
  }
  await deps.db.insert("ai_trainer_audit", { entity: "model_config", entity_id: "playground", action: before ? "update" : "create",
    before: before && { provider: before.provider, base_url: before.base_url, model: before.model, key_last4: before.key_last4 },
    after: { ...v.value, key_rotated: !!p.api_key }, actor_claimed: actor });
  return ok({ config: mcView(await mcRow(deps.db)) });
}

// Sends one tiny real request with the saved config and key. Reports success
// only when the provider answered with a completion. Never touches WhatsApp.
async function modelConfigTest(deps: Deps, actor: string): Promise<Res> {
  const pm = await playgroundModel(deps);
  if ("error" in pm) return pm.error;
  if (!pm.cfg) return fail(422, "model_config", "Save the Playground model settings before testing.");
  const started = Date.now();
  // 1024 is the floor at which requestBody asks OpenRouter for low reasoning
  // effort. With the old 5-token probe a reasoning model (e.g. DeepSeek) spent
  // every token thinking and the test failed with "length" although the key
  // and model were fine.
  const x = await pm.llm.chat({ model: pm.cfg.model, max_tokens: 1024, system: "Reply with the single word OK.", messages: [{ role: "user", content: "ping" }] });
  // The test asks "did the provider authenticate us and run this model?". A
  // completion that stopped on the token limit proves both, so it passes; the
  // real reply budget is larger (REPLY_LIMITS).
  const spentOnReasoning = !x.ok && (x as any).code === "length";
  const passed = x.ok || spentOnReasoning;
  const result = { ok: passed, at: new Date().toISOString(), ms: Date.now() - started, provider: pm.cfg.provider, model: pm.cfg.model,
    ...(spentOnReasoning ? { note: "The model answered but used the test's small token budget on reasoning. Key and model work; real replies get a larger budget." } : {}),
    ...(passed ? {} : { code: (x as any).code || "provider", error: (x as any).error }) };
  await deps.db.patch("ai_model_configs", "scope=eq.playground", { last_test: result });
  await deps.db.insert("ai_trainer_audit", { entity: "model_config", entity_id: "playground", action: "test", after: result, actor_claimed: actor });
  return ok(result);
}

// ── Embedding model and Markdown documents (migration 0047) ─────────────────
// The embedding model is its own ai_model_configs row (scope 'embedding') with
// its own Vault key bound to its own host. Documents are indexed only after
// review, only with the saved model, and an index built with another model or
// dimension never answers (ai_match_doc_chunks filters both).
const EMB_COLS = "scope,provider,base_url,model,embedding_dim,key_host,key_last4,key_set_at,last_test,updated_at,updated_by_claimed";
const embRow = async (db: Db) => (await db.select(`ai_model_configs?scope=eq.embedding&select=${EMB_COLS}`))[0] || null;
const embView = (row: any) => row && { ...mcView(row), embedding_dim: row.embedding_dim };
const DOC_COMPANY = (deps: Deps) => deps.env.companyId || "c1";

// The saved embedding config with its key, or why it cannot be used.
async function embeddingModel(deps: Deps): Promise<{ cfg: ModelConfig & { dim: number }; embed: (text: string) => Promise<{ ok: true; vector: number[]; tokens: number } | { ok: false; error: string }> } | { error: Res }> {
  const row = await embRow(deps.db);
  if (!row) return { error: fail(422, "no_embedding_model", "No embedding model is saved. Add one in Model & API.") };
  const v = validateConfig(row);
  if (!v.ok) return { error: fail(422, "embedding_config", `The saved embedding settings are invalid: ${v.errors.join("; ")}`) };
  if (!deps.embedWith) return { error: fail(500, "embedding_config", "This server cannot call an embedding model.") };
  if (!row.key_last4 || !row.key_host || row.key_host !== hostOf(v.value.base_url)) {
    return { error: fail(422, "embedding_config", "The embedding API key is missing or was entered for another host. Enter it again in Model & API.") };
  }
  const r = await deps.db.rpc("ai_model_key_get", { p_scope: "embedding" });
  const key = r.ok && typeof r.data === "string" ? r.data : "";
  if (!key) return { error: fail(422, "embedding_config", "The embedding API key could not be read. Enter it again in Model & API.") };
  const cfg = { ...v.value, dim: row.embedding_dim };
  const raw = deps.embedWith(cfg, key);
  // Every embedding call draws on the trainer budget like a reply call.
  const embed = async (text: string) => {
    const x = await withBudget(deps, estimate(deps.env, text.length, 1), async () => {
      const e = await raw(text);
      return { value: e, actualUsd: e.ok ? cost(deps.env, e.tokens, 0) : null };
    });
    return x === "over_budget" ? { ok: false as const, error: "over_budget: today's AI Trainer budget is used up" } : x;
  };
  return { cfg, embed };
}

async function embedConfigGet(deps: Deps): Promise<Res> {
  const chat = await mcRow(deps.db);
  return ok({ config: embView(await embRow(deps.db)), providers: PROVIDERS,
    chat_key: chat?.key_last4 ? { provider: chat.provider, host: chat.key_host } : null });
}

async function embedConfigSave(deps: Deps, p: any, actor: string): Promise<Res> {
  const v = validateConfig(p);
  if (!v.ok) return fail(422, "schema", v.errors.join("; "), v.errors);
  const dim = Number(p.embedding_dim);
  if (!Number.isInteger(dim) || dim < 1 || dim > 4096) return fail(422, "schema", "embedding_dim must be a whole number from 1 to 4096 (the model's vector size).");
  if (p.api_key !== undefined && p.api_key !== "" && !validKey(p.api_key)) return fail(422, "schema", "api_key must be 8-512 printable characters with no spaces");
  const before = await embRow(deps.db);
  let key: string | null = p.api_key || null;
  // The chat key may be reused only for the same provider and the same host.
  if (!key && p.reuse_chat_key) {
    const chat = await mcRow(deps.db);
    if (!chat?.key_last4 || chat.provider !== v.value.provider || chat.key_host !== hostOf(v.value.base_url)) {
      return fail(422, "key_required", "The chat model's key is for another provider or host, so it is not reused. Enter an embedding API key.");
    }
    const r = await deps.db.rpc("ai_model_key_get", { p_scope: "playground" });
    key = r.ok && typeof r.data === "string" ? r.data : null;
    if (!key) return fail(422, "key_required", "The chat model's key could not be read. Enter an embedding API key.");
  }
  if (!key && (!before?.key_last4 || hostOf(before.base_url) !== hostOf(v.value.base_url))) {
    return fail(422, "key_required", "Enter the embedding API key: a stored key is never sent to a different host.");
  }
  const modelChanged = !!before && (before.model !== v.value.model || before.embedding_dim !== dim || hostOf(before.base_url) !== hostOf(v.value.base_url));
  const row = { ...v.value, embedding_dim: dim, updated_at: new Date().toISOString(), updated_by_claimed: actor, ...(modelChanged ? { last_test: null } : {}) };
  if (before) await deps.db.patch("ai_model_configs", "scope=eq.embedding", row);
  else await deps.db.insert("ai_model_configs", { scope: "embedding", ...row });
  if (key) {
    const r = await deps.db.rpc("ai_model_key_set", { p_scope: "embedding", p_key: key, p_actor: actor, p_expected_base_url: v.value.base_url });
    if (!r.ok && /host_mismatch/.test(r.error || "")) return fail(409, "conflict", "The settings were changed by someone else while saving. The key was not stored.");
    if (!r.ok) return fail(500, "secret", "Settings were saved, but the key could not be stored. Try again.");
  }
  // A new model or dimension makes every indexed document stale: it must be
  // re-indexed before it answers again, never searched with mixed vectors.
  let reindex = { documents: 0 };
  if (modelChanged) {
    const docs = (await deps.db.select(`ai_trainer_documents?company_id=eq.${DOC_COMPANY(deps)}&select=id,status`)).filter((d) => d.status === "indexed" || d.status === "indexing");
    for (const d of docs) await deps.db.patch("ai_trainer_documents", `id=eq.${d.id}`, { status: "needs_reindex", updated_at: new Date().toISOString() });
    reindex = { documents: docs.length };
  }
  await deps.db.insert("ai_trainer_audit", { entity: "model_config", entity_id: "embedding", action: before ? "update" : "create",
    before: before && { provider: before.provider, base_url: before.base_url, model: before.model, embedding_dim: before.embedding_dim, key_last4: before.key_last4 },
    after: { ...v.value, embedding_dim: dim, key_rotated: !!key, reindex }, actor_claimed: actor });
  return ok({ config: embView(await embRow(deps.db)), reindex });
}

// One real embedding request; ok only when the provider returned a vector of
// the saved dimension.
async function embedConfigTest(deps: Deps, actor: string): Promise<Res> {
  const em = await embeddingModel(deps);
  if ("error" in em) return em.error;
  const started = Date.now();
  const x = await em.embed("Wecon Nuznan apartment size");
  const dimOk = x.ok && x.vector.length === em.cfg.dim;
  const result = { ok: dimOk, at: new Date().toISOString(), ms: Date.now() - started, provider: em.cfg.provider, model: em.cfg.model,
    ...(x.ok ? { dimensions: x.vector.length, tokens: x.tokens } : {}),
    ...(!x.ok ? { error: x.error } : !dimOk ? { error: `The model returned ${x.vector.length} dimensions; the settings expect ${em.cfg.dim}. Fix the dimension or the model.` } : {}) };
  await deps.db.patch("ai_model_configs", "scope=eq.embedding", { last_test: result });
  await deps.db.insert("ai_trainer_audit", { entity: "model_config", entity_id: "embedding", action: "test", after: result, actor_claimed: actor });
  return ok(result);
}

const DOC_COLS = "id,company_id,title,format,source_name,body,version,status,bots,project_ref,index_model,index_dim,indexed_version,index_error,reviewed_by_claimed,reviewed_at,created_at,updated_at";
const docGet = async (deps: Deps, id: unknown) => (await deps.db.select(`ai_trainer_documents?id=eq.${encodeURIComponent(String(id || ""))}&company_id=eq.${DOC_COMPANY(deps)}&select=${DOC_COLS}`))[0] || null;

// Ready to publish only when every reviewed (or later) document of the company
// is indexed for its current version with the saved model and dimension.
async function docsGate(deps: Deps): Promise<{ ready: boolean; blockers: string[]; needs_reindex: number }> {
  const emb = await embRow(deps.db);
  const docs = await deps.db.select(`ai_trainer_documents?company_id=eq.${DOC_COMPANY(deps)}&select=id,title,status,version,indexed_version,index_model,index_dim`);
  const live = docs.filter((d) => d.status !== "draft");
  const blockers = live.filter((d) => !(d.status === "indexed" && d.indexed_version === d.version && emb && d.index_model === emb.model && d.index_dim === emb.embedding_dim))
    .map((d) => `"${d.title}" is ${d.status === "indexed" ? "indexed with an older model" : d.status.replace("_", " ")}, not indexed for the current model`);
  return { ready: blockers.length === 0, blockers, needs_reindex: docs.filter((d) => d.status === "needs_reindex").length };
}

const projectNames = async (db: Db): Promise<ProjectName[]> =>
  (await db.select("ai_trainer_items?kind=eq.project&status=eq.active&select=id,body"))
    .map((p) => ({ id: p.id, name: String(p.body?.name ?? ""), aliases: Object.values(p.body?.aliases || {}).flat().filter((x): x is string => typeof x === "string") }));

async function docsList(deps: Deps): Promise<Res> {
  const rows = await deps.db.select(`ai_trainer_documents?company_id=eq.${DOC_COMPANY(deps)}&select=${DOC_COLS}&order=updated_at.desc`);
  const docs = rows.map(({ body, ...d }) => ({ ...d, chars: [...String(body || "")].length }));
  const g = await docsGate(deps);
  // Documents whose title names a project they are not tagged with: retrieval
  // cannot scope them, so another project's question can retrieve them.
  const names = await projectNames(deps.db);
  const association = rows.map((d) => ({ id: d.id, title: d.title, ...docAssociation(d.title, d.project_ref ?? null, names) })).filter((x) => x.problem);
  return ok({ documents: docs, publish_ready: g.ready, blockers: g.blockers, needs_reindex: g.needs_reindex, association });
}

async function docsGet(deps: Deps, p: any): Promise<Res> {
  const d = await docGet(deps, p.id);
  return d ? ok(d) : fail(404, "not_found", "Document not found.");
}

async function docsSave(deps: Deps, p: any, actor: string): Promise<Res> {
  const title = String(p.title || "").trim();
  const body = String(p.body || "").replace(/\r\n/g, "\n").trim();
  if (!title || title.length > 200) return fail(422, "schema", "A title of up to 200 characters is required.");
  if (!body || body.length > 200000) return fail(422, "schema", "The document is empty or longer than 200,000 characters.");
  if (!["markdown", "text", "pdf_text"].includes(p.format)) return fail(422, "schema", "format must be markdown, text or pdf_text");
  const bots = Array.isArray(p.bots) ? p.bots.filter((b: unknown) => b === "eyad" || b === "dubai") : [];
  if (!bots.length) return fail(422, "schema", "Choose at least one bot.");
  const projectRef = p.project_ref || null;
  if (projectRef && !(await activeProjectIds(deps.db)).has(projectRef)) return fail(422, "schema", "Unknown project.");
  const assoc = docAssociation(title, projectRef, await projectNames(deps.db));
  if (assoc.problem === "mismatch") return fail(422, "project_mismatch", `The title names ${assoc.named}, but the document is tagged with another project. Tag it with ${assoc.named}, or rename it.`);
  // The same text twice would be indexed twice and answer twice. Only a new
  // document or a text change is checked, so an existing copy can still be
  // retagged or renamed; the lookup is by the body's hash, not every body.
  const cur0 = p.id ? await docGet(deps, p.id) : null;
  if (!cur0 || String(cur0.body || "").trim() !== body) {
    const h = await sha256Hex(body);
    const sameText = (await deps.db.select(`ai_trainer_documents?company_id=eq.${DOC_COMPANY(deps)}&select=id,title,body`))
      .find((d) => d.id !== p.id && String(d.body || "").trim().length === body.length && String(d.body || "").trim() === body);
    if (sameText) return fail(409, "duplicate", `This text is already saved as "${sameText.title}" (${h.slice(0, 8)}). Edit that document instead.`);
  }
  const now = new Date().toISOString();
  const fields = { title, format: p.format, body, bots, project_ref: projectRef, source_name: p.source_name ? String(p.source_name).slice(0, 200) : null, updated_at: now };
  if (!p.id) {
    const row = await deps.db.insert("ai_trainer_documents", { ...fields, company_id: DOC_COMPANY(deps), version: 1, status: "draft", created_by_claimed: actor });
    await deps.db.insert("ai_trainer_audit", { entity: "document", entity_id: row.id, action: "create", after: { title, version: 1 }, actor_claimed: actor });
    return ok(row);
  }
  const cur = await docGet(deps, p.id);
  if (!cur) return fail(404, "not_found", "Document not found.");
  const changed = cur.body !== body || cur.title !== title || JSON.stringify(cur.bots) !== JSON.stringify(bots) || (cur.project_ref || null) !== projectRef;
  if (!changed) return ok(cur);
  // Any edit is a new version that must be reviewed and indexed again.
  const version = cur.version + 1;
  await deps.db.patch("ai_trainer_documents", `id=eq.${cur.id}`, { ...fields, version, status: "draft", reviewed_by_claimed: null, reviewed_at: null, index_error: null });
  await deps.db.insert("ai_trainer_audit", { entity: "document", entity_id: cur.id, action: "update", before: { version: cur.version, status: cur.status }, after: { version }, actor_claimed: actor });
  return ok(await docGet(deps, cur.id));
}

async function docsReview(deps: Deps, p: any, actor: string): Promise<Res> {
  const d = await docGet(deps, p.id);
  if (!d) return fail(404, "not_found", "Document not found.");
  if (Number(p.version) !== d.version) return fail(409, "stale", "The document changed since you opened it. Reload and review the current version.");
  if (d.status !== "draft") return ok(d);
  await deps.db.patch("ai_trainer_documents", `id=eq.${d.id}`, { status: "reviewed", reviewed_by_claimed: actor, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await deps.db.insert("ai_trainer_audit", { entity: "document", entity_id: d.id, action: "review", after: { version: d.version }, actor_claimed: actor });
  return ok(await docGet(deps, d.id));
}

async function docsIndex(deps: Deps, p: any, actor: string): Promise<Res> {
  const d = await docGet(deps, p.id);
  if (!d) return fail(404, "not_found", "Document not found.");
  if (!["reviewed", "failed", "needs_reindex", "indexed"].includes(d.status)) return fail(409, "not_reviewed", "Review the document before indexing it.");
  const em = await embeddingModel(deps);
  if ("error" in em) return em.error;
  const chunks = markdownChunks(d.format === "markdown" || d.format === "pdf_text" ? d.body : `# ${d.title}\n${d.body}`);
  if (!chunks.length) return fail(422, "empty", "The document has no text to index.");
  await deps.db.patch("ai_trainer_documents", `id=eq.${d.id}`, { status: "indexing", index_error: null, updated_at: new Date().toISOString() });
  const have = new Set((await deps.db.select(`ai_trainer_chunks?document_id=eq.${d.id}&document_version=eq.${d.version}&embedding_model=eq.${encodeURIComponent(em.cfg.model)}&select=chunk_no,embedding_dim`))
    .filter((c) => c.embedding_dim === em.cfg.dim).map((c) => c.chunk_no));
  let tokens = 0;
  for (const ch of chunks) {
    if (have.has(ch.chunk_no)) continue;
    const e = await em.embed(ch.text);
    const err = !e.ok ? e.error : e.vector.length !== em.cfg.dim ? `The model returned ${e.vector.length} dimensions; the settings expect ${em.cfg.dim}.` : null;
    if (err || !e.ok) {
      await deps.db.patch("ai_trainer_documents", `id=eq.${d.id}`, { status: "failed", index_error: `Section "${ch.section || "untitled"}": ${err}`.slice(0, 500), updated_at: new Date().toISOString() });
      await deps.db.insert("ai_trainer_audit", { entity: "document", entity_id: d.id, action: "index_failed", after: { version: d.version, error: err }, actor_claimed: actor });
      return ok({ ...(await docGet(deps, d.id)), body: undefined });
    }
    tokens += e.tokens;
    await deps.db.insert("ai_trainer_chunks", { document_id: d.id, document_version: d.version, chunk_no: ch.chunk_no, section: ch.section || null, chunk_text: ch.text,
      bots: d.bots, project_ref: d.project_ref, embedding_model: em.cfg.model, embedding_dim: em.cfg.dim,
      embedding: `[${e.vector.join(",")}]`, text_sha256: await sha256Hex(ch.text), company_id: DOC_COMPANY(deps) });
  }
  await deps.db.patch("ai_trainer_documents", `id=eq.${d.id}`, { status: "indexed", index_model: em.cfg.model, index_dim: em.cfg.dim, indexed_version: d.version, index_error: null, updated_at: new Date().toISOString() });
  await deps.db.insert("ai_trainer_audit", { entity: "document", entity_id: d.id, action: "index", after: { version: d.version, model: em.cfg.model, dim: em.cfg.dim, chunks: chunks.length, tokens }, actor_claimed: actor });
  const out = await docGet(deps, d.id);
  return ok({ ...out, body: undefined, chunks: chunks.length, tokens });
}

// The Playground's document search: the query is embedded with the saved
// model, and only indexed chunks of this company, model and dimension match.
async function docSearchPort(deps: Deps): Promise<Ports["searchDocs"] | undefined> {
  const live = (await deps.db.select(`ai_trainer_documents?company_id=eq.${DOC_COMPANY(deps)}&status=eq.indexed&select=id`)).length;
  if (!live) return undefined;
  const em = await embeddingModel(deps);
  if ("error" in em) return async () => { throw new Error(em.error.body.error.message); };
  return async ({ text, bot, projects }) => {
    const q = await em.embed(text);
    if (!q.ok) throw new Error(q.error);
    if (q.vector.length !== em.cfg.dim) throw new Error(`query embedding has ${q.vector.length} dimensions, the index has ${em.cfg.dim}`);
    const r = await deps.db.rpc("ai_match_doc_chunks", { p_company: DOC_COMPANY(deps), p_model: em.cfg.model, p_query: `[${q.vector.join(",")}]`, p_bot: bot, p_projects: projects, p_k: 5 });
    if (!r.ok) throw new Error(r.error || "ai_match_doc_chunks failed");
    // 0.2 only drops noise. Measured on the WECON documents, an unanswerable
    // question still scores up to 0.52, so a score never proves an answer:
    // the grounding guard does (a figure must appear in a retrieved excerpt).
    return (Array.isArray(r.data) ? r.data : []).filter((h: any) => typeof h.score === "number" && h.score >= 0.2);
  };
}

// ── Vector index (task 5, migration 0045) ───────────────────────────────────
// Embeds every active fact and example that has no chunk yet for its current
// revision. Each failure is listed; nothing partial is reported as done.
async function buildIndex(deps: Deps): Promise<Res> {
  const { embeddingModel: model, embeddingDim: dim } = deps.env;
  if (!model || !dim || !deps.embedder) return fail(422, "no_embedder", "No embedding model is configured, so the index cannot be built. Retrieval stays on full.");
  const items = (await loadDrafts(deps.db)) as ItemRow[];
  const embedder = deps.embedder;
  const r = await indexItems(items, model, dim, {
    embed: async (m, text) => {
      const x = await withBudget(deps, estimate(deps.env, text.length, 1), async () => {
        const e = await embedder(m, text);
        return { value: e, actualUsd: e.ok ? cost(deps.env, e.tokens, 0) : null };
      });
      return x === "over_budget" ? { ok: false as const, error: "over budget" } : x;
    },
    existingChunks: (m) => deps.db.select(`ai_trainer_chunks?embedding_model=eq.${encodeURIComponent(m)}&select=id,item_id,item_revision,chunk_no,embedding_model,embedding_dim`),
    insertChunk: (row) => deps.db.insert("ai_trainer_chunks", row),
  });
  return ok({ ...r, model, dim });
}

// ── System Prompt (migration 0046) ──────────────────────────────────────────
// Every save is a new immutable row; the newest draft is the editable one.
// Publish copies a draft into a new published row and moves the bot's
// pointer; rollback moves the pointer to an older published row. Only the
// Playground and test-number turns read the prompt.
// One company today (the pointer table's primary key is bot + company_id);
// pointer writes filter on bot alone because only c1 rows exist.
const SP_COMPANY = "c1";
const spBot = (b: unknown) => (b === "eyad" || b === "dubai" ? b : null);
const spRows = async (db: Db, bot: string) => (await db.select(`ai_system_prompts?bot=eq.${bot}&company_id=eq.${SP_COMPANY}&select=*&order=version_no.desc`))
  .sort((a, b) => b.version_no - a.version_no);
const spPointer = async (db: Db, bot: string) => (await db.select(`ai_system_prompt_pointers?bot=eq.${bot}&company_id=eq.${SP_COMPANY}&select=*`))[0] || null;
const spRef = (r: any): SystemPrompt | undefined => (r ? { id: r.id, version_no: r.version_no, sha256: r.sha256, body: r.body } : undefined);

async function promptFor(db: Db, bot: string, which: "draft" | "published"): Promise<SystemPrompt | undefined> {
  const rows = await spRows(db, bot);
  const ptr = await spPointer(db, bot);
  const pub = ptr?.prompt_id ? rows.find((r) => r.id === ptr.prompt_id) : null;
  if (which === "published") return spRef(pub);
  const d = rows.find((r) => r.status === "draft");
  return spRef(d && (!pub || d.version_no > pub.version_no) ? d : pub);
}

async function promptGet(deps: Deps, p: any): Promise<Res> {
  const bot = spBot(p.bot); if (!bot) return fail(422, "schema", "bot must be eyad or dubai");
  const rows = await spRows(deps.db, bot);
  const ptr = await spPointer(deps.db, bot);
  const published = ptr?.prompt_id ? rows.find((r) => r.id === ptr.prompt_id) || null : null;
  const newestDraft = rows.find((r) => r.status === "draft") || null;
  // A draft older than the newest published version was already published or superseded.
  const newestPub = rows.find((r) => r.status === "published");
  const draft = newestDraft && (!newestPub || newestDraft.version_no > newestPub.version_no) ? newestDraft : null;
  return ok({ bot, draft, published, pointer: ptr && { changed_at: ptr.changed_at, changed_by: ptr.changed_by_claimed, reason: ptr.reason }, limits: promptLimits });
}

async function promptHistory(deps: Deps, p: any): Promise<Res> {
  const bot = spBot(p.bot); if (!bot) return fail(422, "schema", "bot must be eyad or dubai");
  return ok((await spRows(deps.db, bot)).slice(0, 50));
}

async function spInsert(deps: Deps, bot: string, status: "draft" | "published", body: string, actor: string, note: string | null) {
  const next = ((await spRows(deps.db, bot))[0]?.version_no || 0) + 1;
  return deps.db.insert("ai_system_prompts", { bot, company_id: SP_COMPANY, version_no: next, status, body, sha256: await sha256Hex(body), note, created_by_claimed: actor });
}

async function promptSaveDraft(deps: Deps, p: any, actor: string): Promise<Res> {
  const bot = spBot(p.bot); if (!bot) return fail(422, "schema", "bot must be eyad or dubai");
  const body = typeof p.body === "string" ? p.body.replace(/\r\n/g, "\n").trim() : "";
  if (!body) return fail(422, "schema", "The prompt is empty.");
  if ([...body].length > promptLimits.maxChars) return fail(422, "schema", `The prompt is longer than ${promptLimits.maxChars} characters.`);
  return ok(await spInsert(deps, bot, "draft", body, actor, typeof p.note === "string" ? p.note.slice(0, 200) : null));
}

async function promptPublish(deps: Deps, p: any, actor: string): Promise<Res> {
  const bot = spBot(p.bot); if (!bot) return fail(422, "schema", "bot must be eyad or dubai");
  const rows = await spRows(deps.db, bot);
  const draft = rows.find((r) => r.id === p.draft_id && r.status === "draft");
  if (!draft) return fail(404, "not_found", "That draft does not exist for this bot.");
  if (rows.find((r) => r.status === "draft")?.id !== draft.id) return fail(409, "stale_draft", "A newer draft exists. Reload and publish the newest draft.");
  const before = await spPointer(deps.db, bot);
  const pub = await spInsert(deps, bot, "published", draft.body, actor, `published from draft v${draft.version_no}`);
  await deps.db.patch("ai_system_prompt_pointers", `bot=eq.${bot}`, { prompt_id: pub.id, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: "publish" });
  await deps.db.insert("ai_trainer_audit", { entity: "system_prompt", entity_id: bot, action: "publish", before: { prompt_id: before?.prompt_id ?? null }, after: { prompt_id: pub.id, version_no: pub.version_no, sha256: pub.sha256 }, actor_claimed: actor });
  return ok(pub);
}

async function promptRollback(deps: Deps, p: any, actor: string): Promise<Res> {
  const bot = spBot(p.bot); if (!bot) return fail(422, "schema", "bot must be eyad or dubai");
  const reason = String(p.reason || "").trim();
  if (!reason) return fail(422, "reason_required", "A reason is required to roll back.");
  const target = (await spRows(deps.db, bot)).find((r) => r.id === p.prompt_id);
  if (!target || target.status !== "published") return fail(422, "schema", "Only a published version of this bot can be rolled back to.");
  const before = await spPointer(deps.db, bot);
  await deps.db.patch("ai_system_prompt_pointers", `bot=eq.${bot}`, { prompt_id: target.id, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason });
  await deps.db.insert("ai_trainer_audit", { entity: "system_prompt", entity_id: bot, action: "rollback", before: { prompt_id: before?.prompt_id ?? null }, after: { prompt_id: target.id, version_no: target.version_no }, reason, actor_claimed: actor });
  return ok({ bot, prompt_id: target.id, version_no: target.version_no });
}

// One model turn with an unsaved prompt body against the current drafts.
// Nothing is saved: no version, no conversation, no turn row.
async function promptTest(deps: Deps, p: any): Promise<Res> {
  const bot = spBot(p.bot); if (!bot) return fail(422, "schema", "bot must be eyad or dubai");
  const body = typeof p.body === "string" ? p.body.trim() : "";
  if (!body || [...body].length > promptLimits.maxChars) return fail(422, "schema", "The prompt is empty or too long.");
  if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 2000) return fail(422, "schema", "Write a customer message to test with.");
  const { content: frozen, errors } = await contentFor(deps, "drafts");
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  const pm = await playgroundModel(deps);
  if ("error" in pm) return pm.error;
  const withPrompt = withSystemPrompt(frozen, { [bot]: { id: "unsaved", version_no: 0, sha256: await sha256Hex(body), body } });
  const content = pm.cfg ? { ...withPrompt, model_config: { ...withPrompt.model_config, reply_model: pm.cfg.model } } : withPrompt;
  const r = await runTurn({ content, bot, text: p.text, history: [], state: emptyState(), ad: { isAd: false }, returning: false, ports: portsFor(deps, pm.llm) });
  return ok({ reply: r.reply, outcome: r.outcome, handoff: r.handoff, media: r.media.map((m) => ({ kind: m.kind, caption: m.caption })), trace: r.trace });
}

// The brochure catalog: every active project's brochure, checked now. Read
// only: it fetches the first bytes of each file and sends nothing.
async function brochuresCheck(deps: Deps): Promise<Res> {
  const rows = brochureCatalog(await loadDrafts(deps.db)).sort((a, b) => a.project.localeCompare(b.project));
  // Four at a time: the catalog is small, but a slow host should not hold every slot.
  const checked: typeof rows = [];
  for (let i = 0; i < rows.length; i += 4) checked.push(...await Promise.all(rows.slice(i, i + 4).map((r) => verifyBrochure(r, deps.probe ?? null))));
  const verified = checked.filter((r) => r.status === "verified").length;
  return ok({ checked_at: (deps.now?.() ?? new Date()).toISOString(), rows: checked, counts: { total: checked.length, verified, problems: checked.length - verified } });
}

// Newest first. Search matches the title and any customer message or reply;
// bot narrows to one bot.
async function playgroundList(deps: Deps, p: any): Promise<Res> {
  let convs = await deps.db.select("ai_playground_conversations?select=id,bot,source,snapshot_id,title,turn_count,created_at,last_activity_at,state&order=last_activity_at.desc&limit=200");
  if (["eyad", "dubai"].includes(p.bot)) convs = convs.filter((c) => c.bot === p.bot);
  const q = typeof p.q === "string" ? p.q.trim().toLowerCase().slice(0, 200) : "";
  if (q) {
    const hits = new Set<string>();
    for (const c of convs) {
      if (String(c.title || "").toLowerCase().includes(q)) { hits.add(c.id); continue; }
      const ts = await pgTurns(deps.db, c.id);
      if (ts.some((t) => `${t.customer_text} ${t.reply || ""}`.toLowerCase().includes(q))) hits.add(c.id);
    }
    convs = convs.filter((c) => hits.has(c.id));
  }
  return ok([...convs].sort((a, b) => String(b.last_activity_at).localeCompare(String(a.last_activity_at))).slice(0, 100));
}

async function playgroundGet(deps: Deps, p: any): Promise<Res> {
  const conv = (await deps.db.select(`ai_playground_conversations?id=eq.${encodeURIComponent(String(p.id || ""))}&select=*`))[0];
  if (!conv) return fail(404, "not_found", "Playground conversation not found.");
  return ok({ conversation: conv, turns: await pgTurns(deps.db, conv.id) });
}

export async function handleTrainer(req: { method: string; headers: Headers; ip: string; body: any }, deps: Deps): Promise<Res> {
  if (req.method !== "POST") return fail(405, "method", "POST only");
  const now = (deps.now?.() ?? new Date()).getTime();
  if (limited(req.ip, now)) return fail(429, "rate_limited", "Too many failed sign-ins. Try again in 10 minutes.");
  const { action, payload: p = {}, actor_claimed, user_id } = req.body || {};
  if (!(await isManager(deps.db, user_id))) {
    fails.set(req.ip, [...(fails.get(req.ip) || []), now]);
    return fail(401, "unauthorized", "Only an active Management or Master account can use the AI Trainer.");
  }
  const actor = String(actor_claimed || "unknown").slice(0, 120);
  try {
    switch (action) {
      case "auth.check": return ok({ core_version: CORE_VERSION });
      case "items.list": return ok(await deps.db.select("ai_trainer_items?select=*"));
      case "items.create": return await saveItem(deps, p, actor, 0, null);
      case "items.update": return await saveItem(deps, p, actor, Number(p.revision), p.reason ?? null);
      case "items.retire": return await saveItem(deps, { ...p, status: "retired" }, actor, Number(p.revision), p.reason || "");
      case "items.history": return ok(await deps.db.select(`ai_trainer_audit?entity_id=eq.${encodeURIComponent(p.id)}&select=*`));
      case "import.preview": return await importPreview(deps);
      case "import.commit": return await importCommit(deps, p, actor);
      case "tests.list": return ok(await deps.db.select("ai_tests?select=*"));
      case "tests.create": return await saveTest(deps, p, actor, true);
      case "tests.update": return await saveTest(deps, p, actor, false);
      case "tests.retire": return await retireTest(deps, p, actor);
      case "playground.turn": return await playgroundTurn(deps, p, actor);
      case "playground.list": return await playgroundList(deps, p);
      case "playground.get": return await playgroundGet(deps, p);
      case "index.build": return await buildIndex(deps);
      case "embedconfig.get": return await embedConfigGet(deps);
      case "embedconfig.save": return await embedConfigSave(deps, p, actor);
      case "embedconfig.test": return await embedConfigTest(deps, actor);
      case "docs.list": return await docsList(deps);
      case "docs.get": return await docsGet(deps, p);
      case "docs.save": return await docsSave(deps, p, actor);
      case "docs.review": return await docsReview(deps, p, actor);
      case "docs.index": return await docsIndex(deps, p, actor);
      case "prompt.get": return await promptGet(deps, p);
      case "prompt.history": return await promptHistory(deps, p);
      case "prompt.save_draft": return await promptSaveDraft(deps, p, actor);
      case "prompt.publish": return await promptPublish(deps, p, actor);
      case "prompt.rollback": return await promptRollback(deps, p, actor);
      case "prompt.test": return await promptTest(deps, p);
      case "modelconfig.get": return await modelConfigGet(deps);
      case "modelconfig.save": return await modelConfigSave(deps, p, actor);
      case "modelconfig.test": return await modelConfigTest(deps, actor);
      case "brochures.check": return await brochuresCheck(deps);
      default: return await handleRunsAndPublish(action, p, actor, deps);
    }
  } catch (e) {
    if (e instanceof BudgetError) return fail(429, "over_budget", "Today's AI Trainer budget is used up.");
    return fail(500, "error", e instanceof Error ? e.message : String(e));
  }
}

const STEP_SIZE = 5;

async function freeze(deps: Deps, actor: string): Promise<Res> {
  const frozen = freezeContent(await loadDrafts(deps.db), { reply_model: deps.env.replyModel, max_tokens: REPLY_LIMITS.max_tokens, rubric_version: 1 });
  const errors = frozen.errors;
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  // Each bot's published System Prompt is pinned into the snapshot, so a
  // publish or rollback reproduces the prompt along with the knowledge.
  const prompted = withSystemPrompt(frozen.content, {
    eyad: await promptFor(deps.db, "eyad", "published"), dubai: await promptFor(deps.db, "dubai", "published"),
  });
  // Vector retrieval only when an embedding model is configured and every
  // fact and example already has its chunks (spec 4.3 rule 6); else "full".
  const { model, dim } = { model: deps.env.embeddingModel, dim: deps.env.embeddingDim };
  let retrievalNote: Record<string, unknown> = { mode: "full", reason: "no embedding model configured" };
  let content = prompted;
  if (model && dim) {
    const chunks = await deps.db.select(`ai_trainer_chunks?embedding_model=eq.${encodeURIComponent(model)}&select=id,item_id,item_revision,embedding_model,embedding_dim`);
    const v = vectorRetrieval(prompted, chunks, model, dim);
    if (v.ok) { content = { ...prompted, retrieval: v.retrieval }; retrievalNote = { mode: "vector", chunks: v.retrieval.mode === "vector" ? v.retrieval.chunk_ids.length : 0 }; }
    else retrievalNote = { mode: "full", reason: "index incomplete", missing: v.missing.length };
  }
  const checksum = await checksumOf(content);
  const prev = await deps.db.select("ai_snapshots?select=id,checksum,version_no");
  const same = prev.find((s) => s.checksum === checksum);
  if (same) return ok({ id: same.id, version_no: same.version_no, checksum, reused: true, retrieval: retrievalNote });
  const version_no = prev.reduce((m, s) => Math.max(m, s.version_no), 0) + 1;
  const row = await deps.db.insert("ai_snapshots", { version_no, content, checksum, core_version_frozen: CORE_VERSION, created_by_claimed: actor });
  await deps.db.insert("ai_trainer_audit", { entity: "snapshot", entity_id: row.id, action: "freeze", after: { version_no, checksum }, actor_claimed: actor });
  return ok({ id: row.id, version_no, checksum, reused: false, retrieval: retrievalNote });
}

async function startRun(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  const { checksum } = await contentFor(deps, "snapshot", p.snapshot_id);
  const tests = (await deps.db.select("ai_tests?status=eq.active&select=id,bots")).filter((t) => t.bots.includes(p.bot));
  const row = await deps.db.insert("ai_test_runs", {
    snapshot_id: p.snapshot_id, snapshot_checksum: checksum, bot: p.bot, core_version: CORE_VERSION,
    reply_model: deps.env.replyModel, judge_model: deps.env.judgeModel, prompt_version: "p1", rubric_version: "sales-default@1",
    status: "running", test_ids: tests.map((t) => t.id), counts: {}, cost_usd: 0, started_by_claimed: actor,
  });
  return ok({ id: row.id, total: tests.length });
}

// Judge with retries: one attempt, and two more only if the first is not a pass.
async function judge(deps: Deps, spec: TestSpec, r: any): Promise<{ verdict: string; attempts: any[] }> {
  const prompt = buildJudgePrompt(spec, r, RUBRIC_V1);
  const attempts: any[] = [];
  const once = async () => {
    for (let i = 0; i < 2; i++) {
      const x = await portsFor(deps).callModel({ model: deps.env.judgeModel, max_tokens: REPLY_LIMITS.max_tokens, system: prompt.system, messages: prompt.messages });
      if (x.ok) { const a = parseJudge(x.text); if (!a.error) return a; if (i === 1) return a; }
      else if (i === 1) return { verdict: "inconclusive" as const, rationale: "", error: x.error };
    }
    return { verdict: "inconclusive" as const, rationale: "", error: "unreachable" };
  };
  attempts.push(await once());
  if (attempts[0].verdict !== "pass") { attempts.push(await once()); attempts.push(await once()); }
  return { verdict: judgeVerdict(attempts), attempts };
}

async function stepRun(deps: Deps, p: any): Promise<Res> {
  const run = (await deps.db.select(`ai_test_runs?id=eq.${encodeURIComponent(p.run_id)}&select=*`))[0];
  if (!run) return fail(404, "not_found", "Run not found.");
  if (run.status !== "running") return ok({ status: run.status });
  const { content, checksum } = await contentFor(deps, "snapshot", run.snapshot_id);
  if (checksum !== run.snapshot_checksum) return fail(409, "checksum", "Snapshot content changed under this run.");
  const done = new Set((await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=test_id`)).map((r) => r.test_id));
  const todo = run.test_ids.filter((id: string) => !done.has(id)).slice(0, STEP_SIZE);
  for (const tid of todo) {
    const t = (await deps.db.select(`ai_tests?id=eq.${encodeURIComponent(tid)}&select=*`))[0];
    const spec: TestSpec = t.spec;
    const samples = spec.samples === 3 ? 3 : 1;
    let verdict: "PASS" | "FAIL" | "INCONCLUSIVE" = "PASS"; let last: any = null; let lastChecks: any[] = []; let lastJudge: any = { verdict: "none" };
    for (let i = 0; i < samples && verdict === "PASS"; i++) {
      const r = await runTurn({ content, bot: run.bot, text: spec.target, history: spec.conversation, state: { ...emptyState(), ...(spec.setup.state || {}) },
        ad: { isAd: spec.setup.isAd, adText: spec.setup.adText }, returning: spec.setup.returning, ports: portsFor(deps) });
      const checks = runChecks(spec, r);
      const failed = checks.some((c) => !c.pass);
      const j = failed ? { verdict: "skipped", attempts: [] } : spec.judge === "none" ? { verdict: "none", attempts: [] } : await judge(deps, spec, r);
      verdict = finalVerdict(checks, j.verdict as any);
      last = r; lastChecks = checks; lastJudge = j;
    }
    await deps.db.insert("ai_test_results", { run_id: run.id, test_id: t.id, test_revision: t.revision,
      reply: { reply: last.reply, media: last.media, handoff: last.handoff, outcome: last.outcome, trace: last.trace },
      checks: lastChecks, judge: lastJudge, verdict });
  }
  const results = await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=verdict`);
  if (results.length >= run.test_ids.length) {
    const counts = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 } as Record<string, number>;
    results.forEach((r) => counts[r.verdict]++);
    await deps.db.patch("ai_test_runs", `id=eq.${run.id}`, { status: "complete", counts, finished_at: new Date().toISOString() });
    return ok({ status: "complete", counts });
  }
  return ok({ status: "running", done: results.length, total: run.test_ids.length });
}

async function gateFor(deps: Deps, snapshotId: string, bot: Bot) {
  const snap = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(snapshotId)}&select=*`))[0];
  if (!snap) return { snap: null, gate: { ok: false, reasons: ["snapshot not found"] } };
  if (await checksumOf(snap.content) !== snap.checksum) return { snap, gate: { ok: false, reasons: ["snapshot checksum mismatch"] } };
  const runs = (await deps.db.select(`ai_test_runs?snapshot_id=eq.${encodeURIComponent(snapshotId)}&select=*`))
    .filter((r) => r.bot === bot && r.status === "complete").sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)));
  const run = runs[0] || null;
  const results = run ? await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=*`) : [];
  const activeTests = await deps.db.select("ai_tests?status=eq.active&select=id,revision,bots");
  return { snap, run, gate: publishGate({ snapshot: snap, run, results, activeTests, bot, coreVersion: CORE_VERSION }) };
}

async function publish(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  // Reviewed documents that are not indexed for the current embedding model
  // would silently drop out of retrieval; publishing waits for them.
  const dg = await docsGate(deps);
  if (!dg.ready) return fail(409, "documents_not_indexed", "Publish is blocked until every reviewed document is indexed.", dg.blockers);
  const { snap, gate } = await gateFor(deps, p.snapshot_id, p.bot);
  if (!gate.ok) return fail(409, "gate", "Publish is blocked.", gate.reasons);
  const r = await pointerSet(deps, p, actor, { mode: "snapshot", snapshotId: snap.id, publish: true, action: "publish", reason: "publish" });
  if (!r.ok) return pointerFail(r.error);
  return ok({ bot: p.bot, snapshot_id: snap.id, version_no: snap.version_no });
}

// One RPC does snapshot publish, pointer move and audit row in a single
// transaction (migration 0044). expected_snapshot_id is checked only when the
// caller sent the key; null means "expected legacy".
function pointerSet(deps: Deps, p: any, actor: string, o: { mode: string; snapshotId: string | null; publish: boolean; action: string; reason: string }) {
  const check = Object.prototype.hasOwnProperty.call(p, "expected_snapshot_id");
  return deps.db.rpc("ai_pointer_set", {
    p_bot: p.bot, p_mode: o.mode, p_snapshot_id: o.snapshotId, p_check_expected: check,
    p_expected_snapshot_id: check ? (p.expected_snapshot_id ?? null) : null,
    p_publish: o.publish, p_action: o.action, p_reason: o.reason, p_actor: actor,
  });
}
const pointerFail = (e?: string): Res => e?.includes("pointer_moved")
  ? fail(409, "conflict", "Someone else changed this bot's version. Reload and try again.")
  : fail(500, "db", e || "pointer update failed");

async function rollback(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (!String(p.reason || "").trim()) return fail(422, "reason_required", "A reason is required to roll back.");
  let snapshotId: string | null = null;
  if (!p.legacy) {
    const snap = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(p.snapshot_id)}&select=*`))[0];
    if (!snap || snap.status !== "published") return fail(422, "schema", "Only a published snapshot can be rolled back to.");
    const { gate } = await gateFor(deps, snap.id, p.bot);
    if (!gate.ok) return fail(409, "gate", "That version is not certified for the current core. Run its tests first.", gate.reasons);
    snapshotId = snap.id;
  }
  const r = await pointerSet(deps, p, actor, { mode: p.legacy ? "legacy" : "snapshot", snapshotId, publish: false, action: "rollback", reason: p.reason });
  if (!r.ok) return pointerFail(r.error);
  return ok({ bot: p.bot });
}

// ── test numbers (migration 0038) ───────────────────────────────────────────
// The switch and the allow-list live on wa_bot_settings (the same row and
// test_numbers column WA Relay edits). ai_turns is service-role only, so the
// per-number conversation and turn traces are read through this function.
const phoneTail = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

async function testNumbersGet(deps: Deps, p: any): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  const row = (await deps.db.select(`wa_bot_settings?bot=eq.${p.bot}&select=trainer_test_mode,test_numbers`))[0] || { trainer_test_mode: false, test_numbers: [] };
  const numbers: string[] = row.test_numbers || [];
  const out = [];
  for (const n of numbers) {
    const tail = phoneTail(n);
    // Every thread of this bot whose phone ends in the number: the JID may be a
    // phone or a LID, so the conversation id alone cannot be predicted.
    const convs = tail.length === 10 ? await deps.db.select(`wa_conversations?account=eq.${p.bot}&phone=like.*${tail}&select=id,phone,name,last_message_at`) : [];
    const threads = [];
    for (const c of convs) {
      const messages = await deps.db.select(`wa_messages?conversation_id=eq.${encodeURIComponent(c.id)}&select=id,direction,type,body,caption,status,error,sender_name,wa_id,wa_timestamp&order=wa_timestamp.desc&limit=30`);
      const turns = await deps.db.select(`ai_turns?conversation_id=eq.${encodeURIComponent(c.id)}&select=id,outcome,trace,started_at,finished_at,snapshot_checksum,core_version,model&order=started_at.desc&limit=10`);
      threads.push({ ...c, messages: messages.reverse(), turns });
    }
    out.push({ number: n, threads });
  }
  return ok({ bot: p.bot, trainer_test_mode: row.trainer_test_mode === true, numbers: out });
}

async function testNumbersSet(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (typeof p.trainer_test_mode !== "boolean") return fail(422, "schema", "trainer_test_mode must be true or false");
  const before = (await deps.db.select(`wa_bot_settings?bot=eq.${p.bot}&select=trainer_test_mode`))[0];
  if (!before) return fail(404, "not_found", "This bot has no settings row. Open WA Relay once, or run migration 0034.");
  await deps.db.patch("wa_bot_settings", `bot=eq.${p.bot}`, { trainer_test_mode: p.trainer_test_mode });
  await deps.db.insert("ai_trainer_audit", { entity: "test_mode", entity_id: p.bot, action: p.trainer_test_mode ? "enable" : "disable", before, after: { trainer_test_mode: p.trainer_test_mode }, actor_claimed: actor });
  return ok({ bot: p.bot, trainer_test_mode: p.trainer_test_mode });
}

// The Bots card's customer-reply switch (wa_bot_settings.faq_agent_enabled).
// Going through here adds the Management check and an audit row that the
// browser's direct write never had.
async function botsSetReplies(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (typeof p.enabled !== "boolean") return fail(422, "schema", "enabled must be true or false");
  const before = (await deps.db.select(`wa_bot_settings?bot=eq.${p.bot}&select=faq_agent_enabled`))[0];
  if (!before) return fail(404, "not_found", "This bot has no settings row. Open WA Relay once, or run migration 0034.");
  await deps.db.patch("wa_bot_settings", `bot=eq.${p.bot}`, { faq_agent_enabled: p.enabled });
  await deps.db.insert("ai_trainer_audit", { entity: "bot_replies", entity_id: p.bot, action: p.enabled ? "enable" : "disable", before, after: { faq_agent_enabled: p.enabled }, actor_claimed: actor });
  return ok({ bot: p.bot, faq_agent_enabled: p.enabled });
}

async function handleRunsAndPublish(action: string, p: any, actor: string, deps: Deps): Promise<Res> {
  switch (action) {
    case "snapshot.freeze": return await freeze(deps, actor);
    case "snapshot.list": return ok((await deps.db.select("ai_snapshots?select=id,version_no,status,checksum,core_version_frozen,created_at,created_by_claimed,published_at,published_by_claimed"))
      .sort((a, b) => b.version_no - a.version_no));
    case "runs.start": return await startRun(deps, p, actor);
    case "runs.step": return await stepRun(deps, p);
    // Summaries only (no per-test results), so the Bots card can show the
    // latest test state of each candidate without loading every result.
    case "runs.list": return ok((await deps.db.select("ai_test_runs?select=id,snapshot_id,bot,status,counts,started_at,finished_at&order=started_at.desc&limit=200"))
      .map(({ id, snapshot_id, bot, status, counts, started_at, finished_at }) => ({ id, snapshot_id, bot, status, counts, started_at, finished_at }))
      .sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || ""))));
    case "runs.get": {
      const run = (await deps.db.select(`ai_test_runs?id=eq.${encodeURIComponent(p.run_id)}&select=*`))[0];
      if (!run) return fail(404, "not_found", "Run not found.");
      return ok({ ...run, results: await deps.db.select(`ai_test_results?run_id=eq.${encodeURIComponent(run.id)}&select=*`) });
    }
    case "publish": return await publish(deps, p, actor);
    case "rollback": return await rollback(deps, p, actor);
    case "status": return ok({
      core_version: CORE_VERSION,
      pointers: await deps.db.select("ai_bot_pointers?select=*"),
      budget: await deps.db.select("ai_budget_days?pool=eq.trainer&select=*"),
    });
    case "testnumbers.get": return await testNumbersGet(deps, p);
    case "testnumbers.set": return await testNumbersSet(deps, p, actor);
    case "bots.set_replies": return await botsSetReplies(deps, p, actor);
    default: return fail(400, "unknown_action", `Unknown action: ${action}`);
  }
}

export const _internals = { contentFor, portsFor: (deps: Deps) => portsFor(deps), withBudget, saveItem, canonicalJson, buildJudgePrompt, parseJudge,
  judgeVerdict, finalVerdict, runChecks, publishGate, RUBRIC_V1, freezeContent, checksumOf };
export type { Bot, TestSpec };
