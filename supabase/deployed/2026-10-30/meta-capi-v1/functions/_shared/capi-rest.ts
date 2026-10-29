// The real CapiDeps for meta-capi: PostgREST with the service role (migration
// 0050's tables, view and functions) and Meta's Conversions API endpoint.
// Deno-free: fetch, env and clock are passed in, so the Node tests drive it.
import { DATASET_ID, GRAPH, type CapiDeps, type Attempt } from "./capi-core.ts";

// allowUnverified: the CAPI_ALLOW_UNVERIFIED_ACTOR value. Only "local" lets a
// browser-claimed user id run a privileged action (capi-core.ts, decision D1).
// graphBase: a local Meta stub for development (CAPI_GRAPH_BASE). Accepted only
// for a loopback or Docker-host address; anything else uses Meta itself.
type Opts = { url: string; serviceKey: string; token: () => string; fetch: typeof fetch; now: () => number; metaTimeoutMs?: number; allowUnverified?: string; graphBase?: string };
const LOCAL_STUB = /^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?$/;

const ORDER: Record<string, string> = {
  created_desc: "created_at.desc", created_asc: "created_at.asc", cutoff_asc: "cutoff_at.asc", last_attempt_desc: "last_attempt_at.desc.nullslast",
};
const LIST_COLS = "id,name,company_id,source,property_interest,created_at,has_clid,capi_status_column,cutoff_at,attempts,first_attempt_at,last_attempt_at,accepted_at,"
  + "latest_outcome,latest_http,latest_events_received,latest_error_code,latest_error_subcode,latest_error_message,latest_fbtrace_id,latest_source,event_id,status";

export function restDeps(o: Opts): CapiDeps {
  const graph = o.graphBase && LOCAL_STUB.test(o.graphBase) ? o.graphBase : GRAPH;
  const H = { apikey: o.serviceKey, Authorization: `Bearer ${o.serviceKey}`, "Content-Type": "application/json" };
  const enc = encodeURIComponent;
  const get = async (path: string, extra: Record<string, string> = {}) => {
    const r = await o.fetch(`${o.url}/rest/v1/${path}`, { headers: { ...H, ...extra } });
    if (!r.ok) throw new Error(`select ${path.split("?")[0]} failed: ${r.status}`);
    return r;
  };
  const rpc = async (fn: string, args: object) => {
    const r = await o.fetch(`${o.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`rpc ${fn} failed: ${r.status}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  return {
    now: o.now,
    token: o.token,
    allowUnverifiedActor: () => o.allowUnverified === "local",
    async user(id) { return (await (await get(`users?id=eq.${enc(id)}&select=id,role,is_active,company_id,allowed_features`)).json())[0] ?? null; },
    async lead(id) { return (await (await get(`leads?id=eq.${enc(id)}&select=id,company_id,ctwa_clid,created_at,CAPI_STATUS`)).json())[0] ?? null; },
    async page(q) {
      const p = new URLSearchParams({ select: LIST_COLS, order: ORDER[q.sort] ?? ORDER.created_desc });
      if (q.company !== null) p.append("company_id", `eq.${q.company}`);
      if (q.status !== "all") p.append("status", `eq.${q.status}`);
      // PostgREST syntax characters are dropped so a search can never add a filter.
      const s = q.search.replace(/[,()*:"\\.]/g, "").trim();
      if (s) p.append("or", `(id.ilike.*${s}*,name.ilike.*${s}*)`);
      if (q.from) p.append("created_at", `gte.${q.from}`);
      if (q.to) p.append("created_at", `lte.${q.to}`);
      const r = await get(`capi_lead_status?${p.toString()}`, { Prefer: "count=exact", Range: `${q.offset}-${q.offset + q.limit - 1}` });
      const total = Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
      return { rows: await r.json(), total };
    },
    async summary(company) { return rpc("capi_summary", { p_company: company }); },
    async history(leadId) {
      return (await get(`capi_event_attempts?lead_id=eq.${enc(leadId)}&select=*&order=attempt_no.desc`)).json();
    },
    async tryLock(leadId) { return (await rpc("capi_try_lock", { p_lead: leadId, p_source: "ui_retry", p_ttl_seconds: 120 })) === true ? leadId : null; },
    async unlock(leadId) { await rpc("capi_unlock", { p_lead: leadId }); },
    async record(a: Attempt) {
      const out = await rpc("capi_record_attempt", {
        p_lead: a.lead_id, p_event_id: a.event_id, p_source: a.source, p_actor: a.initiated_by, p_outcome: a.outcome, p_http: a.http_status,
        p_received: a.events_received, p_code: a.error_code, p_subcode: a.error_subcode, p_type: a.error_type, p_message: a.error_message,
        p_trace: a.fbtrace_id, p_response: a.meta_response, p_lock: null,
      });
      return { attempt_no: Number((Array.isArray(out) ? out[0] : out)?.attempt_no) || 0 };
    },
    async settings() { return (await (await get("capi_settings?id=eq.default&select=ui_recovery_paused,updated_at,updated_by")).json())[0] ?? { ui_recovery_paused: false }; },
    async saveSettings(s) {
      const r = await o.fetch(`${o.url}/rest/v1/capi_settings?id=eq.default`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify({ ui_recovery_paused: s.ui_recovery_paused, updated_by: s.updated_by, updated_at: new Date(o.now()).toISOString() }) });
      if (!r.ok) throw new Error(`settings update failed: ${r.status}`);
    },
    async postMeta(body) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error("timeout")), o.metaTimeoutMs ?? 20_000);
      try {
        const r = await o.fetch(`${graph}/${DATASET_ID}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
        return { status: r.status, json: await r.json().catch(() => ({})) };
      } catch (e) {
        throw new Error(ctl.signal.aborted ? "timeout: Meta did not answer in time" : `network: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
