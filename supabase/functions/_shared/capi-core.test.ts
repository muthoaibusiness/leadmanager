// node --test — the meta-capi request handler (capi-core.ts) with an in-memory
// database and a scripted Meta. No network, no real token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleCapi, classifyMeta, type CapiDeps } from "./capi-core.ts";

const DAY = 864e5;
const NOW = Date.parse("2026-10-29T11:00:00Z");
const TOKEN = "EAAtest-SECRET-TOKEN-value";

type Lead = { id: string; name: string; company_id: string; source: string; ctwa_clid: string | null; CAPI_STATUS: string | null; created_at: string; qualified?: boolean };
type Meta = { status: number; json: any; retryAfter?: number | null } | Error;
function world(leads: Lead[], meta: (body: any) => Meta = () => ({ status: 200, json: { events_received: 1, fbtrace_id: "fbt-1" } })) {
  const users = [
    { id: "mgr", role: "MANAGEMENT", is_active: true, allowed_features: null, company_id: "c1", name: "M" },
    { id: "master", role: "MASTER", is_active: true, allowed_features: null, company_id: null, name: "Ms" },
    { id: "agent", role: "AGENT", is_active: true, allowed_features: null, company_id: "c1", name: "A" },
    { id: "granted", role: "AGENT", is_active: true, allowed_features: ["metacapi"], company_id: "c1", name: "G" },
    { id: "revoked", role: "MANAGEMENT", is_active: true, allowed_features: ["leads"], company_id: "c1", name: "R" },
    { id: "gone", role: "MANAGEMENT", is_active: false, allowed_features: null, company_id: "c1", name: "X" },
  ];
  const attempts: any[] = []; const locks = new Map<string, number>(); const sent: any[] = []; const settings: any = { ui_recovery_paused: false };
  // The shared limiter (capi_acquire), in memory: a verdict can be forced per lead.
  const limiter: { verdict: Record<string, any>; throttles: (number | null)[]; acquired: string[] } = { verdict: {}, throttles: [], acquired: [] };
  const bots = [{ bot: "eyad", display_name: "Eyad Bot", meta_capi_enabled: true }, { bot: "dubai", display_name: "Dubai Bot", meta_capi_enabled: true }];
  const status = (l: Lead) => {
    const a = attempts.filter((x) => x.lead_id === l.id);
    const acc = a.some((x) => x.outcome === "accepted");
    const created = Date.parse(l.created_at);
    return l.CAPI_STATUS === "LeadSubmitted" || acc ? "success" : !l.ctwa_clid || l.qualified === false ? "ineligible" : created + 7 * DAY <= NOW ? "expired" : a.length ? "failed" : "pending";
  };
  const unsure = (id: string) => attempts.some((x) => x.lead_id === id && ["timeout", "network", "ambiguous"].includes(x.outcome));
  const deps: CapiDeps = {
    now: () => NOW,
    token: () => TOKEN,
    async user(id) { return users.find((u) => u.id === id) ?? null; },
    // The capi_lead_status columns the check reads (0051).
    async lead(id) {
      const l = leads.find((x) => x.id === id);
      return l ? { id: l.id, company_id: l.company_id, created_at: l.created_at, ctwa_clid: l.ctwa_clid, capi_status_column: l.CAPI_STATUS, qualified: l.qualified !== false, unsure: unsure(l.id) } : null;
    },
    async page(q) {
      let rs = leads.map((l) => ({ ...l, status: status(l), attempts: attempts.filter((x) => x.lead_id === l.id).length }));
      if (q.status && q.status !== "all") rs = rs.filter((r) => r.status === q.status);
      return { rows: rs.slice(q.offset, q.offset + q.limit), total: rs.length };
    },
    async summary() {
      const by: Record<string, number> = {};
      for (const l of leads) by[status(l)] = (by[status(l)] || 0) + 1;
      return { by_status: by, total: leads.length, attempts: attempts.length, accepted_attempts: attempts.filter((a) => a.outcome === "accepted").length,
        last_accepted_at: null, oldest_pending: null };
    },
    async history(id) { return attempts.filter((a) => a.lead_id === id); },
    async acquire(id) {
      if (limiter.verdict[id]) return limiter.verdict[id];
      if ((locks.get(id) ?? 0) > NOW) return { result: "locked" };
      locks.set(id, NOW + 120000); limiter.acquired.push(id); return { result: "ok" };
    },
    async unlock(id) { locks.delete(id); },
    async throttle(hint) { limiter.throttles.push(hint); return new Date(NOW + 60000).toISOString(); },
    async bots() { return bots.map((b) => ({ ...b })); },
    async setBot(bot, enabled) { const b = bots.find((x) => x.bot === bot); if (!b) return null; b.meta_capi_enabled = enabled; return { bot, meta_capi_enabled: enabled }; },
    async record(a) { attempts.push(a); if (a.outcome === "accepted") { const l = leads.find((x) => x.id === a.lead_id)!; l.CAPI_STATUS = "LeadSubmitted"; } return { attempt_no: attempts.filter((x) => x.lead_id === a.lead_id).length }; },
    async settings() { return settings; },
    async saveSettings(p) { Object.assign(settings, p); },
    async postMeta(body) { sent.push(body); const r = meta(body); if (r instanceof Error) throw r; return r; },
    allowUnverifiedActor: () => true,
  };
  return { deps, attempts, sent, locks, settings, limiter, bots };
}
const L = (id: string, o: Partial<Lead> = {}): Lead => ({ id, name: "Customer " + id, company_id: "c1", source: "WHATSAPP_ADS", ctwa_clid: "clid-" + id, CAPI_STATUS: null, created_at: new Date(NOW - DAY).toISOString(), ...o });
const call = (deps: CapiDeps, action: string, payload: any = {}, userId = "mgr") =>
  handleCapi(new Request("https://x/functions/v1/meta-capi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, payload, userId }) }), deps)
    .then(async (r) => ({ status: r.status, body: await r.json() }));

// ── access ──────────────────────────────────────────────────────────────────
test("only Management, Master or a 'metacapi' grant may use any action; the rest get 401/403 and nothing is read or sent", async () => {
  const w = world([L("a")]);
  for (const [who, code] of [["agent", 403], ["revoked", 403], ["gone", 401], ["nobody", 401], ["", 401]] as const) {
    for (const action of ["summary", "list", "history", "retry", "settings.set", "bots", "bot.set"]) {
      const r = await call(w.deps, action, { lead_ids: ["a"], id: "a" }, who);
      assert.equal(r.status, code, `${who} ${action}`);
    }
  }
  assert.equal(w.sent.length, 0); assert.equal(w.attempts.length, 0);
  assert.equal((await call(w.deps, "summary", {}, "granted")).status, 200, "an explicit grant opens it");
  assert.equal((await call(w.deps, "summary", {}, "master")).status, 200);
});

test("no response ever contains the token", async () => {
  const w = world([L("a")], () => ({ status: 400, json: { error: { message: `bad token ${TOKEN}`, code: 190 } } }));
  const outs = [await call(w.deps, "summary"), await call(w.deps, "config"), await call(w.deps, "retry", { lead_ids: ["a"], confirm: true }),
    await call(w.deps, "history", { id: "a" })];
  for (const o of outs) assert.ok(!JSON.stringify(o).includes(TOKEN), JSON.stringify(o).slice(0, 200));
  assert.ok(!JSON.stringify(w.attempts).includes(TOKEN), "not stored either");
});

test("config reports only whether a token is configured", async () => {
  const w = world([]);
  const r = await call(w.deps, "config");
  assert.deepEqual(r.body.data.token, { configured: true });
  w.deps.token = () => "";
  assert.deepEqual((await call(w.deps, "config")).body.data.token, { configured: false });
});

// ── list / summary ──────────────────────────────────────────────────────────
test("list pages server-side and filters by status", async () => {
  const leads = Array.from({ length: 30 }, (_, i) => L("p" + i));
  leads.push(L("s1", { CAPI_STATUS: "LeadSubmitted" }), L("x1", { created_at: new Date(NOW - 8 * DAY).toISOString() }), L("n1", { ctwa_clid: null }));
  const w = world(leads);
  const p = await call(w.deps, "list", { status: "pending", limit: 10, offset: 10 });
  assert.equal(p.body.data.total, 30); assert.equal(p.body.data.rows.length, 10);
  assert.equal((await call(w.deps, "list", { status: "success" })).body.data.total, 1);
  assert.equal((await call(w.deps, "list", { status: "expired" })).body.data.total, 1);
  assert.equal((await call(w.deps, "list", { status: "ineligible" })).body.data.total, 1);
  assert.equal((await call(w.deps, "list", { limit: 5000 })).body.data.rows.length <= 200, true, "page size is capped");
  assert.equal((await call(w.deps, "list", { status: "bogus" })).status, 422);
});

// ── retry ───────────────────────────────────────────────────────────────────
test("retry needs explicit confirmation; without it nothing is sent and the preview is returned", async () => {
  const w = world([L("a"), L("b", { CAPI_STATUS: "LeadSubmitted" }), L("c", { created_at: new Date(NOW - 8 * DAY).toISOString() })]);
  const r = await call(w.deps, "retry", { lead_ids: ["a", "b", "c"] });
  assert.equal(r.status, 200);
  assert.equal(w.sent.length, 0);
  assert.deepEqual(r.body.data.preview, { selected: 3, eligible: 1, already_reported: 1, expired: 1, ineligible: 0, unsure: 0, locked: 0 });
  assert.equal(r.body.data.sent, false);
});

test("a confirmed retry re-checks each lead on the server and sends only eligible ones, with event_id = lead id", async () => {
  const w = world([L("a"), L("b", { CAPI_STATUS: "LeadSubmitted" }), L("c", { created_at: new Date(NOW - 8 * DAY).toISOString() }), L("d", { ctwa_clid: "" })]);
  const r = await call(w.deps, "retry", { lead_ids: ["a", "b", "c", "d"], confirm: true });
  assert.equal(w.sent.length, 1);
  const ev = w.sent[0].data[0];
  assert.equal(ev.event_id, "a"); assert.equal(ev.event_name, "LeadSubmitted"); assert.equal(ev.user_data.ctwa_clid, "clid-a");
  assert.equal(ev.action_source, "business_messaging"); assert.equal(ev.messaging_channel, "whatsapp");
  assert.deepEqual(ev.custom_data, { currency: "USD", value: 100 }); assert.equal(ev.user_data.page_id, "104718884272119");
  const by = Object.fromEntries(r.body.data.results.map((x: any) => [x.id, x.result]));
  assert.deepEqual(by, { a: "accepted", b: "skipped_already_reported", c: "skipped_expired", d: "skipped_ineligible" });
});

test("accepted only with HTTP 200 and events_received >= 1; a 200 with 0 is ambiguous and the lead stays unreported", async () => {
  const w = world([L("a")], () => ({ status: 200, json: { events_received: 0 } }));
  const r = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  assert.equal(r.body.data.results[0].result, "ambiguous");
  assert.equal(w.attempts[0].outcome, "ambiguous");
  assert.equal((w.deps as any).__noop, undefined);
  assert.equal((await w.deps.lead("a"))!.capi_status_column, null);
});

test("Meta errors are recorded with code, subcode, type, a capped message and fbtrace_id", async () => {
  const w = world([L("a")], () => ({ status: 400, json: { error: { message: "Error validating access token: Sessions for the user are not allowed", type: "OAuthException", code: 190, error_subcode: 464, fbtrace_id: "fbt-9" } } }));
  await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  const a = w.attempts[0];
  assert.deepEqual([a.outcome, a.http_status, a.error_code, a.error_subcode, a.error_type, a.fbtrace_id], ["rejected", 400, 190, 464, "OAuthException", "fbt-9"]);
  assert.ok(a.error_message.length <= 500);
});

test("a timeout is recorded as such and the same lead is not retried until an operator chooses to", async () => {
  const w = world([L("a")], () => new Error("aborted: timeout"));
  const r = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  assert.equal(r.body.data.results[0].result, "timeout");
  assert.equal(w.sent.length, 1, "one attempt, no automatic second send");
  const again = await call(w.deps, "retry", { lead_ids: ["a"] });
  assert.match(again.body.data.warnings.join(" "), /timed out/i, "the preview warns that Meta may already have it");
});

test("a lead another sender holds is skipped, never sent twice at once", async () => {
  const w = world([L("a")]);
  await w.deps.acquire("a", "bot");
  const r = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  assert.equal(r.body.data.results[0].result, "skipped_locked");
  assert.equal(w.sent.length, 0);
});

test("the lock is released after each send, whatever the outcome", async () => {
  const w = world([L("a"), L("b")], (b) => (b.data[0].event_id === "a" ? new Error("network down") : { status: 200, json: { events_received: 1 } }));
  await call(w.deps, "retry", { lead_ids: ["a", "b"], confirm: true });
  assert.equal(w.locks.size, 0);
});

test("missing token: nothing is sent, the attempt is not logged as a Meta failure, the caller is told", async () => {
  const w = world([L("a")]);
  w.deps.token = () => "";
  const r = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /not configured/);
  assert.equal(w.sent.length, 0); assert.equal(w.attempts.length, 0);
});

test("a batch is capped, ids must be distinct, and recovery can be paused", async () => {
  const w = world(Array.from({ length: 60 }, (_, i) => L("q" + i)));
  assert.equal((await call(w.deps, "retry", { lead_ids: Array.from({ length: 51 }, (_, i) => "q" + i), confirm: true })).status, 422);
  assert.equal((await call(w.deps, "retry", { lead_ids: ["q1", "q1"], confirm: true })).status, 422);
  await call(w.deps, "settings.set", { ui_recovery_paused: true });
  const r = await call(w.deps, "retry", { lead_ids: ["q1"], confirm: true });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /paused/);
  assert.equal(w.sent.length, 0);
});

test("loading the page never sends: summary, list, history and config make no Meta call", async () => {
  const w = world([L("a"), L("b")]);
  for (const a of ["summary", "list", "config"]) await call(w.deps, a);
  await call(w.deps, "history", { id: "a" });
  assert.equal(w.sent.length, 0);
});

test("the acting user is recorded on every UI attempt", async () => {
  const w = world([L("a")]);
  await call(w.deps, "retry", { lead_ids: ["a"], confirm: true }, "granted");
  assert.equal(w.attempts[0].initiated_by, "granted"); assert.equal(w.attempts[0].source, "ui_retry");
});

// ── classification ──────────────────────────────────────────────────────────
test("classifyMeta maps Meta's answers to one outcome each", () => {
  assert.equal(classifyMeta(200, { events_received: 1 }).outcome, "accepted");
  assert.equal(classifyMeta(200, { events_received: 0 }).outcome, "ambiguous");
  assert.equal(classifyMeta(200, {}).outcome, "ambiguous");
  assert.equal(classifyMeta(400, { error: { code: 100 } }).outcome, "rejected");
  assert.equal(classifyMeta(429, { error: { code: 4 } }).outcome, "rate_limited");
  assert.equal(classifyMeta(400, { error: { code: 80004 } }).outcome, "rate_limited");
  assert.equal(classifyMeta(500, {}).outcome, "rejected");
  const c = classifyMeta(400, { error: { code: 190, error_subcode: 464, type: "OAuthException", message: "m".repeat(900), fbtrace_id: "t" } });
  assert.deepEqual([c.error_code, c.error_subcode, c.error_type, c.fbtrace_id, c.error_message!.length], [190, 464, "OAuthException", "t", 500]);
});

// ── CR-001 decision D1 ──────────────────────────────────────────────────────
// No privileged action may rely on a user id sent by the browser. Until
// verified sessions ship (Phase 1B), sending and changing settings are off
// unless the server is explicitly started in a mode that allows them: a local
// stack (CAPI_ALLOW_UNVERIFIED_ACTOR=local) for development, never production.
test("D1: with no verified session, retry and settings.set are refused (fail closed); reads still work", async () => {
  const w = world([L("a")]);
  w.deps.allowUnverifiedActor = () => false;
  const r = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  assert.equal(r.status, 403); assert.match(r.body.error.message, /verified sign-in/);
  const preview = await call(w.deps, "retry", { lead_ids: ["a"] });
  assert.equal(preview.status, 403, "even the preview, which is the first step of a send");
  const s = await call(w.deps, "settings.set", { ui_recovery_paused: true });
  assert.equal(s.status, 403);
  assert.equal(w.sent.length, 0); assert.equal(w.attempts.length, 0); assert.equal(w.settings.ui_recovery_paused, false);
  for (const a of ["summary", "list", "config"]) assert.equal((await call(w.deps, a)).status, 200, a);
  assert.equal((await call(w.deps, "history", { id: "a" })).status, 200);
  const cfg = (await call(w.deps, "config")).body.data;
  assert.equal(cfg.actions_enabled, false, "the page is told, so it can say why");
});

test("D1: the default, with no explicit opt-in, is fail closed", async () => {
  const w = world([L("a")]);
  delete (w.deps as any).allowUnverifiedActor;
  assert.equal((await call(w.deps, "retry", { lead_ids: ["a"], confirm: true })).status, 403);
  assert.equal(w.sent.length, 0);
});

// ── agent qualification ─────────────────────────────────────────────────────
test("only a lead an agent marked Connected or Interested is sent; an unqualified one is skipped as ineligible", async () => {
  const w = world([L("q"), L("u", { qualified: false })]);
  const pre = await call(w.deps, "retry", { lead_ids: ["q", "u"] });
  assert.equal(pre.body.data.preview.eligible, 1); assert.equal(pre.body.data.preview.ineligible, 1);
  const r = await call(w.deps, "retry", { lead_ids: ["q", "u"], confirm: true });
  assert.deepEqual(r.body.data.results.map((x: any) => [x.id, x.result]), [["q", "accepted"], ["u", "skipped_ineligible"]]);
  assert.deepEqual(w.sent.map((b) => b.data[0].event_id), ["q"]);
});

test("qualification is checked again right before the send, not only at preview", async () => {
  const leads = [L("q")];
  const w = world(leads);
  assert.equal((await call(w.deps, "retry", { lead_ids: ["q"] })).body.data.preview.eligible, 1);
  leads[0].qualified = false; // e.g. the activity row turned out to be a system write and was corrected
  const r = await call(w.deps, "retry", { lead_ids: ["q"], confirm: true });
  assert.equal(r.body.data.results[0].result, "skipped_ineligible"); assert.equal(w.sent.length, 0);
});

// ── the shared limiter ──────────────────────────────────────────────────────
test("every send passes the shared limiter; a refused lead is not sent, not logged, and reported rate_limited with its retry time", async () => {
  const w = world([L("a"), L("b"), L("c")]);
  w.limiter.verdict.b = { result: "rate_limited", reason: "window", retry_at: "2026-10-29T11:01:00.000Z" };
  const r = await call(w.deps, "retry", { lead_ids: ["a", "b", "c"], confirm: true });
  const by = Object.fromEntries(r.body.data.results.map((x: any) => [x.id, x]));
  assert.equal(by.a.result, "accepted");
  assert.equal(by.b.result, "rate_limited"); assert.equal(by.b.retry_at, "2026-10-29T11:01:00.000Z");
  assert.equal(by.c.result, "rate_limited", "the rest of the batch waits too: nothing is sent past a refusal");
  assert.deepEqual(w.sent.map((x) => x.data[0].event_id), ["a"]);
  assert.deepEqual(w.attempts.map((x) => x.lead_id), ["a"], "a refusal by our own limiter is not a Meta attempt");
  assert.deepEqual(w.limiter.acquired, ["a"]);
});

test("Meta throttling: recorded as rate_limited, every sender is paused with Meta's hint, the rest of the batch waits", async () => {
  const w = world([L("a"), L("b")], () => ({ status: 429, json: { error: { code: 4, message: "Application request limit reached", fbtrace_id: "fbt-t" } }, retryAfter: 42 }));
  const r = await call(w.deps, "retry", { lead_ids: ["a", "b"], confirm: true });
  assert.deepEqual(r.body.data.results.map((x: any) => [x.id, x.result]), [["a", "rate_limited"], ["b", "rate_limited"]]);
  assert.equal(w.sent.length, 1, "nothing more is sent after Meta said slow down");
  assert.deepEqual(w.limiter.throttles, [42]);
  assert.equal(w.attempts.length, 1); assert.equal(w.attempts[0].outcome, "rate_limited"); assert.equal(w.attempts[0].error_code, 4);
  assert.equal(w.locks.size, 0, "the lock is released");
  assert.equal((await w.deps.lead("a"))!.capi_status_column, null, "the lead stays unreported and can be retried");
});

test("a throttle code inside a 400 counts too, and with no hint the database picks the backoff", async () => {
  for (const code of [4, 17, 32, 613, 80004]) {
    const w = world([L("a")], () => ({ status: 400, json: { error: { code } } }));
    const r = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
    assert.equal(r.body.data.results[0].result, "rate_limited", String(code));
    assert.deepEqual(w.limiter.throttles, [null]);
  }
  const w = world([L("a")], () => ({ status: 400, json: { error: { code: 100 } } }));
  assert.equal((await call(w.deps, "retry", { lead_ids: ["a"], confirm: true })).body.data.results[0].result, "rejected");
  assert.deepEqual(w.limiter.throttles, [], "an ordinary rejection does not pause anyone");
});

// ── no blind resend after an unclear answer ─────────────────────────────────
test("a lead whose earlier send got no clear answer is held back unless the operator chooses to resend it", async () => {
  let metaDown = true;
  const w = world([L("a"), L("b")], (b) => (metaDown && b.data[0].event_id === "a" ? new Error("aborted: timeout") : { status: 200, json: { events_received: 1 } }));
  await call(w.deps, "retry", { lead_ids: ["a"], confirm: true });
  metaDown = false;
  const pre = await call(w.deps, "retry", { lead_ids: ["a", "b"] });
  assert.equal(pre.body.data.preview.unsure, 1);
  const r = await call(w.deps, "retry", { lead_ids: ["a", "b"], confirm: true });
  assert.deepEqual(r.body.data.results.map((x: any) => [x.id, x.result]), [["a", "skipped_unsure"], ["b", "accepted"]]);
  assert.equal(w.sent.length, 2, "a was not sent a second time");
  const again = await call(w.deps, "retry", { lead_ids: ["a"], confirm: true, resend_unsure: true });
  assert.equal(again.body.data.results[0].result, "accepted");
  assert.equal(w.sent.length, 3);
});

// ── bot switch ──────────────────────────────────────────────────────────────
test("bots lists the two existing bots' Meta CAPI switch; bot.set persists one and returns both", async () => {
  const w = world([]);
  assert.deepEqual((await call(w.deps, "bots")).body.data.bots.map((b: any) => [b.bot, b.meta_capi_enabled]), [["eyad", true], ["dubai", true]]);
  const r = await call(w.deps, "bot.set", { bot: "dubai", enabled: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.bots.map((b: any) => [b.bot, b.meta_capi_enabled]), [["eyad", true], ["dubai", false]]);
  assert.deepEqual(w.bots.map((b) => b.meta_capi_enabled), [true, false], "persisted");
});

test("bot.set refuses an unknown bot or a non-boolean, and changes nothing", async () => {
  const w = world([]);
  for (const p of [{ bot: "new-bot", enabled: false }, { bot: "eyad", enabled: "off" }, { bot: "eyad" }]) {
    assert.equal((await call(w.deps, "bot.set", p)).status, 422, JSON.stringify(p));
  }
  assert.deepEqual(w.bots.map((b) => b.meta_capi_enabled), [true, true]);
});

test("D1: bot.set is a privileged action and fails closed without a verified sign-in; bots still reads", async () => {
  const w = world([]);
  w.deps.allowUnverifiedActor = () => false;
  assert.equal((await call(w.deps, "bot.set", { bot: "eyad", enabled: false })).status, 403);
  assert.deepEqual(w.bots.map((b) => b.meta_capi_enabled), [true, true]);
  assert.equal((await call(w.deps, "bots")).status, 200);
});
