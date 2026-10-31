// Meta CAPI core — the request handler behind Admin › Meta CAPI. Web-standard
// code only (fetch, Request, Response, crypto): no Deno globals, so the Edge
// Function and the Node tests run the same file. All I/O is injected (CapiDeps).
//
// Trust model, as for finance and the AI Trainer: the caller names a userId;
// the users table says whether that account may use Meta CAPI (role MANAGEMENT
// or MASTER, or an allowed_features grant of 'metacapi', which then fully
// decides, the same rule as canSee() in the browser). Every read and write uses
// the service role. The Meta token stays in the Edge Function's environment:
// no action returns it, and nothing derived from it but "configured" leaves.
//
// CR-001 decision D1: no privileged action may rely on a user id sent by the
// browser. The CRM has no verified session yet (Phase 1B), so the actions that
// change something (retry, which sends to Meta, and settings.set) are refused
// unless allowUnverifiedActor() says this server may accept a claimed id. It is
// false unless the function is started with CAPI_ALLOW_UNVERIFIED_ACTOR=local,
// which only a local development stack sets. Read-only actions still use the
// claimed id, like every other CRM page today.
//
// Sending, the same event the bots send (wa-bot-eyad v61 / wa-bot-dubai v58):
// LeadSubmitted, business_messaging, whatsapp, event_id = lead id, the lead's
// ctwa_clid and the page id. A lead is sent only after a fresh server-side
// check (has a click id, not already reported, inside Meta's 7-day window, not
// held by another sender) and only with confirm: true. It counts as reported
// only when Meta answers HTTP 200 with events_received >= 1.

export const DATASET_ID = "869790160551668";
export const PAGE_ID = "104718884272119";
export const GRAPH = "https://graph.facebook.com/v26.0";
export const WINDOW_MS = 7 * 24 * 3600 * 1000;
export const MAX_BATCH = 50;
export const MAX_PAGE = 200;
const LOCK_TTL_S = 120;
export const STATUSES = ["all", "success", "failed", "pending", "expired", "ineligible"] as const;

type Row = Record<string, any>;
export type Attempt = {
  lead_id: string; event_id: string; source: "ui_retry"; initiated_by: string; outcome: Outcome;
  http_status: number | null; events_received: number | null; error_code: number | null; error_subcode: number | null;
  error_type: string | null; error_message: string | null; fbtrace_id: string | null; meta_response: Row | null; lock_id: string | null;
};
export type Outcome = "accepted" | "rejected" | "timeout" | "network" | "ambiguous";
export type CapiDeps = {
  now(): number;
  token(): string;
  user(id: string): Promise<Row | null>;
  lead(id: string): Promise<Row | null>;
  page(q: { company: string | null; status: string; search: string; from: string | null; to: string | null; sort: string; limit: number; offset: number }): Promise<{ rows: Row[]; total: number }>;
  summary(company: string | null): Promise<Row>;
  history(leadId: string): Promise<Row[]>;
  tryLock(leadId: string): Promise<string | null>;
  unlock(leadId: string): Promise<void>;
  record(a: Attempt): Promise<{ attempt_no: number }>;
  settings(): Promise<Row>;
  saveSettings(p: { ui_recovery_paused: boolean; updated_by: string }): Promise<void>;
  postMeta(body: Row): Promise<{ status: number; json: Row }>;
  // D1: may this server accept a browser-claimed user id for a privileged action?
  allowUnverifiedActor?: () => boolean;
};

class Fail extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

// ── who may use it ──────────────────────────────────────────────────────────
export async function loadActor(deps: CapiDeps, userId: unknown) {
  if (!userId || typeof userId !== "string") throw new Fail(401, "Sign in required");
  const u = await deps.user(userId);
  if (!u || u.is_active === false) throw new Fail(401, "Unknown or inactive account");
  const af = Array.isArray(u.allowed_features) ? u.allowed_features : null;
  const ok = af ? af.includes("metacapi") : u.role === "MANAGEMENT" || u.role === "MASTER";
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
  const outcome: Outcome = status === 200 && !e ? ((received ?? 0) >= 1 ? "accepted" : "ambiguous") : "rejected";
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

// Fresh, server-side eligibility of one lead.
type Check = "eligible" | "not_found" | "already_reported" | "ineligible" | "expired" | "other_company";
function check(lead: Row | null, company: string | null, nowMs: number): Check {
  if (!lead) return "not_found";
  if (company !== null && lead.company_id !== company) return "other_company";
  if (lead.CAPI_STATUS === "LeadSubmitted") return "already_reported";
  if (!lead.ctwa_clid) return "ineligible";
  if (!(nowMs - Date.parse(lead.created_at) < WINDOW_MS)) return "expired";
  return "eligible";
}

// ── actions ─────────────────────────────────────────────────────────────────
type Actor = Awaited<ReturnType<typeof loadActor>>;
type Action = (deps: CapiDeps, actor: Actor, p: Row) => Promise<unknown>;
// Actions that change something. Fail closed until a verified session exists (D1).
const PRIVILEGED = new Set(["retry", "settings.set"]);
const unverifiedAllowed = (deps: CapiDeps) => deps.allowUnverifiedActor?.() === true;

const ACTIONS: Record<string, Action> = {
  async config(deps) {
    const s = await deps.settings();
    return { token: { configured: !!deps.token() }, dataset_id: DATASET_ID, window_days: 7, max_batch: MAX_BATCH,
      actions_enabled: unverifiedAllowed(deps),
      ui_recovery_paused: !!s.ui_recovery_paused, settings_updated_at: s.updated_at ?? null, settings_updated_by: s.updated_by ?? null };
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
  async "settings.set"(deps, actor, p) {
    if (typeof p.ui_recovery_paused !== "boolean") throw new Fail(422, "ui_recovery_paused must be true or false");
    await deps.saveSettings({ ui_recovery_paused: p.ui_recovery_paused, updated_by: actor.id });
    return ACTIONS.config(deps, actor, {});
  },
  async retry(deps, actor, p) {
    const ids: unknown = p.lead_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH || !ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 100) || new Set(ids).size !== ids.length) {
      throw new Fail(422, `lead_ids must be 1-${MAX_BATCH} distinct lead ids`);
    }
    const now = deps.now();
    const leads = await Promise.all((ids as string[]).map((id) => deps.lead(id)));
    const checks = leads.map((l) => check(l, actor.company, now));
    const histories = await Promise.all((ids as string[]).map((id, i) => (checks[i] === "eligible" ? deps.history(id) : Promise.resolve([]))));
    const warnings: string[] = [];
    const unsure = (ids as string[]).filter((_, i) => histories[i].some((a: Row) => a.outcome === "timeout" || a.outcome === "network" || a.outcome === "ambiguous"));
    if (unsure.length) warnings.push(`${unsure.length} lead(s) had an attempt that timed out or got no clear answer: Meta may already have that event. A resend uses the same event_id, so Meta should drop a duplicate.`);
    const count = (k: Check) => checks.filter((c) => c === k).length;
    const preview = { selected: ids.length, eligible: count("eligible"), already_reported: count("already_reported"), expired: count("expired"),
      ineligible: count("ineligible") + count("not_found") + count("other_company"), locked: 0 };
    if (p.confirm !== true) return { sent: false, preview, warnings };

    if ((await deps.settings()).ui_recovery_paused) throw new Fail(409, "CRM recovery is paused. Resume it before sending.");
    const token = deps.token();
    if (!token) throw new Fail(409, "The Meta CAPI token is not configured on the server.");

    const results: Row[] = [];
    for (const id of ids as string[]) {
      // Checked again right before the send: another sender may have reported it meanwhile.
      const lead = await deps.lead(id);
      const c = check(lead, actor.company, deps.now());
      if (c !== "eligible") { results.push({ id, result: c === "not_found" || c === "other_company" ? "skipped_ineligible" : `skipped_${c}` }); continue; }
      const lock = await deps.tryLock(id);
      if (!lock) { results.push({ id, result: "skipped_locked" }); continue; }
      try {
        let row: Omit<Attempt, "lead_id" | "event_id" | "source" | "initiated_by" | "lock_id">;
        try {
          const r = await deps.postMeta(eventBody(lead!, token, deps.now()));
          const m = classifyMeta(r.status, r.json, token);
          row = { ...m, http_status: r.status };
        } catch (e) {
          // No answer: Meta may or may not have the event. Recorded, not retried.
          const msg = scrub(e instanceof Error ? e.message : String(e), token);
          const outcome: Outcome = /timeout|abort/i.test(msg) ? "timeout" : "network";
          row = { outcome, http_status: null, events_received: null, error_code: null, error_subcode: null, error_type: null,
            error_message: msg.slice(0, 500), fbtrace_id: null, meta_response: null };
        }
        const saved = await deps.record({ lead_id: id, event_id: id, source: "ui_retry", initiated_by: actor.id, lock_id: lock, ...row });
        results.push({ id, result: row.outcome, attempt_no: saved.attempt_no, http_status: row.http_status, events_received: row.events_received,
          error_code: row.error_code, error_subcode: row.error_subcode, error_message: row.error_message, fbtrace_id: row.fbtrace_id });
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
    const actor = await loadActor(deps, body.userId);
    const fn = ACTIONS[String(body.action)];
    if (!fn) throw new Fail(400, "Unknown action");
    if (PRIVILEGED.has(String(body.action)) && !unverifiedAllowed(deps)) {
      throw new Fail(403, "Sending and settings need a verified sign-in, which the CRM does not have yet (CR-001 decision D1). Viewing works.");
    }
    return json({ ok: true, data: await fn(deps, actor, body.payload ?? {}) });
  } catch (e) {
    if (e instanceof Fail) return json({ ok: false, error: { message: e.message } }, e.status);
    console.error("meta-capi error", e instanceof Error ? scrub(e.message, deps.token()) : "unknown");
    return json({ ok: false, error: { message: "Something went wrong" } }, 500);
  }
}
