// ai-trainer request handler. Deno-free: the Edge Function passes in real
// database and OpenRouter ports, the Node tests pass in-memory ones. Every
// action requires the acting CRM user to be an active Management or Master
// account (see isManager). Actor names in audit rows are claimed, not verified.
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
export type Env = { budgetUsd: number; replyModel: string; judgeModel: string; pricePerMTok: { in: number; out: number } };
type Deps = { db: Db; llm: Llm; env: Env; now?: () => Date };
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
      case "playground.turn": return await playgroundTurn(deps, p);
      default: return await handleRunsAndPublish(action, p, actor, deps);
    }
  } catch (e) {
    if (e instanceof BudgetError) return fail(429, "over_budget", "Today's AI Trainer budget is used up.");
    return fail(500, "error", e instanceof Error ? e.message : String(e));
  }
}

const STEP_SIZE = 5;

async function freeze(deps: Deps, actor: string): Promise<Res> {
  const { content, errors } = freezeContent(await loadDrafts(deps.db), { reply_model: deps.env.replyModel, max_tokens: 600, rubric_version: 1 });
  if (errors.length) return fail(422, "freeze", "Drafts have errors. Fix them first.", errors);
  const checksum = await checksumOf(content);
  const prev = await deps.db.select("ai_snapshots?select=id,checksum,version_no");
  const same = prev.find((s) => s.checksum === checksum);
  if (same) return ok({ id: same.id, version_no: same.version_no, checksum, reused: true });
  const version_no = prev.reduce((m, s) => Math.max(m, s.version_no), 0) + 1;
  const row = await deps.db.insert("ai_snapshots", { version_no, content, checksum, core_version_frozen: CORE_VERSION, created_by_claimed: actor });
  await deps.db.insert("ai_trainer_audit", { entity: "snapshot", entity_id: row.id, action: "freeze", after: { version_no, checksum }, actor_claimed: actor });
  return ok({ id: row.id, version_no, checksum, reused: false });
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
      const x = await portsFor(deps).callModel({ model: deps.env.judgeModel, max_tokens: 400, system: prompt.system, messages: prompt.messages });
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
  const { snap, gate } = await gateFor(deps, p.snapshot_id, p.bot);
  if (!gate.ok) return fail(409, "gate", "Publish is blocked.", gate.reasons);
  if (snap.status !== "published") {
    await deps.db.patch("ai_snapshots", `id=eq.${snap.id}`, { status: "published", published_at: new Date().toISOString(), published_by_claimed: actor });
  }
  const before = (await deps.db.select(`ai_bot_pointers?bot=eq.${p.bot}&select=*`))[0];
  await deps.db.patch("ai_bot_pointers", `bot=eq.${p.bot}`, { mode: "snapshot", snapshot_id: snap.id, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: "publish" });
  await deps.db.insert("ai_trainer_audit", { entity: "pointer", entity_id: p.bot, action: "publish", before, after: { snapshot_id: snap.id, version_no: snap.version_no }, actor_claimed: actor });
  return ok({ bot: p.bot, snapshot_id: snap.id, version_no: snap.version_no });
}

async function rollback(deps: Deps, p: any, actor: string): Promise<Res> {
  if (!["eyad", "dubai"].includes(p.bot)) return fail(422, "schema", "bot must be eyad or dubai");
  if (!String(p.reason || "").trim()) return fail(422, "reason_required", "A reason is required to roll back.");
  const before = (await deps.db.select(`ai_bot_pointers?bot=eq.${p.bot}&select=*`))[0];
  if (p.legacy) {
    await deps.db.patch("ai_bot_pointers", `bot=eq.${p.bot}`, { mode: "legacy", snapshot_id: null, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: p.reason });
  } else {
    const snap = (await deps.db.select(`ai_snapshots?id=eq.${encodeURIComponent(p.snapshot_id)}&select=*`))[0];
    if (!snap || snap.status !== "published") return fail(422, "schema", "Only a published snapshot can be rolled back to.");
    const { gate } = await gateFor(deps, snap.id, p.bot);
    if (!gate.ok) return fail(409, "gate", "That version is not certified for the current core. Run its tests first.", gate.reasons);
    await deps.db.patch("ai_bot_pointers", `bot=eq.${p.bot}`, { mode: "snapshot", snapshot_id: snap.id, changed_at: new Date().toISOString(), changed_by_claimed: actor, reason: p.reason });
  }
  await deps.db.insert("ai_trainer_audit", { entity: "pointer", entity_id: p.bot, action: "rollback", before, after: { legacy: !!p.legacy, snapshot_id: p.snapshot_id ?? null }, reason: p.reason, actor_claimed: actor });
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

async function handleRunsAndPublish(action: string, p: any, actor: string, deps: Deps): Promise<Res> {
  switch (action) {
    case "snapshot.freeze": return await freeze(deps, actor);
    case "snapshot.list": return ok((await deps.db.select("ai_snapshots?select=id,version_no,status,checksum,core_version_frozen,created_at,created_by_claimed,published_at,published_by_claimed"))
      .sort((a, b) => b.version_no - a.version_no));
    case "runs.start": return await startRun(deps, p, actor);
    case "runs.step": return await stepRun(deps, p);
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
    default: return fail(400, "unknown_action", `Unknown action: ${action}`);
  }
}

export const _internals = { contentFor, portsFor: (deps: Deps) => portsFor(deps), withBudget, saveItem, canonicalJson, buildJudgePrompt, parseJudge,
  judgeVerdict, finalVerdict, runChecks, publishGate, RUBRIC_V1, freezeContent, checksumOf };
export type { Bot, TestSpec };
