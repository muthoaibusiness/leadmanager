// Meta CAPI core — the request handler behind Admin › Meta CAPI. Web-standard
// code only (fetch, Request, Response, crypto): no Deno globals, so the Edge
// Function and the Node tests run the same file. All I/O is injected (CapiDeps).
//
// Trust model, as for finance and the AI Trainer: the caller is the verified
// Supabase Auth session (deps.verify, actor.ts); body.userId is ignored. The
// users row says whether that account may use Meta CAPI (role MANAGEMENT
// or MASTER, or an allowed_features grant of 'metacapi', which then fully
// decides, the same rule as canSee() in the browser). Every read and write uses
// the service role. The Meta token stays in the Edge Function's environment:
// no action returns it, and nothing derived from it but "configured" leaves.
//
// CR-001 decision D1: every action, reads included, takes its caller from the
// verified session, and privileged actions (retry, which sends to Meta,
// settings.set, bot.set) require one too: loadActor fail-closes with 401 when
// there is no valid session, so sending is on for any verified, authorized
// admin. The D1 test exercises the 401 path.
//
// Sending, the same event the bots send (wa-bot-eyad v61 / wa-bot-dubai v58):
// LeadSubmitted, business_messaging, whatsapp, event_id = lead id, the lead's
// ctwa_clid and the page id. A lead is sent only after a fresh server-side
// check (has a click id, an agent marked it Connected or Interested, not
// already reported, inside Meta's 7-day window, no earlier unclear answer
// unless the operator chose to resend) and only with confirm: true. It counts
// as reported only when Meta answers HTTP 200 with events_received >= 1.
//
// Every send first passes the shared limiter (capi_acquire, migration 0051):
// the lead lock, a cap on sends in flight and a cap per window, one gate for
// every sender. A refusal stops the rest of the batch; nothing is sent past
// it. Meta's own throttling pauses every sender (capi_throttle). Meta does
// not deduplicate business-messaging events (docs/research/2026-10-29-meta-
// capi-limits.md), so a reported lead is never sent again.

import { hasFeature } from "./access-rules.js";

export const DATASET_ID = "869790160551668";
export const PAGE_ID = "104718884272119";
export const GRAPH = "https://graph.facebook.com/v26.0";
export const WINDOW_MS = 7 * 24 * 3600 * 1000;
export const MAX_BATCH = 50;
export const MAX_PAGE = 200;
export const STATUSES = ["all", "success", "failed", "pending", "expired", "ineligible"] as const;
// Graph API throttling codes (graph-api/overview/rate-limiting).
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80004]);
export const BOT_NAMES = ["eyad", "dubai"];

type Row = Record<string, any>;
export type Attempt = {
  lead_id: string; event_id: string; source: "ui_retry"; initiated_by: string; outcome: Outcome;
  http_status: number | null; events_received: number | null; error_code: number | null; error_subcode: number | null;
  error_type: string | null; error_message: string | null; fbtrace_id: string | null; meta_response: Row | null; lock_id: string | null;
};
export type Outcome = "accepted" | "rejected" | "timeout" | "network" | "ambiguous" | "rate_limited";
export type Permit = { result: "ok" | "locked" | "rate_limited"; reason?: string; retry_at?: string };
export type CapiDeps = {
  now(): number;
  token(): string;
  user(id: string): Promise<Row | null>;
  // capi_lead_status columns: id, company_id, created_at, ctwa_clid, capi_status_column, qualified, unsure.
  lead(id: string): Promise<Row | null>;
  page(q: { company: string | null; status: string; search: string; from: string | null; to: string | null; sort: string; limit: number; offset: number }): Promise<{ rows: Row[]; total: number }>;
  summary(company: string | null): Promise<Row>;
  history(leadId: string): Promise<Row[]>;
  acquire(leadId: string, source: string): Promise<Permit>;
  unlock(leadId: string): Promise<void>;
  throttle(hintSeconds: number | null): Promise<string>;
  bots(): Promise<Row[]>;
  setBot(bot: string, enabled: boolean): Promise<Row | null>;
  record(a: Attempt): Promise<{ attempt_no: number }>;
  settings(): Promise<Row>;
  saveSettings(p: { ui_recovery_paused?: boolean; manual_send_enabled?: boolean; updated_by: string }): Promise<void>;
  postMeta(body: Row): Promise<{ status: number; json: Row; retryAfter?: number | null }>;
  // D1: may this server accept a browser-claimed user id for a privileged action?
  allowUnverifiedActor?: () => boolean;
  // The verified caller (actor.ts): the users row for the request's Supabase
  // Auth session, or a throw with .status 401/403. body.userId is never read.
  verify(req: Request): Promise<Row>;
};

class Fail extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

// ── who may use it ──────────────────────────────────────────────────────────
export async function loadActor(deps: CapiDeps, req: Request) {
  let u: Row;
  try { u = await deps.verify(req); }
  catch (e: any) { throw new Fail(typeof e?.status === "number" ? e.status : 401, e?.message || "Sign in required"); }
  if (!u || u.is_active === false) throw new Fail(401, "Unknown or inactive account");
  // The same rule as the browser (access-rules.js): metacapi defaults to
  // Management and Master; a saved feature list fully decides.
  const ok = hasFeature(u, "metacapi");
  if (!ok) throw new Fail(403, "Meta CAPI is not enabled for this account");
  // Master sees every company; everyone else only their own.
  return { id: u.id as string, company: u.role === "MASTER" ? null : (u.company_id as string | null) ?? "__none__" };
}

// ── Meta's answer → one outcome ─────────────────────────────────────────────
// Only HTTP 200 with events_received >= 1 is "accepted". A 200 without it is
// "ambiguous": Meta may or may not have the event, so it is never counted as
// reported and the operator is warned before any resend.
const scrub = (s: unknown, token: string) => (token ? String(s ?? "").split(token).join("[redacted]") : String(s ?? ""));
export function classifyMeta(status: number, j: Row, token = "") {
  const e = j?.error;
  const received = Number.isFinite(Number(j?.events_received)) ? Number(j.events_received) : null;
  const throttled = status === 429 || (e && THROTTLE_CODES.has(Number(e.code)));
  const outcome: Outcome = status === 200 && !e ? ((received ?? 0) >= 1 ? "accepted" : "ambiguous") : throttled ? "rate_limited" : "rejected";
  return {
    outcome, events_received: received,
    error_code: e && Number.isFinite(Number(e.code)) ? Number(e.code) : null,
    error_subcode: e && Number.isFinite(Number(e.error_subcode)) ? Number(e.error_subcode) : null,
    error_type: e?.type ? scrub(e.type, token).slice(0, 100) : null,
    error_message: e?.message ? scrub(e.message, token).slice(0, 500) : null,
    fbtrace_id: String(j?.fbtrace_id ?? e?.fbtrace_id ?? "").slice(0, 100) || null,
    // Meta's own fields, as returned, minus anything that could carry a secret.
    meta_response: JSON.parse(scrub(JSON.stringify(sanitizeResponse(j)), token)),
  };
}
function sanitizeResponse(j: Row): Row {
  const keep = (o: Row | undefined, keys: string[]) => (o ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : undefined);
  return {
    ...keep(j, ["events_received", "messages", "fbtrace_id"]),
    ...(j?.error ? { error: keep(j.error, ["message", "type", "code", "error_subcode", "is_transient", "error_user_title", "error_user_msg", "fbtrace_id"]) } : {}),
  };
}

// The event the bots send, unchanged.
export function eventBody(lead: Row, token: string, nowMs: number) {
  return {
    data: [{
      action_source: "business_messaging", custom_data: { currency: "USD", value: 100 }, event_name: "LeadSubmitted",
      event_id: String(lead.id), event_time: Math.floor(nowMs / 1000), messaging_channel: "whatsapp",
      user_data: { ctwa_clid: lead.ctwa_clid, page_id: PAGE_ID },
    }],
    access_token: token,
  };
}

// Fresh, server-side eligibility of one lead. `qualified` is the agent's
// Connected / Interested action, from the activity log (capi_lead_status).
type Check = "eligible" | "not_found" | "already_reported" | "ineligible" | "expired" | "other_company" | "unsure";
function check(lead: Row | null, company: string | null, nowMs: number, resendUnsure = false): Check {
  if (!lead) return "not_found";
  if (company !== null && lead.company_id !== company) return "other_company";
  if (lead.capi_status_column === "LeadSubmitted") return "already_reported";
  if (!lead.ctwa_clid || lead.qualified !== true) return "ineligible";
  if (!(nowMs - Date.parse(lead.created_at) < WINDOW_MS)) return "expired";
  if (lead.unsure === true && !resendUnsure) return "unsure";
  return "eligible";
}

// ── actions ─────────────────────────────────────────────────────────────────
type Actor = Awaited<ReturnType<typeof loadActor>>;
type Action = (deps: CapiDeps, actor: Actor, p: Row) => Promise<unknown>;
const ACTIONS: Record<string, Action> = {
  async config(deps) {
    const s = await deps.settings();
    return { token: { configured: !!deps.token() }, dataset_id: DATASET_ID, window_days: 7, max_batch: MAX_BATCH,
      // loadActor already verified the session and the metacapi grant; a caller
      // that reaches config may act.
      actions_enabled: true,
      ui_recovery_paused: !!s.ui_recovery_paused, manual_send_enabled: s.manual_send_enabled !== false, settings_updated_at: s.updated_at ?? null, settings_updated_by: s.updated_by ?? null };
  },
  async summary(deps, actor) { return deps.summary(actor.company); },
  async list(deps, actor, p) {
    const status = String(p.status ?? "all");
    if (!(STATUSES as readonly string[]).includes(status)) throw new Fail(422, "Unknown status filter");
    const limit = Math.min(Math.max(1, Number(p.limit) || 50), MAX_PAGE);
    const offset = Math.max(0, Number(p.offset) || 0);
    const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
    const sort = ["created_desc", "created_asc", "cutoff_asc", "last_attempt_desc"].includes(p.sort) ? p.sort : "created_desc";
    return deps.page({ company: actor.company, status, search: String(p.search ?? "").slice(0, 100), from: iso(p.from), to: iso(p.to), sort, limit, offset });
  },
  async history(deps, actor, p) {
    const lead = await deps.lead(String(p.id ?? ""));
    if (!lead || (actor.company !== null && lead.company_id !== actor.company)) throw new Fail(404, "Lead not found");
    return { attempts: await deps.history(lead.id) };
  },
  async bots(deps) { return { bots: await deps.bots() }; },
  // The existing bots' switch for sending LeadSubmitted when a lead is created.
  async "bot.set"(deps, actor, p) {
    if (!BOT_NAMES.includes(p.bot) || typeof p.enabled !== "boolean") throw new Fail(422, `bot must be one of ${BOT_NAMES.join(", ")} and enabled true or false`);
    if (!(await deps.setBot(p.bot, p.enabled))) throw new Fail(404, "Bot settings not found");
    return { bots: await deps.bots() };
  },
  async "settings.set"(deps, actor, p) {
    const has = (k: string) => typeof p[k] === "boolean";
    if (!has("ui_recovery_paused") && !has("manual_send_enabled")) throw new Fail(422, "ui_recovery_paused or manual_send_enabled must be true or false");
    await deps.saveSettings({ ...(has("ui_recovery_paused") ? { ui_recovery_paused: p.ui_recovery_paused } : {}),
      ...(has("manual_send_enabled") ? { manual_send_enabled: p.manual_send_enabled } : {}), updated_by: actor.id });
    return ACTIONS.config(deps, actor, {});
  },
  async retry(deps, actor, p) {
    const ids: unknown = p.lead_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH || !ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 100) || new Set(ids).size !== ids.length) {
      throw new Fail(422, `lead_ids must be 1-${MAX_BATCH} distinct lead ids`);
    }
    const resendUnsure = p.resend_unsure === true;
    const now = deps.now();
    const leads = await Promise.all((ids as string[]).map((id) => deps.lead(id)));
    const checks = leads.map((l) => check(l, actor.company, now, resendUnsure));
    const warnings: string[] = [];
    const count = (k: Check) => checks.filter((c) => c === k).length;
    const unsure = leads.filter((l, i) => l?.unsure === true && (checks[i] === "unsure" || checks[i] === "eligible")).length;
    if (unsure) warnings.push(`${unsure} lead(s) had an attempt that timed out or got no clear answer: Meta may already have that event, and Meta does not deduplicate these events. They are skipped unless you choose to resend them.`);
    const preview = { selected: ids.length, eligible: count("eligible"), already_reported: count("already_reported"), expired: count("expired"),
      ineligible: count("ineligible") + count("not_found") + count("other_company"), unsure: count("unsure"), locked: 0 };
    if (p.confirm !== true) return { sent: false, preview, warnings };

    const s = await deps.settings();
    if (s.ui_recovery_paused) throw new Fail(409, "CRM recovery is paused. Resume it before sending.");
    if (s.manual_send_enabled === false) throw new Fail(409, "Manual sending is disabled. Enable it to send.");
    const token = deps.token();
    if (!token) throw new Fail(409, "The Meta CAPI token is not configured on the server.");

    const results: Row[] = [];
    // Set once the limiter or Meta says wait: the rest of the batch is not sent.
    let held: { retry_at: string | null } | null = null;
    for (const id of ids as string[]) {
      if (held) { results.push({ id, result: "rate_limited", retry_at: held.retry_at }); continue; }
      // Checked again right before the send: another sender may have reported it meanwhile.
      const lead = await deps.lead(id);
      const c = check(lead, actor.company, deps.now(), resendUnsure);
      if (c !== "eligible") { results.push({ id, result: c === "not_found" || c === "other_company" ? "skipped_ineligible" : `skipped_${c}` }); continue; }
      const permit = await deps.acquire(id, "ui_retry");
      if (permit.result === "locked") { results.push({ id, result: "skipped_locked" }); continue; }
      if (permit.result !== "ok") { held = { retry_at: permit.retry_at ?? null }; results.push({ id, result: "rate_limited", retry_at: held.retry_at }); continue; }
      try {
        let row: Omit<Attempt, "lead_id" | "event_id" | "source" | "initiated_by" | "lock_id">;
        let retryAt: string | null = null;
        try {
          const r = await deps.postMeta(eventBody(lead!, token, deps.now()));
          const m = classifyMeta(r.status, r.json, token);
          row = { ...m, http_status: r.status };
          // Meta said slow down: every sender waits, this lead stays queued for a retry.
          if (m.outcome === "rate_limited") { retryAt = await deps.throttle(r.retryAfter ?? null); held = { retry_at: retryAt }; }
        } catch (e) {
          // No answer: Meta may or may not have the event. Recorded, not retried.
          const msg = scrub(e instanceof Error ? e.message : String(e), token);
          const outcome: Outcome = /timeout|abort/i.test(msg) ? "timeout" : "network";
          row = { outcome, http_status: null, events_received: null, error_code: null, error_subcode: null, error_type: null,
            error_message: msg.slice(0, 500), fbtrace_id: null, meta_response: null };
        }
        const saved = await deps.record({ lead_id: id, event_id: id, source: "ui_retry", initiated_by: actor.id, lock_id: null, ...row });
        results.push({ id, result: row.outcome, attempt_no: saved.attempt_no, http_status: row.http_status, events_received: row.events_received,
          error_code: row.error_code, error_subcode: row.error_subcode, error_message: row.error_message, fbtrace_id: row.fbtrace_id,
          ...(retryAt ? { retry_at: retryAt } : {}) });
      } finally {
        await deps.unlock(id);
      }
    }
    return { sent: true, preview, warnings, results };
  },
};

export async function handleCapi(req: Request, deps: CapiDeps, allowedOrigin = "*"): Promise<Response> {
  const cors = { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: { message: "Method not allowed" } }, 405);
  let body: Row;
  try { body = await req.json(); } catch { return json({ ok: false, error: { message: "Invalid JSON" } }, 400); }
  try {
    const actor = await loadActor(deps, req);
    const fn = ACTIONS[String(body.action)];
    if (!fn) throw new Fail(400, "Unknown action");
    return json({ ok: true, data: await fn(deps, actor, body.payload ?? {}) });
  } catch (e) {
    if (e instanceof Fail) return json({ ok: false, error: { message: e.message } }, e.status);
    console.error("meta-capi error", e instanceof Error ? scrub(e.message, deps.token()) : "unknown");
    return json({ ok: false, error: { message: "Something went wrong" } }, 500);
  }
}
