import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTrainer, type Db, type Llm } from "./trainer-handler.ts";

// In-memory stand-in for the ai_ tables. It implements just the PostgREST
// paths and RPCs the handler uses, including revision conflicts and the
// atomic budget rule, so handler logic is tested without a database.
function memDb() {
  const t: Record<string, any[]> = { ai_trainer_items: [], ai_tests: [], ai_test_revisions: [], ai_snapshots: [], ai_bot_pointers: [{ bot: "eyad", mode: "legacy", snapshot_id: null }, { bot: "dubai", mode: "legacy", snapshot_id: null }], ai_test_runs: [], ai_test_results: [], ai_trainer_audit: [], ai_trainer_imports: [], wa_projects: [], wa_knowledge: [], wa_message_corrections: [], ai_budget_days: [] };
  const budget = { reserved: 0, spent: 0 }; const resv: Record<string, number> = {};
  let n = 0; const id = () => `id${++n}`;
  const db: Db & { t: typeof t } = {
    t,
    async select(path) {
      const [table, q] = path.split("?");
      let rows = [...(t[table] || [])];
      for (const part of (q || "").split("&")) {
        const m = /^(\w+)=eq\.(.+)$/.exec(part);
        if (m) rows = rows.filter((r) => String(r[m[1]]) === decodeURIComponent(m[2]));
      }
      return rows;
    },
    async insert(table, row) { const r = { id: id(), ...row }; t[table].push(r); return r; },
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
      return { ok: false, error: "unknown rpc" };
    },
  };
  return db;
}

const llm = (...texts: string[]): Llm & { calls: any[] } => {
  const calls: any[] = [];
  return { calls, async chat(req) { calls.push(req); const x = texts.shift(); return x === undefined ? { ok: false, error: "down" } : { ok: true, text: x, prompt_tokens: 100, completion_tokens: 50 }; } };
};
const ENV = { trainerKey: "k".repeat(43), budgetUsd: 1, replyModel: "m", judgeModel: "j", pricePerMTok: { in: 1, out: 5 } };
// The failed-key counter is module state shared by every test in this file, so
// the rate-limit test uses its own IP and cannot lock the others out.
const call = (deps: any, action: string, payload: any = {}, key = ENV.trainerKey, ip = "1.1.1.1") =>
  handleTrainer({ method: "POST", headers: new Headers({ "x-trainer-key": key }), ip, body: { action, payload, actor_claimed: "Asad" } }, deps);

test("rejects missing or wrong key, accepts right key", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  assert.equal((await call(deps, "items.list", {}, "")).status, 401);
  assert.equal((await call(deps, "items.list", {}, "wrong")).status, 401);
  assert.equal((await call(deps, "items.list")).status, 200);
});

test("rate limits repeated bad keys per ip", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (let i = 0; i < 10; i++) await call(deps, "items.list", {}, "bad", "9.9.9.9");
  assert.equal((await call(deps, "items.list", {}, ENV.trainerKey, "9.9.9.9")).status, 429);
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
