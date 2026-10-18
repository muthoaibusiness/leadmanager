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
const call = (deps: any, action: string, payload: any = {}, userId: any = "mgr", ip = "1.1.1.1") =>
  handleTrainer({ method: "POST", headers: new Headers(), ip, body: { action, payload, actor_claimed: "Asad", user_id: userId } }, deps);

test("rejects missing, unknown, non-Management or inactive users; accepts Management", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (const u of [null, "", "nobody", "agent", "gone"]) assert.equal((await call(deps, "items.list", {}, u)).status, 401, String(u));
  assert.equal((await call(deps, "items.list")).status, 200);
});

test("rate limits repeated failed sign-ins per ip", async () => {
  const deps = { db: memDb(), llm: llm(), env: ENV };
  for (let i = 0; i < 10; i++) await call(deps, "items.list", {}, "agent", "9.9.9.9");
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
