import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTrainer, type Db, type Llm } from "./trainer-handler.ts";

// In-memory stand-in for the ai_ tables. It implements just the PostgREST
// paths and RPCs the handler uses, including revision conflicts and the
// atomic budget rule, so handler logic is tested without a database.
function memDb() {
  const t: Record<string, any[]> = { ai_trainer_items: [], ai_tests: [], ai_test_revisions: [], ai_snapshots: [], ai_bot_pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null }, { bot: "dubai", mode: "legacy", snapshot_id: null }], ai_test_runs: [], ai_test_results: [], ai_trainer_audit: [], ai_trainer_imports: [], wa_projects: [], wa_knowledge: [], wa_message_corrections: [], ai_budget_days: [], ai_playground_conversations: [], ai_playground_turns: [], wa_messages: [], ai_turns: [], ai_model_configs: [],
    users: [{ id: "mgr", role: "MANAGEMENT", is_active: true }, { id: "agent", role: "AGENT", is_active: true }, { id: "gone", role: "MASTER", is_active: false }] };
  const budget = { reserved: 0, spent: 0 }; const resv: Record<string, number> = {};
  let n = 0; const id = () => `id${++n}`;
  const vault: Record<string, string> = {};
  const db: Db & { t: typeof t; vault: typeof vault } = {
    t, vault,
    async select(path) {
      const [table, q] = path.split("?");
      let rows = [...(t[table] || [])];
      for (const part of (q || "").split("&")) {
        const m = /^(\w+)=eq\.(.+)$/.exec(part);
        if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2]));
      }
      return rows;
    },
    async insert(table, row: any) {
      if (table === "ai_playground_turns" && t[table].some((x) => x.conversation_id === row.conversation_id && (x.seq === row.seq || x.client_turn_id === row.client_turn_id))) {
        throw new Error('insert ai_playground_turns failed: 409 {"code":"23505"}');
      }
      const r = { id: id(), ...row }; t[table].push(r); return r;
    },
    async patch(table, filter, patch) {
      const [k, v] = filter.split("=eq."); const r = t[table].find((x) => String(x[k]) === decodeURIComponent(v));
      if (!r) return false; Object.assign(r, patch); return true;
    },
    async rpc(fn, a: any) {
      if (fn === "ai_budget_reserve") { if (budget.spent + budget.reserved + a.p_estimate > a.p_limit) return { ok: true, data: null }; budget.reserved += a.p_estimate; const rid = id(); resv[rid] = a.p_estimate; return { ok: true, data: rid }; }
      if (fn === "ai_budget_settle") { budget.reserved -= resv[a.p_id]; budget.spent += a.p_actual; return { ok: true }; }
      if (fn === "ai_budget_release") { budget.reserved -= resv[a.p_id]; return { ok: true }; }
      if (fn === "ai_item_save") {
        const it = a.p_item;
        if (it.status === "retired" && !a.p_reason) return { ok: false, error: "reason_required" };
        if (t.ai_trainer_items.some((x) => x.status === "active" && x.kind === it.kind && x.content_hash === it.content_hash && x.id !== it.id)) return { ok: false, error: "duplicate_content" };
        if (a.p_expected_revision === 0) { const r = { ...it, id: id(), revision: 1, status: it.status || "active" }; t.ai_trainer_items.push(r); t.ai_trainer_audit.push({ actor_claimed: a.p_actor }); return { ok: true, data: { id: r.id, revision: 1 } }; }
        const cur = t.ai_trainer_items.find((x) => x.id === it.id);
        if (!cur) return { ok: false, error: "not_found" };
        if (cur.revision !== a.p_expected_revision) return { ok: false, error: "revision_conflict" };
        Object.assign(cur, it, { revision: cur.revision + 1 }); t.ai_trainer_audit.push({ actor_claimed: a.p_actor });
        return { ok: true, data: { id: cur.id, revision: cur.revision } };
      }
      // Stand-in for ai_pointer_set (migration 0044): all-or-nothing, expected check, one audit row.
      if (fn === "ai_pointer_set") {
        const ptr = t.ai_bot_pointers.find((x) => x.bot === a.p_bot); if (!ptr) return { ok: false, error: "not_found" };
        if (a.p_check_expected && (ptr.snapshot_id ?? null) !== (a.p_expected_snapshot_id ?? null)) return { ok: false, error: "pointer_moved" };
        const snap = a.p_snapshot_id ? t.ai_snapshots.find((x) => x.id === a.p_snapshot_id) : null;
        if (a.p_mode === "snapshot" && !(snap && (snap.status === "published" || a.p_publish))) return { ok: false, error: "pointer must reference a published snapshot" };
        const before = structuredClone(ptr);
        if (a.p_publish && snap && snap.status !== "published") Object.assign(snap, { status: "published", published_at: "now", published_by_claimed: a.p_actor });
        Object.assign(ptr, { mode: a.p_mode, snapshot_id: a.p_snapshot_id, changed_at: "now", changed_by_claimed: a.p_actor, reason: a.p_reason });
        t.ai_trainer_audit.push({ entity: "pointer", entity_id: a.p_bot, action: a.p_action, before, after: { ...structuredClone(ptr), version_no: snap?.version_no ?? null }, reason: a.p_reason, actor_claimed: a.p_actor });
        return { ok: true, data: structuredClone(ptr) };
      }
      // Stand-in for the Vault-backed key functions (migration 0043).
      if (fn === "ai_model_key_set") {
        const host = (u: string) => new URL(u).hostname.toLowerCase().replace(/\.+$/, "");
        const r = t.ai_model_configs.find((x) => x.scope === a.p_scope); if (!r) return { ok: false, error: "no_config" };
        if (!a.p_expected_base_url) return { ok: false, error: "expected_base_url_required" };
        if (host(r.base_url) !== host(a.p_expected_base_url)) return { ok: false, error: '{"message":"host_mismatch"}' };
        vault[a.p_scope] = a.p_key; Object.assign(r, { key_secret_id: "v1", key_last4: a.p_key.slice(-4), key_host: host(a.p_expected_base_url), key_set_at: "now", last_test: null }); return { ok: true };
      }
      if (fn === "ai_model_key_get") return { ok: true, data: vault[a.p_scope] ?? null };
      return { ok: false, error: "unknown rpc" };
    },
  };
  return db;
}

const llm = (...texts: string[]): Llm & { calls: any[] } => {
  const calls: any[] = [];
  return { calls, async chat(req) { calls.push(req); const x = texts.shift(); return x === undefined ? { ok: false, error: "down" } : { ok: true, text: x, prompt_tokens: 100, completion_tokens: 50 }; } };
};
const ENV = { budgetUsd: 1, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 } };
// The failed sign-in counter is module state shared by every test in this file,
// so the rate-limit test uses its own IP and cannot lock the others out.
// The caller is the verified session (deps.actor); the token names the account.
// actor_claimed and user_id in the body are ignored, so they are set to lie.
const ROWS: Record<string, any> = {
  mgr: { id: "mgr", name: "Asad", role: "MANAGEMENT", is_active: true },
  agent: { id: "agent", name: "Agent", role: "AGENT", is_active: true },
  gone: { id: "gone", name: "Gone", role: "MASTER", is_active: false },
};
const verify = async (req: { headers: Headers }) => {
  const r = ROWS[(req.headers.get("authorization") || "").replace("Bearer ", "")];
  if (!r) throw Object.assign(new Error("Sign in required"), { status: 401 });
  if (!r.is_active) throw Object.assign(new Error("inactive"), { status: 403 });
  return r;
};
const call = (deps: any, action: string, payload: any = {}, userId: any = "mgr", ip = "1.1.1.1") =>
  handleTrainer({ method: "POST", headers: new Headers(userId ? { authorization: `Bearer ${userId}` } : {}), ip, body: { action, payload, actor_claimed: "Forged Name", user_id: "mgr" } }, { actor: verify, ...deps });

test("rejects missing, unknown, non-Management or inactive users; accepts Management", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (const u of [null, "", "nobody", "agent", "gone"]) assert.equal((await call(deps, "items.list", {}, u)).status, 401, String(u));
  assert.equal((await call(deps, "items.list")).status, 200);
});

test("defect 10: the trainer follows the shared feature rule (access-rules.js), the same one the browser shows", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  ROWS.granted = { id: "granted", name: "G", role: "AGENT", is_active: true, allowed_features: ["aitrainer"] };
  ROWS.revoked = { id: "revoked", name: "R", role: "MANAGEMENT", is_active: true, allowed_features: ["leads"] };
  assert.equal((await call(deps, "items.list", {}, "granted", "8.8.8.1")).status, 200, "an aitrainer grant opens it");
  assert.equal((await call(deps, "items.list", {}, "revoked", "8.8.8.2")).status, 401, "a saved list without aitrainer closes it");
});

test("a body user_id naming a manager does not open the trainer without that manager's session", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const r = await handleTrainer({ method: "POST", headers: new Headers(), ip: "7.7.7.7", body: { action: "items.list", user_id: "mgr" } }, { actor: verify, ...deps });
  assert.equal(r.status, 401);
});

test("a sign-in service outage (503) is not a failed sign-in: no lockout, and it says so", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const down = async () => { throw Object.assign(new Error("Sign-in service unavailable"), { status: 503 }); };
  for (let i = 0; i < 12; i++) {
    const r = await handleTrainer({ method: "POST", headers: new Headers({ authorization: "Bearer mgr" }), ip: "6.6.6.6", body: { action: "items.list" } }, { actor: down, ...deps });
    assert.equal(r.status, 503, `call ${i}`);
  }
  assert.equal((await call(deps, "items.list", {}, "mgr", "6.6.6.6")).status, 200, "the office ip is not locked out");
});

test("a valid session without trainer access (403) is refused but never locks the ip out", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (let i = 0; i < 12; i++) assert.equal((await call(deps, "items.list", {}, "agent", "5.5.5.5")).status, 401);
  assert.equal((await call(deps, "items.list", {}, "mgr", "5.5.5.5")).status, 200, "a manager behind the same office NAT still gets in");
});

test("rate limits repeated failed sign-ins per ip", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (let i = 0; i < 10; i++) await call(deps, "items.list", {}, "nobody", "9.9.9.9");
  assert.equal((await call(deps, "items.list", {}, "mgr", "9.9.9.9")).status, 429);
  assert.equal((await call(deps, "items.list")).status, 200);
});

test("items.create validates schema and scope", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "" } })).status, 422);
  assert.equal((await call(deps, "items.create", { kind: "fact", bots: ["both"], project_ref: null, body: { topic: "a", text: "b" } })).status, 422);
  const ok = await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  assert.equal(ok.status, 200); assert.equal(ok.body.data.revision, 1);
});

test("items.update with stale revision returns 409; duplicate returns 409", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const c = await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  const idv = c.body.data.id;
  assert.equal((await call(deps, "items.update", { id: idv, revision: 1, kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "c" } })).status, 200);
  assert.equal((await call(deps, "items.update", { id: idv, revision: 1, kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "d" } })).status, 409);
  assert.equal((await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "c" } })).status, 409);
});

test("playground.turn on drafts reserves budget and returns trace; refuses when budget spent", async () => {
  const out = JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project?", media: [], handoff: false, asked: ["project"], used_item_ids: [], clarify: true });
  const db = memDb();
  const deps = { db, llm: llm(out), env: ENV };
  const r = await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text: "What is the price?", history: [], state: null, setup: { isAd: false, returning: false } });
  assert.equal(r.status, 200); assert.equal(r.body.data.result.reply, "Which project?");
  assert.ok(r.body.data.result.trace.core_version);
  const poor = { db: memDb(), llm: llm(out), env: { ...ENV, budgetUsd: 0.0000001 } };
  assert.equal((await call(poor, "playground.turn", { bot: "eyad", source: "drafts", text: "price?", history: [], state: null, setup: { isAd: false, returning: false } })).status, 429);
});

test("tests.create validates spec; tests.retire needs reason", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec: { title: "" } })).status, 422);
  const spec = { title: "t", setup: { isAd: false, returning: false }, conversation: [], target: "hi", checks: [{ type: "no_reply" }], ideal_reply: "", judge: "none" };
  const c = await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec });
  assert.equal(c.status, 200);
  assert.equal((await call(deps, "tests.retire", { id: c.body.data.id, revision: 1, reason: "" })).status, 422);
  assert.equal((await call(deps, "tests.retire", { id: c.body.data.id, revision: 1, reason: "obsolete" })).status, 200);
});

test("import.preview classifies legacy rows and reports duplicates", async () => {
  const db = memDb();
  db.t.wa_projects.push({ id: 7, name: "Wecon Nuznan", keywords: ["nuznan"], region: "Dhaka", nature: "Residential", sft: "2850", address: "Sector 16, Jolshiri Abashon", photos: [], floor_plans: ["https://x/g.jpg"], floor_plan_labels: ["Ground"], brochure_url: "", map_image_url: "", is_active: true });
  db.t.wa_knowledge.push({ id: "k1", title: "Land", body: "If a customer offers land, give 01335142002", is_active: true });
  const deps = { db, llm: llm(), env: ENV };
  const r = await call(deps, "import.preview", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.data.rows.find((x: any) => x.source === "wa_projects").proposed.kind, "project");
  assert.equal(r.body.data.rows.find((x: any) => x.source === "wa_knowledge").proposed.kind, "rule");
});

const OUT = (o: any = {}) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project are you interested in?", media: [], handoff: false, asked: [], used_item_ids: [], clarify: true, ...o });
const JPASS = JSON.stringify({ verdict: "pass", criteria: {}, rationale: "good" });
const JFAIL = JSON.stringify({ verdict: "fail", criteria: {}, rationale: "bad" });
const SPEC1 = { title: "price no project", setup: { isAd: false, returning: false }, conversation: [], target: "What is the price?", checks: [{ type: "handoff", value: false }], ideal_reply: "ask which project", judge: "rubric" };

async function setup(llmTexts: string[]) {
  const db = memDb();
  const deps = { db, llm: llm(...llmTexts), env: ENV };
  await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec: SPEC1 });
  const s = await call(deps, "snapshot.freeze", {});
  return { db, deps, snapId: s.body.data.id };
}

test("full flow: freeze, run, publish allowed on all PASS", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(run.status, 200);
  const step = await call(deps, "runs.step", { run_id: run.body.data.id });
  assert.equal(step.body.data.status, "complete");
  const pub = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(pub.status, 200);
  const st = await call(deps, "status", {});
  assert.equal(st.body.data.pointers.find((x: any) => x.bot === "eyad").mode, "snapshot");
});

test("publish refused on FAIL", async () => {
  const { deps, snapId } = await setup([OUT(), JFAIL, JFAIL, JFAIL]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  const pub = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(pub.status, 409); assert.ok(pub.body.error.details.some((r: string) => r.includes("FAIL")));
});

test("publish refused on INCONCLUSIVE when the judge is down", async () => {
  const { deps, snapId } = await setup([OUT()]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  const r = await call(deps, "runs.get", { run_id: run.body.data.id });
  assert.equal(r.body.data.results[0].verdict, "INCONCLUSIVE");
  assert.equal((await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" })).status, 409);
});

test("publish refused when there are no active tests, even after a complete run", async () => {
  const db = memDb();
  const deps = { db, llm: llm(), env: ENV };
  await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "a", text: "b" } });
  const snapId = (await call(deps, "snapshot.freeze", {})).body.data.id;
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(run.body.data.total, 0);
  assert.equal((await call(deps, "runs.step", { run_id: run.body.data.id })).body.data.status, "complete");
  const pub = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(pub.status, 409);
  assert.ok(pub.body.error.details.some((r: string) => r.includes("no active tests")));
  assert.equal((await call(deps, "status", {})).body.data.pointers.find((x: any) => x.bot === "eyad").mode, "legacy");
});

test("deterministic failure skips judge and fails", async () => {
  const { deps, snapId } = await setup([OUT({ handoff: true })]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  const r = await call(deps, "runs.get", { run_id: run.body.data.id });
  assert.equal(r.body.data.results[0].verdict, "FAIL");
  assert.equal(r.body.data.results[0].judge.verdict, "skipped");
});

test("rollback to legacy needs a reason", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
  await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal((await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "" })).status, 422);
  assert.equal((await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "test" })).status, 200);
});

test("freeze refuses when drafts have errors", async () => {
  const db = memDb();
  const deps = { db, llm: llm(), env: ENV };
  db.t.ai_trainer_items.push({ id: "x", kind: "fact", revision: 1, status: "active", bots: ["eyad"], project_ref: "missing", body: { topic: "a", text: "b" } });
  assert.equal((await call(deps, "snapshot.freeze", {})).status, 422);
});

test("a test run replays the saved conversation state, so a context turn resolves its project", async () => {
  const db = memDb();
  const deps = { db, llm: llm(), env: ENV };
  const proj = await call(deps, "items.create", { kind: "project", bots: ["eyad"], project_ref: null,
    body: { name: "Wecon Nuznan", aliases: { banglish: ["nuznan"], en: ["nuznan"] }, media: { photos: [], floor_plans: [] } } });
  const pid = proj.body.data.id;
  const spec = { title: "location from context", setup: { isAd: false, returning: true, state: { active_project: pid, active_source: "explicit" } },
    conversation: [{ role: "customer", text: "nuznan er dam koto?" }, { role: "bot", text: "Which floor?" }], target: "location?",
    checks: [{ type: "project_resolved_is", value: pid }], ideal_reply: "", judge: "none" };
  assert.equal((await call(deps, "tests.create", { bots: ["eyad"], origin: "playground", spec })).status, 200);
  deps.llm = llm(OUT({ reply: "Sector 16, Jolshiri Abashon", project_ref: pid, clarify: false }));
  const snap = (await call(deps, "snapshot.freeze", {})).body.data;
  const run = (await call(deps, "runs.start", { snapshot_id: snap.id, bot: "eyad" })).body.data;
  await call(deps, "runs.step", { run_id: run.id });
  const got = (await call(deps, "runs.get", { run_id: run.id })).body.data.results[0];
  assert.equal(got.verdict, "PASS", JSON.stringify(got.checks));
});

test("tests.create rejects a setup.state that is not an object", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const spec = { title: "t", setup: { isAd: false, returning: false, state: "x" }, conversation: [], target: "hi", checks: [], ideal_reply: "", judge: "none" };
  assert.equal((await call(deps, "tests.create", { bots: ["eyad"], origin: "handwritten", spec })).status, 422);
});

test("a real-conversation example is redacted on save, replies included; a handwritten one is kept as written", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const ex = (text: string, ideal = "Happy to help, which project?") => ({ kind: "example", bots: ["eyad"], project_ref: null,
    body: { conversation: [{ role: "customer", text }], original_reply: "Hi Rahim, call 01711000001", ideal_reply: ideal, reason: "live reply corrected", source: "real" } });
  const r = await call(deps, "items.create", ex("I am Rahim, mail rahim@x.com or call +880 1711-000001, see https://x.test/a"));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const saved = deps.db.t.ai_trainer_items.at(-1).body;
  const all = JSON.stringify(saved);
  assert.ok(!all.includes("rahim@x.com") && !all.includes("1711") && !all.includes("https://x.test"), all);
  assert.ok(saved.conversation[0].text.includes("{email}") && saved.conversation[0].text.includes("{phone}"), all);
  const bad = await call(deps, "items.create", ex("hi", "Call our agent at 01711000001"));
  assert.equal(bad.status, 200, "ideal reply phone is redacted too");
  assert.ok(!JSON.stringify(deps.db.t.ai_trainer_items.at(-1).body).includes("01711000001"));
  // a handwritten example is the author's own text and is not rewritten
  const hw = await call(deps, "items.create", { ...ex("Land Team number?"), body: { ...ex("Land Team number?").body, source: "handwritten", ideal_reply: "Land Team: 01335142002" } });
  assert.equal(hw.status, 200);
  assert.ok(JSON.stringify(deps.db.t.ai_trainer_items.at(-1).body).includes("01335142002"));
});

// ── Playground history (migration 0040) ─────────────────────────────────────
const REPLY = (reply: string, o: object = {}) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply, media: [], handoff: false, asked: [], used_item_ids: [], clarify: false, ...o });
const turn = (deps: any, p: object) => call(deps, "playground.turn", { bot: "eyad", source: "drafts", setup: { isAd: false, returning: false }, ...p });

test("playground: the first turn creates a conversation and saves the turn", async () => {
  const deps = { db: memDb(), llm: llm(REPLY("Which project are you interested in?")), env: ENV };
  const r = await turn(deps, { text: "What is the price?", client_turn_id: "c-0001-aaaa" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { conversation_id, turn: saved } = r.body.data;
  assert.ok(conversation_id);
  const conv = deps.db.t.ai_playground_conversations[0];
  assert.equal(conv.id, conversation_id); assert.equal(conv.bot, "eyad"); assert.equal(conv.source, "drafts");
  assert.equal(conv.title, "What is the price?"); assert.equal(conv.turn_count, 1);
  assert.equal(saved.seq, 1); assert.equal(saved.customer_text, "What is the price?");
  assert.equal(saved.reply, "Which project are you interested in?"); assert.equal(saved.outcome, "ok");
  assert.ok(saved.trace && saved.created_at && saved.finished_at);
});

test("playground: turns keep their order and continue from the saved state, not the client's", async () => {
  const deps = { db: memDb(), llm: llm(REPLY("Which project?", { asked: ["project"] }), REPLY("Got it.")), env: ENV };
  const a = await turn(deps, { text: "price?", client_turn_id: "c-0001-aaaa" });
  const cid = a.body.data.conversation_id;
  // The client sends a stale/forged history and state; the server must ignore both.
  const b = await turn(deps, { conversation_id: cid, text: "Nuznan", client_turn_id: "c-0002-bbbb", history: [{ role: "customer", text: "FORGED" }], state: { asked: ["FORGED"] } });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.data.turn.seq, 2);
  const msgs = deps.llm.calls[1].messages.map((m: any) => m.content).join("|");
  assert.ok(msgs.includes("price?") && msgs.includes("Which project?") && !msgs.includes("FORGED"), msgs);
  assert.ok(deps.llm.calls[1].system.includes('"already_asked":["project"]'), "state came from the saved turn");
  assert.equal(deps.db.t.ai_playground_conversations[0].turn_count, 2);
  const got = await call(deps, "playground.get", { id: cid });
  assert.deepEqual(got.body.data.turns.map((t: any) => [t.seq, t.customer_text]), [[1, "price?"], [2, "Nuznan"]]);
});

test("playground: list and get reload saved history (as after a page refresh), newest first, with search", async () => {
  const deps = { db: memDb(), llm: llm(REPLY("A"), REPLY("B"), REPLY("C")), env: ENV };
  const c1 = (await turn(deps, { text: "Jolshiri plots?", client_turn_id: "c-0001-aaaa" })).body.data.conversation_id;
  await turn(deps, { conversation_id: c1, text: "and parking?", client_turn_id: "c-0002-aaaa" });
  const c2 = (await turn(deps, { bot: "dubai", text: "Dubai visa help", client_turn_id: "c-0003-aaaa" })).body.data.conversation_id;
  deps.db.t.ai_playground_conversations.find((c: any) => c.id === c2).last_activity_at = "2099-01-01T00:00:00Z";
  const all = await call(deps, "playground.list", {});
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.data.map((c: any) => [c.id, c.turn_count]), [[c2, 1], [c1, 2]]);
  assert.deepEqual((await call(deps, "playground.list", { q: "parking" })).body.data.map((c: any) => c.id), [c1]);
  assert.deepEqual((await call(deps, "playground.list", { bot: "dubai" })).body.data.map((c: any) => c.id), [c2]);
  const g = await call(deps, "playground.get", { id: c1 });
  assert.equal(g.body.data.conversation.id, c1); assert.equal(g.body.data.turns.length, 2);
});

test("playground: a retried request returns the saved turn without a second model call or row", async () => {
  const deps = { db: memDb(), llm: llm(REPLY("Once"), REPLY("Twice")), env: ENV };
  const a = await turn(deps, { text: "price?", client_turn_id: "c-0001-aaaa" });
  const cid = a.body.data.conversation_id;
  const again = await turn(deps, { conversation_id: cid, text: "price?", client_turn_id: "c-0001-aaaa" });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.turn.reply, "Once"); assert.equal(again.body.data.duplicate, true);
  assert.equal(deps.llm.calls.length, 1); assert.equal(deps.db.t.ai_playground_turns.length, 1);
  // A retry of a first turn (no conversation id yet) finds the same turn too.
  const firstRetry = await turn(deps, { text: "price?", client_turn_id: "c-0001-aaaa" });
  assert.equal(firstRetry.body.data.conversation_id, cid); assert.equal(deps.db.t.ai_playground_conversations.length, 1);
});

test("playground: history is isolated from WhatsApp tables and stores no client-sent secrets", async () => {
  const deps = { db: memDb(), llm: llm(REPLY("ok")), env: ENV };
  deps.db.t.wa_messages.push({ conversation_id: "eyad:880@s.whatsapp.net", direction: "IN", body: "real customer" });
  const r = await turn(deps, { text: "hello there friend", client_turn_id: "c-0001-aaaa", apikey: "SECRET-KEY", service_role: "SECRET" });
  assert.equal(r.status, 200);
  assert.equal(deps.db.t.wa_messages.length, 1, "no wa_messages row written");
  assert.equal(deps.db.t.ai_turns.length, 0, "no live ai_turns row written");
  assert.ok(!JSON.stringify([deps.db.t.ai_playground_conversations, deps.db.t.ai_playground_turns]).includes("SECRET"));
  const g = await call(deps, "playground.get", { id: "eyad:880@s.whatsapp.net" });
  assert.equal(g.status, 404, "a WhatsApp conversation id is not a Playground conversation");
  assert.ok(!JSON.stringify((await call(deps, "playground.list", {})).body.data).includes("real customer"));
});

test("playground: a failed model call is saved and shown, empty history lists nothing", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.deepEqual((await call(deps, "playground.list", {})).body.data, []);
  const r = await turn(deps, { text: "price?", client_turn_id: "c-0001-aaaa" });
  assert.equal(r.status, 200);
  const t = r.body.data.turn;
  assert.equal(t.outcome, "fallback_model_error"); assert.equal(t.trace.model_error, "down");
  assert.equal(deps.db.t.ai_playground_turns[0].outcome, "fallback_model_error");
});

test("playground: an unknown conversation id or a mismatched bot is refused, not silently replaced", async () => {
  const deps = { db: memDb(), llm: llm(REPLY("a")), env: ENV };
  assert.equal((await turn(deps, { conversation_id: "nope", text: "hi there", client_turn_id: "c-0001-aaaa" })).status, 404);
  assert.equal(deps.db.t.ai_playground_conversations.length, 0);
  const cid = (await turn(deps, { text: "price?", client_turn_id: "c-0002-aaaa" })).body.data.conversation_id;
  assert.equal((await turn(deps, { conversation_id: cid, bot: "dubai", text: "x y z", client_turn_id: "c-0003-aaaa" })).status, 409);
  assert.equal((await turn(deps, { text: "price?", client_turn_id: "short" })).status, 422);
});

// ── Playground model configuration (migration 0043) ────────────────────────
const KEY = "sk-live-TOPSECRET-9876";
const CFG = { provider: "custom", base_url: "https://api.example.com/v1", model: "acme/chat-1" };
// A scripted provider: records which config and key each call used.
const modelLlm = (out: any[]) => { const used: any[] = []; return { used, make: (cfg: any, key: string): Llm => ({ async chat(req) { used.push({ cfg, key, model: req.model }); const x = out.shift(); return x ?? { ok: false, code: "provider", error: "Provider error (HTTP 503)" }; } }) }; };
const okRes = (text: string) => ({ ok: true, text, prompt_tokens: 10, completion_tokens: 5 });

test("modelconfig: every action needs an active Management account", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  let ip = 0; // ten refusals from one IP trip the lockout, so each check gets its own
  for (const action of ["modelconfig.get", "modelconfig.save", "modelconfig.test"]) {
    for (const who of ["agent", "gone", null, "nobody"]) {
      const r = await call(deps, action, { ...CFG, api_key: KEY }, who, `10.43.0.${++ip}`);
      assert.equal(r.status, 401, `${action} as ${who}`);
    }
  }
  assert.equal(deps.db.t.ai_model_configs.length, 0);
  assert.deepEqual(deps.db.vault, {});
});

test("modelconfig: save validates input and refuses private targets", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "modelconfig.save", CFG)).status, 422, "first save needs a key");
  assert.equal((await call(deps, "modelconfig.save", { ...CFG, base_url: "http://api.example.com/v1", api_key: KEY })).status, 422);
  assert.equal((await call(deps, "modelconfig.save", { ...CFG, base_url: "https://169.254.169.254/latest", api_key: KEY })).status, 422);
  assert.equal((await call(deps, "modelconfig.save", { ...CFG, model: "bad model", api_key: KEY })).status, 422);
  assert.equal((await call(deps, "modelconfig.save", { ...CFG, api_key: "short" })).status, 422);
  assert.equal(deps.db.t.ai_model_configs.length, 0);
});

test("modelconfig: the key is stored only through the vault RPC and never returned, listed or audited", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  const s = await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  assert.equal(s.status, 200);
  assert.equal(deps.db.vault.playground, KEY);
  assert.equal(s.body.data.config.key.masked, "••••9876");
  const g = await call(deps, "modelconfig.get");
  for (const out of [s.body, g.body, deps.db.t.ai_model_configs, deps.db.t.ai_trainer_audit]) {
    assert.ok(!JSON.stringify(out).includes("TOPSECRET"), "key leaked");
  }
  // Rotation replaces the key; saving without a key keeps it.
  await call(deps, "modelconfig.save", { ...CFG, api_key: "sk-new-ROTATED-5555" });
  assert.equal(deps.db.vault.playground, "sk-new-ROTATED-5555");
  await call(deps, "modelconfig.save", { ...CFG, model: "acme/chat-2" });
  assert.equal(deps.db.vault.playground, "sk-new-ROTATED-5555");
  assert.equal((await call(deps, "modelconfig.get")).body.data.config.key.masked, "••••5555");
});

test("modelconfig.test: reports success only when the provider answered, and safe failures otherwise", async () => {
  const m = modelLlm([okRes("OK"), { ok: false, code: "auth", error: "Provider rejected the API key (HTTP 401)" },
    { ok: false, code: "rate_limited", error: "Provider rate limit reached (HTTP 429)" }, { ok: false, code: "timeout", error: "Provider did not answer within 30s" }]);
  const deps = { db: memDb(), llm: llm(), env: ENV, modelLlm: m.make };
  assert.equal((await call(deps, "modelconfig.test")).status, 422, "nothing saved yet");
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  const a = await call(deps, "modelconfig.test");
  assert.equal(a.body.data.ok, true);
  assert.deepEqual(m.used[0], { cfg: { provider: "custom", base_url: CFG.base_url, model: CFG.model }, key: KEY, model: CFG.model });
  for (const code of ["auth", "rate_limited", "timeout"]) {
    const r = await call(deps, "modelconfig.test");
    assert.equal(r.status, 200); assert.equal(r.body.data.ok, false); assert.equal(r.body.data.code, code);
  }
  assert.equal(deps.db.t.ai_model_configs[0].last_test.code, "timeout");
  assert.ok(!JSON.stringify([deps.db.t.ai_model_configs, deps.db.t.ai_trainer_audit]).includes("TOPSECRET"));
  assert.equal(deps.db.t.wa_messages.length, 0, "a connection test sends nothing on WhatsApp");
});

test("modelconfig.test: a reasoning model that stops on the token limit passes, with a note", async () => {
  const m = modelLlm([{ ok: false, code: "length", error: "reply cut at max_tokens" }]);
  const deps = { db: memDb(), llm: llm(), env: ENV, modelLlm: m.make };
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  const d = (await call(deps, "modelconfig.test")).body.data;
  assert.equal(d.ok, true);
  assert.match(d.note, /reasoning/);
  assert.equal(d.code, undefined);
});

test("modelconfig: Playground turns use the saved config; without one they use the server default", async () => {
  const deps: any = { db: memDb(), llm: llm(REPLY("from server default")), env: ENV };
  const a = await turn(deps, { text: "price?", client_turn_id: "c-0001-mmmm" });
  assert.equal(a.body.data.turn.reply, "from server default");
  assert.equal(a.body.data.turn.trace.model_source, "server default");
  const m = modelLlm([okRes(REPLY("from configured model"))]);
  deps.modelLlm = m.make;
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  const b = await turn(deps, { text: "price?", client_turn_id: "c-0002-mmmm" });
  assert.equal(b.body.data.turn.reply, "from configured model");
  assert.equal(m.used[0].model, "acme/chat-1"); assert.equal(m.used[0].key, KEY);
  assert.equal(b.body.data.turn.trace.model, "acme/chat-1");
  assert.ok(!JSON.stringify(deps.db.t.ai_playground_turns).includes("TOPSECRET"));
});

test("modelconfig: a saved config with no usable key fails the turn instead of falling back to the server key", async () => {
  const deps: any = { db: memDb(), llm: llm(REPLY("server")), env: ENV, modelLlm: modelLlm([]).make };
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  delete deps.db.vault.playground;
  const r = await turn(deps, { text: "price?", client_turn_id: "c-0003-mmmm" });
  assert.equal(r.status, 422); assert.equal(r.body.error.code, "model_config");
  assert.equal(deps.llm.calls.length, 0, "server key not used");
});

test("modelconfig: Playground settings do not change live bots, pointers, snapshots, test runs or test numbers", async () => {
  const m = modelLlm([]);
  const deps: any = { db: memDb(), llm: llm(REPLY("live default")), env: ENV, modelLlm: m.make };
  deps.db.t.wa_bot_settings = [{ bot: "eyad", trainer_test_mode: false }];
  const pointers = JSON.stringify(deps.db.t.ai_bot_pointers);
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  assert.equal(JSON.stringify(deps.db.t.ai_bot_pointers), pointers, "pointers untouched");
  assert.deepEqual(deps.db.t.wa_bot_settings, [{ bot: "eyad", trainer_test_mode: false }], "test mode untouched");
  assert.equal(deps.db.t.ai_snapshots.length, 0, "no snapshot frozen or published");
  // The live test-number path and test runs build ports from the env model, not the Playground config.
  const { callModel } = (await import("./trainer-handler.ts"))._internals.portsFor(deps);
  await callModel({ model: ENV.replyModel, max_tokens: 5, system: "s", messages: [{ role: "user", content: "hi" }] });
  assert.equal(deps.llm.calls.at(-1).model, "m");
  assert.equal(m.used.length, 0, "configured provider not called by live paths");
});

test("modelconfig: a stored key is bound to its host and never sent to a different one", async () => {
  const m = modelLlm([okRes(REPLY("from new host"))]);
  const deps: any = { db: memDb(), llm: llm(), env: ENV, modelLlm: m.make };
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  // Same host, new path: the key is kept.
  assert.equal((await call(deps, "modelconfig.save", { ...CFG, base_url: "https://api.example.com/v2" })).status, 200);
  // Different host without a new key: refused, nothing changes.
  const r = await call(deps, "modelconfig.save", { ...CFG, base_url: "https://attacker.example.net/v1" });
  assert.equal(r.status, 422); assert.equal(r.body.error.code, "key_required");
  assert.equal(deps.db.t.ai_model_configs[0].base_url, "https://api.example.com/v2");
  // A row changed behind the handler's back is refused before any call.
  deps.db.t.ai_model_configs[0].base_url = "https://attacker.example.net/v1";
  const t1 = await turn(deps, { text: "price?", client_turn_id: "c-0004-mmmm" });
  assert.equal(t1.status, 422); assert.equal(m.used.length, 0, "key not sent to the other host");
  assert.equal((await call(deps, "modelconfig.test")).status, 422);
  // A new key for the new host binds to it.
  await call(deps, "modelconfig.save", { ...CFG, base_url: "https://attacker.example.net/v1", api_key: "sk-other-HOSTKEY-7777" });
  assert.equal(deps.db.t.ai_model_configs[0].key_host, "attacker.example.net");
  const t2 = await turn(deps, { text: "price?", client_turn_id: "c-0005-mmmm" });
  assert.equal(t2.status, 200); assert.equal(m.used[0].key, "sk-other-HOSTKEY-7777");
});

test("modelconfig: a key is refused when another save changed the host between the settings write and the key write", async () => {
  const m = modelLlm([]);
  const deps: any = { db: memDb(), llm: llm(), env: ENV, modelLlm: m.make };
  await call(deps, "modelconfig.save", { ...CFG, api_key: KEY });
  // Interleave: our settings patch lands, then a concurrent save moves the row to another host before our key RPC runs.
  const realPatch = deps.db.patch.bind(deps.db);
  deps.db.patch = async (table: string, f: string, patch: any) => {
    const r = await realPatch(table, f, patch);
    if (table === "ai_model_configs" && patch.base_url === "https://api.example.com/v3") await realPatch(table, f, { base_url: "https://attacker.example.net/v1" });
    return r;
  };
  const r = await call(deps, "modelconfig.save", { ...CFG, base_url: "https://api.example.com/v3", api_key: "sk-rotated-VICTIM-4242" });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, "conflict");
  assert.ok(!JSON.stringify(r.body).includes("VICTIM"), "key in the response");
  assert.equal(deps.db.vault.playground, KEY, "the rotated key was not stored");
  assert.equal(deps.db.t.ai_model_configs[0].key_host, "api.example.com", "binding still points at the original host");
  // The row now points at the other host with a key bound elsewhere: no call reaches it.
  const t1 = await turn(deps, { text: "price?", client_turn_id: "c-0006-mmmm" });
  assert.equal(t1.status, 422); assert.equal(m.used.length, 0);
  assert.ok(!JSON.stringify(deps.db.t.ai_trainer_audit).includes("VICTIM"));
});

test("modelconfig: the key RPC always receives the base URL the caller saved", async () => {
  const deps: any = { db: memDb(), llm: llm(), env: ENV };
  const seen: any[] = []; const realRpc = deps.db.rpc.bind(deps.db);
  deps.db.rpc = async (fn: string, a: any) => { if (fn === "ai_model_key_set") seen.push(a.p_expected_base_url); return realRpc(fn, a); };
  await call(deps, "modelconfig.save", { ...CFG, base_url: "https://API.Example.com/v1/", api_key: KEY });
  assert.deepEqual(seen, ["https://api.example.com/v1"]);
});

// ── Publish / rollback safeguards ───────────────────────────────────────────
const eyadPtr = (deps: any) => deps.db.t.ai_bot_pointers.find((x: any) => x.bot === "eyad");
const passRun = async (deps: any, snapId: string) => {
  const run = await call(deps, "runs.start", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "runs.step", { run_id: run.body.data.id });
};

test("publish and rollback refuse a non-Management account and leave the pointer and audit untouched", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  await passRun(deps, snapId);
  const audits = deps.db.t.ai_trainer_audit.length;
  assert.equal((await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" }, "agent", "9.9.9.1")).status, 401);
  assert.equal((await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "x" }, "gone", "9.9.9.1")).status, 401);
  assert.equal(eyadPtr(deps).mode, "legacy");
  assert.equal(deps.db.t.ai_trainer_audit.length, audits);
});

test("publish refuses a snapshot whose stored content no longer matches its checksum", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  await passRun(deps, snapId);
  deps.db.t.ai_snapshots[0].content = { ...deps.db.t.ai_snapshots[0].content, tampered: true };
  const r = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(r.status, 409); assert.ok(r.body.error.details.includes("snapshot checksum mismatch"));
  assert.equal(eyadPtr(deps).mode, "legacy");
});

test("rollback refuses a candidate or unknown snapshot", async () => {
  const { deps, snapId } = await setup([]);
  assert.equal((await call(deps, "rollback", { bot: "eyad", snapshot_id: snapId, reason: "x" })).status, 422);
  assert.equal((await call(deps, "rollback", { bot: "eyad", snapshot_id: "nope", reason: "x" })).status, 422);
  assert.equal(eyadPtr(deps).mode, "legacy");
});

test("publish and rollback each write one pointer audit row with before, after and actor", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  // memDb hands out live row objects; PostgREST returns copies.
  const sel = deps.db.select.bind(deps.db); deps.db.select = async (q: string) => structuredClone(await sel(q));
  await passRun(deps, snapId);
  await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "bad replies" });
  const rows = deps.db.t.ai_trainer_audit.filter((a: any) => a.entity === "pointer");
  assert.deepEqual(rows.map((a: any) => a.action), ["publish", "rollback"]);
  assert.equal(rows[0].before.mode, "legacy"); assert.equal(rows[0].after.snapshot_id, snapId);
  assert.equal(rows[1].before.snapshot_id, snapId); assert.equal(rows[1].reason, "bad replies");
  assert.ok(rows.every((a: any) => a.actor_claimed === "Asad"));
});

test("editing drafts after publish changes neither the published snapshot nor the pointer", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  await passRun(deps, snapId);
  await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  const frozen = JSON.stringify(deps.db.t.ai_snapshots[0].content);
  const item = deps.db.t.ai_trainer_items[0];
  assert.equal((await call(deps, "items.update", { ...item, body: { topic: "a", text: "changed" }, revision: item.revision })).status, 200);
  assert.equal(JSON.stringify(deps.db.t.ai_snapshots[0].content), frozen);
  assert.equal(eyadPtr(deps).snapshot_id, snapId);
  const v2 = await call(deps, "snapshot.freeze", {});
  assert.equal(v2.body.data.reused, false);
  // memDb applies no column defaults, so a new row has no status (the DB sets 'candidate').
  assert.notEqual(deps.db.t.ai_snapshots.find((s: any) => s.id === v2.body.data.id).status, "published");
  assert.equal(eyadPtr(deps).snapshot_id, snapId, "a new candidate does not move the pointer");
});

// Publish and rollback are one ai_pointer_set call (migration 0044): the
// snapshot status, pointer move and audit row commit or fail together.
test("publish does not move the pointer when its audit row cannot be written", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  await passRun(deps, snapId);
  const real = deps.db.rpc.bind(deps.db);
  // A failing audit insert inside the database rolls the whole call back.
  deps.db.rpc = async (fn: string, a: any) => fn === "ai_pointer_set" ? { ok: false, error: "audit insert failed" } : real(fn, a);
  const r = await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  assert.equal(r.status, 500);
  assert.equal(eyadPtr(deps).mode, "legacy", "pointer moved with no audit row");
  assert.equal(deps.db.t.ai_trainer_audit.filter((a: any) => a.entity === "pointer").length, 0);
});

test("publish refuses when the pointer moved since the caller loaded it", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS, OUT(), JPASS]);
  await passRun(deps, snapId);
  await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  await call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "c", text: "d" } });
  const v2 = (await call(deps, "snapshot.freeze", {})).body.data.id;
  await passRun(deps, v2);
  // A second manager's screen still shows eyad on legacy.
  const r = await call(deps, "publish", { snapshot_id: v2, bot: "eyad", expected_snapshot_id: null });
  assert.equal(r.status, 409);
  assert.equal(r.body.error?.code ?? r.body.code, "conflict");
  assert.equal(eyadPtr(deps).snapshot_id, snapId);
  assert.equal(deps.db.t.ai_trainer_audit.filter((a: any) => a.entity === "pointer").length, 1);
  assert.equal((await call(deps, "publish", { snapshot_id: v2, bot: "eyad", expected_snapshot_id: snapId })).status, 200);
});

test("rollback checks expected_snapshot_id only when the key is sent", async () => {
  const { deps, snapId } = await setup([OUT(), JPASS]);
  await passRun(deps, snapId);
  await call(deps, "publish", { snapshot_id: snapId, bot: "eyad" });
  const stale = await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "x", expected_snapshot_id: null });
  assert.equal(stale.status, 409);
  assert.equal(eyadPtr(deps).snapshot_id, snapId);
  assert.equal((await call(deps, "rollback", { bot: "eyad", legacy: true, reason: "x", expected_snapshot_id: snapId })).status, 200);
  assert.equal(eyadPtr(deps).mode, "legacy");
});

test("runs.list returns run summaries only, newest first, and needs Management", async () => {
  const deps: any = { db: memDb(), llm: llm(), env: ENV };
  deps.db.t.ai_test_runs.push(
    { id: "r1", snapshot_id: "s1", bot: "eyad", status: "complete", counts: { PASS: 2 }, started_at: "2026-10-19T01:00", finished_at: "2026-10-19T01:05", test_ids: ["t1"], cost_usd: 0.01 },
    { id: "r2", snapshot_id: "s1", bot: "dubai", status: "running", counts: {}, started_at: "2026-10-19T02:00", finished_at: null, test_ids: ["t1"], cost_usd: 0 });
  const r = await call(deps, "runs.list", {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map((x: any) => x.id), ["r2", "r1"]);
  assert.deepEqual(Object.keys(r.body.data[0]).sort(), ["bot", "counts", "finished_at", "id", "snapshot_id", "started_at", "status"]);
  assert.equal((await call(deps, "runs.list", {}, "agent", "10.44.0.1")).status, 401);
});

test("bots.set_replies: Management only, one bot's column, audited, nothing else touched", async () => {
  const deps: any = { db: memDb(), llm: llm(), env: ENV };
  deps.db.t.wa_bot_settings = [{ bot: "eyad", faq_agent_enabled: false, takeover_enabled: true, trainer_test_mode: false }, { bot: "dubai", faq_agent_enabled: false, takeover_enabled: true, trainer_test_mode: false }];
  const pointers = JSON.stringify(deps.db.t.ai_bot_pointers);
  assert.equal((await call(deps, "bots.set_replies", { bot: "dubai", enabled: true }, "agent", "10.45.0.1")).status, 401);
  assert.equal(deps.db.t.wa_bot_settings[1].faq_agent_enabled, false, "refused call changed nothing");
  assert.equal((await call(deps, "bots.set_replies", { bot: "all", enabled: true })).status, 422);
  assert.equal((await call(deps, "bots.set_replies", { bot: "dubai", enabled: "yes" })).status, 422);
  const r = await call(deps, "bots.set_replies", { bot: "dubai", enabled: true });
  assert.equal(r.status, 200); assert.deepEqual(r.body.data, { bot: "dubai", faq_agent_enabled: true });
  assert.deepEqual(deps.db.t.wa_bot_settings, [
    { bot: "eyad", faq_agent_enabled: false, takeover_enabled: true, trainer_test_mode: false },
    { bot: "dubai", faq_agent_enabled: true, takeover_enabled: true, trainer_test_mode: false }]);
  const a = deps.db.t.ai_trainer_audit.at(-1);
  assert.equal(a.entity, "bot_replies"); assert.equal(a.entity_id, "dubai"); assert.equal(a.action, "enable");
  // memDb returns the live row object (no select=, no copy), so `before` is not checked here.
  assert.deepEqual(a.after, { faq_agent_enabled: true }); assert.equal(a.actor_claimed, "Asad");
  assert.equal(JSON.stringify(deps.db.t.ai_bot_pointers), pointers, "pointers untouched");
  deps.db.t.wa_bot_settings = [];
  assert.equal((await call(deps, "bots.set_replies", { bot: "eyad", enabled: true })).status, 404);
});

// ── System Prompt (migration 0046) ─────────────────────────────────────────
const SP_REPLY = (reply: string) => JSON.stringify({ intent: "info", project_ref: null, language: "en", reply, media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
const spDeps = (...texts: string[]) => {
  const deps: any = { db: memDb(), llm: llm(...texts), env: ENV };
  deps.db.t.ai_system_prompts = []; deps.db.t.ai_system_prompt_pointers = [{ bot: "eyad", company_id: "c1", prompt_id: null }, { bot: "dubai", company_id: "c1", prompt_id: null }];
  return deps;
};

test("prompt: drafts save as new versions, publish moves the pointer, the draft never reaches published", async () => {
  const deps = spDeps();
  assert.equal((await call(deps, "prompt.save_draft", { bot: "eyad", body: "" })).status, 422);
  assert.equal((await call(deps, "prompt.save_draft", { bot: "all", body: "x" })).status, 422);
  assert.equal((await call(deps, "prompt.save_draft", { bot: "eyad", body: "x".repeat(12001) })).status, 422);
  const d1 = await call(deps, "prompt.save_draft", { bot: "eyad", body: "You are Eyad v1." });
  assert.equal(d1.status, 200); assert.equal(d1.body.data.version_no, 1); assert.equal(d1.body.data.status, "draft");
  const d2 = await call(deps, "prompt.save_draft", { bot: "eyad", body: "You are Eyad v2." });
  assert.equal(d2.body.data.version_no, 2);
  let g = (await call(deps, "prompt.get", { bot: "eyad" })).body.data;
  assert.equal(g.draft.body, "You are Eyad v2."); assert.equal(g.published, null, "nothing published yet");
  assert.equal((await call(deps, "prompt.publish", { bot: "eyad", draft_id: d1.body.data.id })).status, 409, "only the newest draft can be published");
  const p = await call(deps, "prompt.publish", { bot: "eyad", draft_id: d2.body.data.id });
  assert.equal(p.status, 200); assert.equal(p.body.data.version_no, 3);
  await call(deps, "prompt.save_draft", { bot: "eyad", body: "You are Eyad v4 unsaved idea." });
  g = (await call(deps, "prompt.get", { bot: "eyad" })).body.data;
  assert.equal(g.published.body, "You are Eyad v2.", "a newer draft does not change published");
  assert.equal(g.draft.body, "You are Eyad v4 unsaved idea.");
  assert.equal(deps.db.t.ai_system_prompt_pointers.find((x: any) => x.bot === "dubai").prompt_id, null, "dubai untouched");
  assert.ok(deps.db.t.ai_trainer_audit.some((a: any) => a.entity === "system_prompt" && a.action === "publish"));
});

test("prompt: rollback restores an earlier published version and needs a reason", async () => {
  const deps = spDeps();
  const a = (await call(deps, "prompt.save_draft", { bot: "dubai", body: "Dubai A" })).body.data;
  const pa = (await call(deps, "prompt.publish", { bot: "dubai", draft_id: a.id })).body.data;
  const b = (await call(deps, "prompt.save_draft", { bot: "dubai", body: "Dubai B" })).body.data;
  await call(deps, "prompt.publish", { bot: "dubai", draft_id: b.id });
  assert.equal((await call(deps, "prompt.get", { bot: "dubai" })).body.data.published.body, "Dubai B");
  assert.equal((await call(deps, "prompt.rollback", { bot: "dubai", prompt_id: pa.id })).status, 422, "reason required");
  assert.equal((await call(deps, "prompt.rollback", { bot: "dubai", prompt_id: a.id, reason: "x" })).status, 422, "a draft is not a rollback target");
  assert.equal((await call(deps, "prompt.rollback", { bot: "eyad", prompt_id: pa.id, reason: "x" })).status, 422, "another bot's version is refused");
  assert.equal((await call(deps, "prompt.rollback", { bot: "dubai", prompt_id: pa.id, reason: "B was too pushy" })).status, 200);
  assert.equal((await call(deps, "prompt.get", { bot: "dubai" })).body.data.published.body, "Dubai A");
  const h = (await call(deps, "prompt.history", { bot: "dubai" })).body.data;
  assert.deepEqual(h.map((x: any) => [x.version_no, x.status]), [[4, "published"], [3, "draft"], [2, "published"], [1, "draft"]]);
  assert.ok(h.every((x: any) => typeof x.body === "string"));
});

test("prompt: Playground uses the published prompt by default and the draft only when asked; bot B never sees bot A's", async () => {
  const deps = spDeps(SP_REPLY("a"), SP_REPLY("b"), SP_REPLY("c"), SP_REPLY("d"));
  const d = (await call(deps, "prompt.save_draft", { bot: "eyad", body: "PUBLISHED-EYAD-RULE" })).body.data;
  await call(deps, "prompt.publish", { bot: "eyad", draft_id: d.id });
  await call(deps, "prompt.save_draft", { bot: "eyad", body: "DRAFT-EYAD-RULE" });
  const t1 = await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text: "hello there, price?", client_turn_id: "c-0001-pppp", setup: {} });
  assert.equal(t1.status, 200);
  assert.ok(deps.llm.calls[0].system.includes("PUBLISHED-EYAD-RULE") && !deps.llm.calls[0].system.includes("DRAFT-EYAD-RULE"));
  assert.equal(t1.body.data.turn.trace.system_prompt.version_no, 2);
  const t2 = await call(deps, "playground.turn", { bot: "eyad", source: "drafts", prompt: "draft", text: "hello there, price?", client_turn_id: "c-0002-pppp", setup: {} });
  assert.ok(deps.llm.calls[1].system.includes("DRAFT-EYAD-RULE"));
  assert.equal(t2.body.data.turn.trace.system_prompt.version_no, 3);
  await call(deps, "playground.turn", { bot: "dubai", source: "drafts", text: "hello there, price?", client_turn_id: "c-0003-pppp", setup: {} });
  assert.ok(!deps.llm.calls[2].system.includes("EYAD-RULE"), "dubai got eyad's prompt");
  assert.ok(!JSON.stringify(deps.db.t.ai_playground_turns).includes("PUBLISHED-EYAD-RULE"), "prompt text not stored in turn traces");
});

test("prompt: test runs a draft in a one-off turn without saving a conversation", async () => {
  const deps = spDeps(SP_REPLY("Assalamu Alaikum, ami Eyad."));
  const r = await call(deps, "prompt.test", { bot: "eyad", body: "You are Eyad. Greet in Banglish.", text: "price koto?" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.reply, "Assalamu Alaikum, ami Eyad.");
  assert.ok(deps.llm.calls[0].system.includes("You are Eyad. Greet in Banglish."));
  assert.equal(deps.db.t.ai_system_prompts.length, 0, "test does not save a version");
  assert.equal(deps.db.t.ai_playground_conversations.length, 0, "test does not create a conversation");
  assert.equal((await call(deps, "prompt.test", { bot: "eyad", body: "x", text: "" })).status, 422);
});

test("prompt: every action needs Management", async () => {
  const deps = spDeps();
  let ip = 0;
  for (const a of ["prompt.get", "prompt.save_draft", "prompt.publish", "prompt.rollback", "prompt.history", "prompt.test"]) {
    assert.equal((await call(deps, a, { bot: "eyad", body: "x", text: "y" }, "agent", `10.46.0.${++ip}`)).status, 401, a);
  }
  assert.equal(deps.db.t.ai_system_prompts.length, 0);
});

test("prompt: a snapshot pins each bot's published System Prompt; a later prompt change gives a new snapshot", async () => {
  const deps = spDeps();
  const d = (await call(deps, "prompt.save_draft", { bot: "eyad", body: "PINNED-V1" })).body.data;
  await call(deps, "prompt.publish", { bot: "eyad", draft_id: d.id });
  const s1 = (await call(deps, "snapshot.freeze")).body.data;
  const snap = deps.db.t.ai_snapshots.find((x: any) => x.id === s1.id);
  assert.equal(snap.content.system_prompts.eyad.body, "PINNED-V1");
  assert.equal(snap.content.system_prompts.dubai, undefined);
  const d2 = (await call(deps, "prompt.save_draft", { bot: "eyad", body: "PINNED-V2" })).body.data;
  assert.equal((await call(deps, "snapshot.freeze")).body.data.reused, true, "an unpublished draft does not change the snapshot");
  await call(deps, "prompt.publish", { bot: "eyad", draft_id: d2.id });
  const s2 = (await call(deps, "snapshot.freeze")).body.data;
  assert.equal(s2.reused, false); assert.notEqual(s2.id, s1.id);
});

// ── vector index (task 5) ───────────────────────────────────────────────────
test("index.build embeds active facts; freeze uses vector only when the index is complete, and says why not", async () => {
  const deps: any = { db: memDb(), llm: llm(), env: { ...ENV, embeddingModel: "emb-1", embeddingDim: 3 } };
  deps.db.t.ai_trainer_chunks = [];
  let fail = true;
  deps.embedder = async (_m: string, text: string) => (fail && text.includes("parking") ? { ok: false, error: "provider 503" } : { ok: true, vector: [1, 0, 0], tokens: 2 });
  const save = (text: string) => call(deps, "items.create", { kind: "fact", bots: ["eyad"], project_ref: null, body: { topic: "t", text } });
  await save("Alpha has a pool."); await save("Alpha has parking.");
  const r1 = await call(deps, "index.build");
  assert.equal(r1.status, 200); assert.equal(r1.body.data.ok, false); assert.equal(r1.body.data.failed.length, 1);
  const s1 = (await call(deps, "snapshot.freeze")).body.data;
  const snap1 = deps.db.t.ai_snapshots.find((x: any) => x.id === s1.id);
  assert.equal(snap1.content.retrieval.mode, "full", "an incomplete index never freezes a vector snapshot");
  assert.deepEqual(s1.retrieval, { mode: "full", reason: "index incomplete", missing: 1 });
  fail = false;
  const r2 = await call(deps, "index.build");
  assert.equal(r2.body.data.ok, true); assert.equal(r2.body.data.reused, 1); assert.equal(r2.body.data.created, 1);
  const s2 = (await call(deps, "snapshot.freeze")).body.data;
  const snap2 = deps.db.t.ai_snapshots.find((x: any) => x.id === s2.id);
  assert.equal(snap2.content.retrieval.mode, "vector"); assert.equal(snap2.content.retrieval.chunk_ids.length, 2);
  assert.equal((await call(deps, "index.build", {}, "agent", "10.47.0.1")).status, 401);
});

test("without an embedding model configured, freeze stays on full and index.build says so", async () => {
  const deps: any = { db: memDb(), llm: llm(), env: ENV };
  const r = await call(deps, "index.build");
  assert.equal(r.status, 422); assert.equal(r.body.error.code, "no_embedder");
  const s = (await call(deps, "snapshot.freeze")).body.data;
  assert.deepEqual(s.retrieval, { mode: "full", reason: "no embedding model configured" });
});

// ── Embedding model config and Markdown documents (migration 0047) ─────────
const EMB = { provider: "openai", base_url: "https://api.openai.com/v1", model: "text-embedding-3-small", embedding_dim: 3 };
const embDeps = (embed?: (cfg: any, key: string, text: string) => any) => {
  const deps: any = { db: memDb(), llm: llm(), env: { ...ENV, companyId: "c1" } };
  deps.db.t.ai_trainer_documents = []; deps.db.t.ai_trainer_chunks = [];
  const calls: any[] = [];
  deps.embedWith = (cfg: any, key: string) => async (text: string) => { calls.push({ cfg, key, text }); return embed ? embed(cfg, key, text) : { ok: true, vector: [1, 0, 0], tokens: 2 }; };
  return { deps, calls };
};
const MDDOC = "# Wecon Nuznan\n## Location\nSector 16, Jolshiri Abashon.\n## Sizes\n| Type | Size |\n| --- | --- |\n| B | 1,850 sqft |";

test("embedding config: saved separately from the chat model, key never returned, dimension required", async () => {
  const { deps } = embDeps();
  await call(deps, "modelconfig.save", { provider: "custom", base_url: "https://api.example.com/v1", model: "chat-1", api_key: "sk-chat-KEY-0001" });
  assert.equal((await call(deps, "embedconfig.save", { ...EMB, embedding_dim: undefined, api_key: "sk-emb-KEY-0002" })).status, 422);
  const s = await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  assert.equal(s.status, 200);
  assert.equal(deps.db.vault.embedding, "sk-emb-KEY-0002"); assert.equal(deps.db.vault.playground, "sk-chat-KEY-0001", "chat key untouched");
  const g = (await call(deps, "embedconfig.get")).body.data;
  assert.deepEqual([g.config.provider, g.config.model, g.config.embedding_dim, g.config.key.masked], ["openai", "text-embedding-3-small", 3, "••••0002"]);
  assert.ok(!JSON.stringify([s.body, g, deps.db.t.ai_trainer_audit]).includes("sk-emb-KEY"));
  assert.equal((await call(deps, "modelconfig.get")).body.data.config.model, "chat-1", "chat config intact");
});

test("embedding config: the chat key is reused only for the same provider and host, never across hosts", async () => {
  const { deps } = embDeps();
  await call(deps, "modelconfig.save", { provider: "openrouter", base_url: "", model: "anthropic/claude-haiku-5.5", api_key: "sk-or-CHAT-0009" });
  assert.equal((await call(deps, "embedconfig.save", { ...EMB })).body.error.code, "key_required", "different host: chat key not reused");
  const r = await call(deps, "embedconfig.save", { provider: "openrouter", base_url: "", model: "openai/text-embedding-3-small", embedding_dim: 3, reuse_chat_key: true });
  assert.equal(r.status, 200); assert.equal(deps.db.vault.embedding, "sk-or-CHAT-0009");
});

test("embedconfig.test makes a real embedding request and reports dimension mismatches and provider errors", async () => {
  let mode = "ok";
  const { deps, calls } = embDeps(() => mode === "ok" ? { ok: true, vector: [0.1, 0.2, 0.3], tokens: 2 } : mode === "dim" ? { ok: true, vector: [1, 2], tokens: 2 } : { ok: false, error: "auth: Provider rejected the API key (HTTP 401)" });
  assert.equal((await call(deps, "embedconfig.test")).status, 422, "nothing saved");
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const a = (await call(deps, "embedconfig.test")).body.data;
  assert.equal(a.ok, true); assert.equal(a.dimensions, 3); assert.equal(calls[0].key, "sk-emb-KEY-0002");
  mode = "dim"; const b = (await call(deps, "embedconfig.test")).body.data;
  assert.equal(b.ok, false); assert.match(b.error, /2 dimensions.*expect 3/);
  mode = "err"; const c = (await call(deps, "embedconfig.test")).body.data;
  assert.equal(c.ok, false); assert.match(c.error, /401/);
  assert.ok(!JSON.stringify(deps.db.t.ai_model_configs).includes("sk-emb"));
});

test("documents: draft, review, index with the saved model; an edit needs re-review and re-index", async () => {
  const { deps, calls } = embDeps();
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const d = (await call(deps, "docs.save", { title: "Nuznan fact sheet", format: "markdown", body: MDDOC, bots: ["eyad"] })).body.data;
  assert.equal(d.status, "draft"); assert.equal(d.version, 1);
  assert.equal((await call(deps, "docs.index", { id: d.id })).status, 409, "a draft is not indexed");
  await call(deps, "docs.review", { id: d.id, version: 1 });
  const ix = (await call(deps, "docs.index", { id: d.id })).body.data;
  // The top heading has no text of its own, so Location and Sizes are the 2 chunks.
  assert.equal(ix.status, "indexed"); assert.equal(ix.chunks, 2); assert.equal(ix.index_model, "text-embedding-3-small"); assert.equal(ix.index_dim, 3);
  assert.ok(deps.db.t.ai_trainer_chunks.every((c: any) => c.company_id === "c1" && c.document_version === 1 && c.embedding_model === "text-embedding-3-small"));
  assert.ok(deps.db.t.ai_trainer_chunks.some((c: any) => c.section === "Wecon Nuznan > Sizes"));
  assert.ok(calls.every((c) => c.key === "sk-emb-KEY-0002" && c.cfg.model === "text-embedding-3-small"));
  const e = (await call(deps, "docs.save", { id: d.id, title: "Nuznan fact sheet", format: "markdown", body: MDDOC + "\n## Handover\nDecember 2027.", bots: ["eyad"] })).body.data;
  assert.equal(e.version, 2); assert.equal(e.status, "draft", "an edit returns to draft for review");
  assert.equal((await call(deps, "docs.index", { id: d.id })).status, 409);
});

test("documents: a failed embedding marks the document failed with the reason; nothing half-indexed answers", async () => {
  const { deps } = embDeps((_c, _k, text) => text.includes("Sizes") ? { ok: false, error: "rate_limited: Provider rate limit reached (HTTP 429)" } : { ok: true, vector: [1, 0, 0], tokens: 1 });
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const d = (await call(deps, "docs.save", { title: "T", format: "markdown", body: MDDOC, bots: ["eyad"] })).body.data;
  await call(deps, "docs.review", { id: d.id, version: 1 });
  const r = (await call(deps, "docs.index", { id: d.id })).body.data;
  assert.equal(r.status, "failed"); assert.match(r.index_error, /429/);
  assert.equal(deps.db.t.ai_trainer_documents[0].indexed_version ?? null, null);
});

test("an embedding model change marks indexed documents needs_reindex and keeps the old model out of retrieval", async () => {
  const { deps } = embDeps();
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const d = (await call(deps, "docs.save", { title: "T", format: "markdown", body: MDDOC, bots: ["eyad"] })).body.data;
  await call(deps, "docs.review", { id: d.id, version: 1 }); await call(deps, "docs.index", { id: d.id });
  const r = (await call(deps, "embedconfig.save", { ...EMB, model: "text-embedding-3-large", embedding_dim: 4 })).body.data;
  assert.deepEqual(r.reindex, { documents: 1 });
  assert.equal(deps.db.t.ai_trainer_documents[0].status, "needs_reindex");
  const plan = (await call(deps, "docs.list")).body.data;
  assert.equal(plan.needs_reindex, 1);
});

test("publish is refused while any reviewed document is not indexed for the current model", async () => {
  const { deps } = embDeps();
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const d = (await call(deps, "docs.save", { title: "T", format: "markdown", body: MDDOC, bots: ["eyad"] })).body.data;
  await call(deps, "docs.review", { id: d.id, version: 1 });
  const gate = (await call(deps, "docs.list")).body.data;
  assert.equal(gate.publish_ready, false); assert.match(gate.blockers[0], /T.*not indexed/);
  const p = await call(deps, "publish", { bot: "eyad", snapshot_id: "nope" });
  assert.equal(p.status, 409); assert.equal(p.body.error.code, "documents_not_indexed");
  await call(deps, "docs.index", { id: d.id });
  assert.equal((await call(deps, "docs.list")).body.data.publish_ready, true);
});

test("Playground turns search indexed documents with the saved embedding model, scoped to the company", async () => {
  const { deps } = embDeps();
  deps.llm = llm(JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Type B is 1,850 sqft.", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false }));
  deps.db.rpc = ((orig) => async (fn: string, a: any) => {
    if (fn === "ai_match_doc_chunks") {
      return { ok: true, data: deps.db.t.ai_trainer_chunks.filter((c: any) => c.company_id === a.p_company && c.embedding_model === a.p_model)
        .map((c: any) => ({ id: c.id, document_id: c.document_id, document_version: c.document_version, chunk_no: c.chunk_no, section: c.section, chunk_text: c.chunk_text, title: "Nuznan fact sheet", score: 0.9 })) };
    }
    return orig(fn, a);
  })(deps.db.rpc.bind(deps.db));
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const d = (await call(deps, "docs.save", { title: "Nuznan fact sheet", format: "markdown", body: MDDOC, bots: ["eyad"] })).body.data;
  await call(deps, "docs.review", { id: d.id, version: 1 }); await call(deps, "docs.index", { id: d.id });
  const t = (await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text: "how big are the flats", client_turn_id: "c-0001-dddd", setup: {} })).body.data.turn;
  assert.equal(t.outcome, "ok"); assert.equal(t.reply, "Type B is 1,850 sqft.");
  assert.ok(Array.isArray(t.trace.documents) && t.trace.documents.some((x: any) => x.section === "Wecon Nuznan > Sizes"));
  assert.ok(deps.llm.calls[0].system.includes("[doc:"));
});

test("document actions need Management", async () => {
  const { deps } = embDeps();
  let ip = 0;
  for (const a of ["embedconfig.get", "embedconfig.save", "embedconfig.test", "docs.list", "docs.save", "docs.review", "docs.index"]) {
    assert.equal((await call(deps, a, {}, "agent", `10.48.0.${++ip}`)).status, 401, a);
  }
});

test("playground: a brochure ask checks the file, sends nothing, and stores what really happened", async () => {
  const db = memDb();
  db.t.ai_trainer_items.push(
    { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
      body: { name: "Wecon Nuznan", region: "Dhaka", aliases: { banglish: ["nuznan"] }, media: { brochure: "https://wecon.test/nuznan.pdf" } } },
    { id: "p-p2p", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
      body: { name: "P2P Helthcare", region: "Chattogram", aliases: { banglish: ["p2p"] }, media: { brochure: "https://drive.google.test/file/d/x" } } });
  const probed: string[] = [];
  const probe = async (u: string) => { probed.push(u); return u.includes("drive.google")
    ? { ok: true, status: 200, contentType: "text/html", magic: "<!DOC", bytes: 0 }
    : { ok: true, status: 206, contentType: "application/pdf", magic: "%PDF-", bytes: 9 }; };
  const model = llm();
  const r = await call({ db, llm: model, env: ENV, probe }, "playground.turn", { bot: "eyad", source: "drafts", text: "send all project brochures", client_turn_id: "brochure-turn-1" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(model.calls.length, 0, "no model call for a brochure ask");
  const turn = db.t.ai_playground_turns[0];
  assert.equal(turn.outcome, "brochure_partial");
  assert.deepEqual(turn.media.map((m: any) => m.project_ref), ["p-nuz"]);
  assert.deepEqual(turn.trace.brochure.failed.map((f: any) => [f.project, f.status]), [["P2P Helthcare", "not_pdf"]]);
  assert.doesNotMatch(turn.reply, /here is|\bsent\b|attached/i);
  assert.deepEqual(probed.sort(), ["https://drive.google.test/file/d/x", "https://wecon.test/nuznan.pdf"]);
});

test("brochures.check: one row per active project with city, file and status; Management only; sends nothing", async () => {
  const db = memDb();
  db.t.ai_trainer_items.push(
    { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
      body: { name: "Wecon Nuznan", region: "Dhaka", aliases: {}, media: { brochure: "https://wecon.test/nuznan.pdf" } } },
    { id: "p-mom", kind: "project", revision: 1, status: "active", bots: ["eyad"], project_ref: null,
      body: { name: "Momtaz Manor", region: "Chattogram", aliases: {}, media: {} } },
    { id: "p-old", kind: "project", revision: 2, status: "retired", bots: ["eyad"], project_ref: null,
      body: { name: "Old", region: "Dhaka", aliases: {}, media: { brochure: "https://wecon.test/old.pdf" } } });
  const probe = async () => ({ ok: true, status: 206, contentType: "application/pdf", magic: "%PDF-", bytes: 6122611 });
  assert.equal((await call({ db, llm: llm(), env: ENV, probe }, "brochures.check", {}, "agent")).status, 401);
  const r = await call({ db, llm: llm(), env: ENV, probe }, "brochures.check");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.rows.map((x: any) => [x.project, x.city, x.status, x.bytes ?? null]), [
    ["Momtaz Manor", "Chattogram", "missing", null], ["Wecon Nuznan", "Dhaka", "verified", 6122611]]);
  assert.deepEqual(r.body.data.counts, { total: 2, verified: 1, problems: 1 });
});

// ── P1/P3: project-scoped documents ─────────────────────────────────────────
const PROJ = (id: string, name: string, alias: string) => ({ id, kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null,
  body: { name, region: "Dhaka", aliases: { banglish: [alias] }, media: {} } });
const scopedDeps = () => {
  const { deps, calls } = embDeps();
  deps.db.t.ai_trainer_items.push(PROJ("p-nuz", "Wecon Nuznan", "nuznan"), PROJ("p-osm", "Wecon Osman Bellevue", "osman"));
  // Stand-in for ai_match_doc_chunks with the migration's project filter:
  // a chunk with a project answers only when that project is in scope.
  const seen: any[] = [];
  deps.db.rpc = ((orig) => async (fn: string, a: any) => {
    if (fn !== "ai_match_doc_chunks") return orig(fn, a);
    seen.push(a);
    return { ok: true, data: deps.db.t.ai_trainer_chunks.filter((c: any) => c.company_id === a.p_company && c.embedding_model === a.p_model
        && (c.project_ref === null || (a.p_projects || []).includes(c.project_ref)))
      .map((c: any) => ({ id: c.id, document_id: c.document_id, document_version: c.document_version, chunk_no: c.chunk_no, section: c.section, chunk_text: c.chunk_text,
        title: deps.db.t.ai_trainer_documents.find((d: any) => d.id === c.document_id).title, score: 0.9 })) };
  })(deps.db.rpc.bind(deps.db));
  return { deps, calls, seen };
};
const indexDoc = async (deps: any, doc: object) => {
  const d = (await call(deps, "docs.save", { format: "markdown", bots: ["eyad"], ...doc })).body.data;
  await call(deps, "docs.review", { id: d.id, version: d.version }); await call(deps, "docs.index", { id: d.id });
  return d;
};

test("docs: a project-tagged document's chunks carry the project, and another project's question never retrieves them", async () => {
  const { deps, seen } = scopedDeps();
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  await indexDoc(deps, { title: "Wecon Nuznan fact sheet", body: "# Wecon Nuznan\n## Sizes\nEach apartment is 2850 sqft.", project_ref: "p-nuz" });
  await indexDoc(deps, { title: "Wecon Osman Bellevue fact sheet", body: "# Wecon Osman Bellevue\n## Sizes\nEach apartment is 2850 sqft.", project_ref: "p-osm" });
  assert.deepEqual([...new Set(deps.db.t.ai_trainer_chunks.map((c: any) => c.project_ref))].sort(), ["p-nuz", "p-osm"]);
  deps.llm = llm(JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project?", media: [], handoff: false, asked: [], used_item_ids: [], clarify: true }));
  const t = (await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text: "osman er flat koto boro?", client_turn_id: "scope-osman-1", setup: {} })).body.data.turn;
  assert.deepEqual(seen.at(-1).p_projects, ["p-osm"]);
  assert.ok(t.trace.documents.length > 0);
  assert.ok(t.trace.documents.every((d: any) => d.title.startsWith("Wecon Osman")), JSON.stringify(t.trace.documents));
});

test("docs: a document named after one project but tagged with another is refused; an untagged project document is flagged", async () => {
  const { deps } = scopedDeps();
  const bad = await call(deps, "docs.save", { title: "Wecon Nuznan fact sheet", format: "markdown", bots: ["eyad"], body: "# Wecon Nuznan\nx", project_ref: "p-osm" });
  assert.equal(bad.status, 422);
  assert.match(bad.body.error.message, /Wecon Nuznan/);
  await call(deps, "docs.save", { title: "Wecon Osman Bellevue fact sheet", format: "markdown", bots: ["eyad"], body: "# Wecon Osman Bellevue\nx" });
  await call(deps, "docs.save", { title: "WECON sales offices", format: "markdown", bots: ["eyad"], body: "# Offices\n- Dhaka" });
  const audit = (await call(deps, "docs.list")).body.data.association;
  assert.deepEqual(audit.map((x: any) => [x.title, x.problem, x.suggested_project]), [["Wecon Osman Bellevue fact sheet", "untagged", "p-osm"]]);
});

test("docs: the same text saved twice is refused as a duplicate, so one source is not indexed twice", async () => {
  const { deps } = scopedDeps();
  const body = "# Wecon Nuznan\n## Sizes\nEach apartment is 2850 sqft.";
  assert.equal((await call(deps, "docs.save", { title: "Nuznan A", format: "markdown", bots: ["eyad"], body, project_ref: "p-nuz" })).status, 200);
  const dup = await call(deps, "docs.save", { title: "Nuznan B", format: "markdown", bots: ["eyad"], body: `${body}\n`, project_ref: "p-nuz" });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error.message, /Nuznan A/);
});

test("docs: replacing a document's project re-scopes it: the new version needs review and its chunks carry the new project", async () => {
  const { deps } = scopedDeps();
  await call(deps, "embedconfig.save", { ...EMB, api_key: "sk-emb-KEY-0002" });
  const d = await indexDoc(deps, { title: "Jolshiri brochure", body: "# Jolshiri\nShared amenities.", project_ref: null });
  const e = (await call(deps, "docs.save", { id: d.id, title: "Jolshiri brochure", format: "markdown", bots: ["eyad"], body: "# Jolshiri\nShared amenities.", project_ref: "p-nuz" })).body.data;
  assert.equal(e.version, 2); assert.equal(e.status, "draft");
  await call(deps, "docs.review", { id: d.id, version: 2 }); await call(deps, "docs.index", { id: d.id });
  assert.deepEqual(deps.db.t.ai_trainer_chunks.filter((c: any) => c.document_version === 2).map((c: any) => c.project_ref), ["p-nuz"]);
});

test("docs: source_name is kept, and the PDF text metadata (pages, skipped pages) round-trips", async () => {
  const { deps } = scopedDeps();
  const d = (await call(deps, "docs.save", { title: "Summer Breeze brochure", format: "pdf_text", bots: ["eyad"], body: "## Page 2\n9 storied building.",
    project_ref: null, source_name: "WECON-SM-Summer-Breeze-Brochure.pdf (29 pages, 5 without text)" })).body.data;
  assert.equal(d.source_name, "WECON-SM-Summer-Breeze-Brochure.pdf (29 pages, 5 without text)");
});

test("review: retagging a document whose text another document shares is allowed; only a new duplicate is refused", async () => {
  const { deps } = scopedDeps();
  const body = "# Jolshiri\nShared amenities for every Jolshiri project.";
  // Two copies that already exist (as legacy data can).
  deps.db.t.ai_trainer_documents.push(
    { id: "old-a", company_id: "c1", title: "Jolshiri A", format: "markdown", body, version: 1, status: "draft", bots: ["eyad"], project_ref: null },
    { id: "old-b", company_id: "c1", title: "Jolshiri B", format: "markdown", body, version: 1, status: "draft", bots: ["eyad"], project_ref: null });
  const retag = await call(deps, "docs.save", { id: "old-a", title: "Jolshiri A", format: "markdown", bots: ["eyad"], body, project_ref: "p-nuz" });
  assert.equal(retag.status, 200, JSON.stringify(retag.body));
  assert.equal((await call(deps, "docs.save", { title: "Jolshiri C", format: "markdown", bots: ["eyad"], body })).status, 409);
});

test("review: a title naming two projects (a comparison) is never refused as a mismatch", async () => {
  const { deps } = scopedDeps();
  const r = await call(deps, "docs.save", { title: "Osman vs Nuznan comparison", format: "markdown", bots: ["eyad"], body: "# Compare\nx", project_ref: "p-nuz" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("playground: a configured model that times out once is retried, and the turn answers", async () => {
  const deps: any = { db: memDb(), llm: llm(), env: ENV };
  let n = 0;
  deps.modelLlm = () => ({ async chat() { n++; return n === 1 ? { ok: false, code: "timeout", error: "Provider did not answer within 30s" }
    : { ok: true, text: JSON.stringify({ intent: "info", project_ref: null, language: "en", reply: "Which project?", media: [], handoff: false, asked: [], used_item_ids: [], clarify: true }), prompt_tokens: 1, completion_tokens: 1 }; } });
  await call(deps, "modelconfig.save", { provider: "openrouter", model: "deepseek/x", api_key: "sk-or-KEY-0001" });
  const t = (await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text: "tell me about your projects", client_turn_id: "retry-0001-aaaa", setup: {} })).body.data.turn;
  assert.equal(n, 2); assert.equal(t.outcome, "ok"); assert.match(t.trace.model_retry, /30s/);
});

import { docAssociation } from "./trainer-docs.ts";
test("review2: a short alias (P2P) still ties a document title to its project; generic words never do", () => {
  const ps = [{ id: "p-p2p", name: "P2P Helthcare", aliases: ["p2p"] }, { id: "p-sb", name: "Wecon Summer Breeze", aliases: ["summer breeze", "summer"] }];
  assert.deepEqual(docAssociation("p2p brochure", null, ps), { problem: "untagged", named: "P2P Helthcare", suggested_project: "p-p2p" });
  assert.deepEqual(docAssociation("Summer offers", null, ps), { problem: null });
});

// ── Playground conversation flow (2026-10-20, reproduced on the handler) ────
// The Osman resend regression: "abar pathan" after an Osman brochure went to
// the model and got "Which project?"; "na, nuznan er ta" lost the correction;
// "ok thanks" got a question back.
const pgFlow = () => {
  const db = memDb();
  db.t.ai_trainer_items.push(
    { id: "p-osm", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null, body: { name: "Wecon Osman Bellevue", region: "Dhaka", aliases: { banglish: ["osman"] }, media: { brochure: "https://wecon.test/osman.pdf" } } },
    { id: "p-nuz", kind: "project", revision: 1, status: "active", bots: ["eyad", "dubai"], project_ref: null, body: { name: "Wecon Nuznan", region: "Dhaka", aliases: { banglish: ["nuznan"] }, media: { brochure: "https://wecon.test/nuznan.pdf" } } });
  const model = llm();
  const deps = { db, llm: model, env: ENV, probe: async () => ({ ok: true, status: 206, contentType: "application/pdf", magic: "%PDF-", bytes: 9 }) };
  let conv: string | undefined;
  const say = async (text: string, id: string) => {
    const r = (await call(deps, "playground.turn", { bot: "eyad", source: "drafts", text, client_turn_id: id, conversation_id: conv, setup: {} })).body;
    assert.equal(r.ok, true, JSON.stringify(r)); conv = r.data.conversation_id; return r.data.turn;
  };
  return { db, model, say };
};

test("playground: 'abar pathan' right after a brochure resends the same project's checked PDF (Osman resend regression)", async () => {
  const f = pgFlow();
  await f.say("osman er brochure pathan", "flow-0001-aaaa");
  const t = await f.say("abar pathan", "flow-0002-aaaa");
  assert.equal(f.model.calls.length, 0, "no model call for a resend");
  assert.equal(t.outcome, "brochure_ready_not_sent");
  assert.deepEqual(t.media.map((m: any) => [m.kind, m.project_ref]), [["brochure", "p-osm"]]);
  for (const resend of ["send it again", "আবার পাঠান", "resend please"]) {
    const r = await f.say(resend, `flow-r-${resend.length}-${Math.random().toString(36).slice(2, 8)}`);
    assert.deepEqual(r.media.map((m: any) => m.project_ref), ["p-osm"], resend);
  }
});

test("playground: a correction ('na, nuznan er ta') switches the brochure to the named project, never the old one", async () => {
  const f = pgFlow();
  await f.say("osman er brochure pathan", "flow-0101-aaaa");
  const t = await f.say("na, nuznan er ta", "flow-0102-aaaa");
  assert.deepEqual(t.media.map((m: any) => m.project_ref), ["p-nuz"]);
  assert.equal(t.state_after.active_project, "p-nuz");
  assert.equal(f.model.calls.length, 0);
});

test("playground: 'ok thanks' after a brochure is acknowledged with no reply, no model call and no resend", async () => {
  const f = pgFlow();
  await f.say("osman er brochure pathan", "flow-0201-aaaa");
  for (const [i, ack] of ["ok thanks", "dhonnobad", "ধন্যবাদ", "got it"].entries()) {
    const t = await f.say(ack, `flow-021${i}-aaaa`);
    assert.equal(t.reply, null, ack); assert.deepEqual(t.media, [], ack);
    assert.equal(t.outcome, "skipped_acknowledgement", ack);
  }
  assert.equal(f.model.calls.length, 0);
});

test("playground: 'abar pathan' with no brochure earlier in the conversation is not guessed as a resend", async () => {
  const f = pgFlow();
  const t = await f.say("abar pathan", "flow-0301-aaaa");
  assert.deepEqual(t.media, []);
  assert.notEqual(t.outcome, "brochure_ready_not_sent");
});

test("playground: the brochure in play lasts one turn; after an unrelated question, 'abar pathan' is not a resend", async () => {
  const f = pgFlow();
  await f.say("osman er brochure pathan", "flow-0401-aaaa");
  const q = await f.say("where is osman?", "flow-0402-aaaa");
  assert.equal(q.state_after.last_brochure, undefined, "cleared by the non-brochure turn");
  const r = await f.say("abar pathan", "flow-0403-aaaa");
  assert.deepEqual(r.media, []);
});

test("playground: a resend re-checks the file; a file that broke since is reported, not resent", async () => {
  const f = pgFlow();
  await f.say("osman er brochure pathan", "flow-0501-aaaa");
  f.db.t.ai_trainer_items.find((x: any) => x.id === "p-osm").body.media.brochure = "http://wecon.test/osman.pdf";
  const r = await f.say("abar pathan", "flow-0502-aaaa");
  assert.deepEqual(r.media, []);
  assert.equal(r.outcome, "brochure_unavailable");
});

test("playground: history and state are per conversation; a second conversation starts clean", async () => {
  const f = pgFlow();
  await f.say("osman er brochure pathan", "flow-0601-aaaa");
  const other = pgFlow(); other.db.t = f.db.t;
  const t = (await call({ db: f.db, llm: f.model, env: ENV }, "playground.turn", { bot: "eyad", source: "drafts", text: "abar pathan", client_turn_id: "flow-0602-bbbb", setup: {} })).body.data;
  assert.notEqual(t.conversation_id, f.db.t.ai_playground_turns[0].conversation_id);
  assert.deepEqual(t.turn.media, [], "no resend from another conversation's brochure");
  assert.equal(t.turn.state_before, null);
});

test("playground: an earlier bot line saying a brochure was sent is not proof; 'did you send it?' cannot be answered 'yes, sent'", async () => {
  const f = pgFlow();
  // A legacy-style row whose reply claims a send, with no brochure in its state.
  await f.say("osman kothay?", "flow-0701-aaaa");
  f.db.t.ai_playground_turns[0].reply = "I have sent the Osman brochure.";
  f.model.calls.length = 0;
  const ans = JSON.stringify({ intent: "info", project_ref: "p-osm", language: "en", reply: "Yes, I have sent the brochure.", media: [], handoff: false, asked: [], used_item_ids: [], clarify: false });
  (f.model as any).chat = async (req: any) => { f.model.calls.push(req); return { ok: true, text: ans, prompt_tokens: 1, completion_tokens: 1 }; };
  const t = await f.say("did you send it?", "flow-0702-aaaa");
  assert.equal(t.outcome, "fallback_invalid_output", "the claim guard refuses a 'sent' reply");
  assert.doesNotMatch(t.reply || "", /have sent/i);
  assert.deepEqual(t.media, []);
});
