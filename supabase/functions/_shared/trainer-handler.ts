// ai-trainer request handler. Deno-free: the Edge Function passes in real
// database and OpenRouter ports, the Node tests pass in-memory ones. Every
// privileged action requires the X-Trainer-Key header, compared in constant
// time. The key is a temporary shared secret (spec §9): actor names in audit
// rows are claimed, not verified.
import {
  CORE_VERSION, KINDS, validateItem, validateScope, contentHash, freezeContent, checksumOf, canonicalJson,
  runTurn, emptyState, validateTestSpec, runChecks, buildJudgePrompt, parseJudge, judgeVerdict, finalVerdict,
  publishGate, redactTurns, RUBRIC_V1, type ItemRow, type Kind, type Bot, type SnapshotContent, type TestSpec,
  type Ports, type ConvState,
} from "./trainer-core.ts";

export type Db = {
  select(path: string): Promise<any[]>;
  insert(table: string, row: object): Promise<any>;
  patch(table: string, filter: string, patch: object): Promise<boolean>;
  rpc(fn: string, args: object): Promise<{ ok: boolean; data?: any; error?: string }>;
};
export type Llm = {
  chat(req: { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] }):
    Promise<{ ok: true; text: string; prompt_tokens: number; completion_tokens: number } | { ok: false; error: string }>;
};
export type Env = { trainerKey: string; budgetUsd: number; replyModel: string; judgeModel: string; pricePerMTok: { in: number; out: number } };
type Deps = { db: Db; llm: Llm; env: Env; now?: () => Date };
type Res = { status: number; body: any };

const ok = (data: unknown): Res => ({ status: 200, body: { ok: true, data } });
const fail = (status: number, code: string, message: string, details?: unknown): Res =>
  ({ status, body: { ok: false, error: { code, message, details } } });

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Failed key attempts per IP: 10 in 10 minutes locks that IP out for 10 minutes.
// Kept in module memory, so it resets on a cold start; that only loosens the
// limit briefly and never lets a wrong key through.
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
function portsFor(deps: Deps): Ports {
  return {
    callModel: async (req) => {
      const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
      const r = await withBudget(deps, estimate(deps.env, chars, req.max_tokens), async () => {
        const x = await deps.llm.chat(req);
        if (!x.ok) return { value: x, actualUsd: null };
        return { value: x, actualUsd: cost(deps.env, x.prompt_tokens, x.completion_tokens) };
      });
      if (r === "over_budget") throw new BudgetError();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, text: r.text, cost_usd: cost(deps.env, r.prompt_tokens, r.completion_tokens) };
    },
  };
}
class BudgetError extends Error { constructor() { super("over_budget"); } }

const activeProjectIds = async (db: Db) =>
  new Set((await db.select("ai_trainer_items?kind=eq.project&status=eq.active&select=id")).map((r) => r.id));

async function saveItem(deps: Deps, p: any, actor: string, expected: number, reason: string | null): Promise<Res> {
  if (!KINDS.includes(p.kind)) return fail(422, "schema", "unknown kind");
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
    const { content, errors } = freezeContent(await loadDrafts(deps.db), { reply_model: deps.env.replyModel, max_tokens: 600, rubric_version: 1 });
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

async function playgroundTurn(deps: Deps, p: any): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (typeof p.text !== "string" || !p.text.trim() || p.text.length > 2000) return fail(422, "schema", "text is required (max 2000 characters)");
  const { content, checksum, errors } = await contentFor(deps, p.source || "drafts", p.snapshot_id);
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  const state: ConvState = { ...emptyState(), ...(p.state || {}) };
  const result = await runTurn({ content, bot: p.bot, text: p.text, history: Array.isArray(p.history) ? p.history : [], state,
    ad: { isAd: !!p.setup?.isAd, adText: p.setup?.adText }, returning: !!p.setup?.returning, ports: portsFor(deps) });
  return ok({ result, checksum, core_version: CORE_VERSION });
}

export async function handleTrainer(req: { method: string; headers: Headers; ip: string; body: any }, deps: Deps): Promise<Res> {
  if (req.method !== "POST") return fail(405, "method", "POST only");
  const now = (deps.now?.() ?? new Date()).getTime();
  if (limited(req.ip, now)) return fail(429, "rate_limited", "Too many wrong keys. Try again in 10 minutes.");
  const key = req.headers.get("x-trainer-key") || "";
  if (!deps.env.trainerKey || !safeEqual(key, deps.env.trainerKey)) {
    fails.set(req.ip, [...(fails.get(req.ip) || []), now]);
    return fail(401, "unauthorized", "Trainer access key is missing or wrong.");
  }
  const { action, payload: p = {}, actor_claimed } = req.body || {};
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
      case "playground.turn": return await playgroundTurn(deps, p);
      default: return await handleRunsAndPublish(action, p, actor, deps);
    }
  } catch (e) {
    if (e instanceof BudgetError) return fail(429, "over_budget", "Today's AI Trainer budget is used up.");
    return fail(500, "error", e instanceof Error ? e.message : String(e));
  }
}

// Implemented in Task 7.
async function handleRunsAndPublish(action: string, _p: any, _actor: string, _deps: Deps): Promise<Res> {
  return fail(400, "unknown_action", `Unknown action: ${action}`);
}

export const _internals = { contentFor, portsFor, withBudget, saveItem, canonicalJson, buildJudgePrompt, parseJudge,
  judgeVerdict, finalVerdict, runChecks, publishGate, RUBRIC_V1, freezeContent, checksumOf };
export type { Bot, TestSpec };
