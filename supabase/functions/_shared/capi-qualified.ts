// Reports a lead that became Interested to Meta as QualifiedLead, the moment it
// happens: called by the CRM right after the status change (functions/
// capi-qualified) and by the follow-up cron as a safety net.
//
// Same switches as the bots' LeadSubmitted: the lead's bot must have
// wa_bot_settings.meta_capi_enabled on, and META_CAPI_ACCESS_TOKEN must be set.
// One report per lead: the first caller inserts a marker activity (its id is
// derived from the lead id) and owns the send; everyone else finds it and stops.

import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbPatch } from "./wa.ts";
import { DATASET_ID, GRAPH, classifyMeta } from "./capi-core.ts";
import { qualifiedEligibility, qualifiedBody, afterAnswer, QUALIFIED_MARKER_ID, QUALIFIED_EVENT } from "./capi-qualified-core.ts";

export type QualifiedResult = { status: "sent" | "unclear" | "skipped" | "already" | "failed"; reason?: string };

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function claim(leadId: string, companyId: string | null): Promise<"won" | "taken" | "error"> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
    method: "POST", headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({
      id: QUALIFIED_MARKER_ID(leadId), lead_id: leadId, type: "NOTE", description: `Meta CAPI ${QUALIFIED_EVENT}: sending…`,
      user_id: null, user_name: "Meta CAPI", duration_seconds: 0, timestamp: new Date().toISOString(), company_id: companyId,
    }),
  });
  if (r.ok) return "won";
  if (r.status === 409) return "taken";
  console.error("capi-qualified claim failed", r.status, await r.text());
  return "error";
}
const release = (leadId: string) =>
  fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(QUALIFIED_MARKER_ID(leadId))}`, { method: "DELETE", headers: H }).catch(() => {});
const note = (leadId: string, text: string) => sbPatch("activities", `id=eq.${encodeURIComponent(QUALIFIED_MARKER_ID(leadId))}`, { description: text });

export async function sendQualifiedLead(leadId: string): Promise<QualifiedResult> {
  const token = Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "";
  if (!token) return { status: "skipped", reason: "Meta token not configured" };
  const lead = (await sbSelect(`leads?id=eq.${encodeURIComponent(leadId)}&select=id,phone,status,ctwa_clid,created_at,company_id`))[0];
  const ok = qualifiedEligibility(lead, Date.now());
  if (ok !== "eligible") return { status: "skipped", reason: ok };

  // The bot that owns this customer decides whether Meta reporting is on.
  const tail = String(lead.phone || "").replace(/\D/g, "").slice(-10);
  const prelead = tail.length >= 8 ? (await sbSelect(`preleads?phone=like.*${tail}&select=WA&order=created_at.desc&limit=1`))[0] : null;
  const bot = prelead?.WA === "Jaber" ? "dubai" : "eyad";
  const sw = (await sbSelect(`wa_bot_settings?bot=eq.${bot}&select=meta_capi_enabled`))[0];
  if (sw?.meta_capi_enabled === false) return { status: "skipped", reason: `Meta CAPI is off for ${bot}` };

  const won = await claim(leadId, lead.company_id ?? null);
  if (won === "taken") return { status: "already" };
  if (won === "error") return { status: "failed", reason: "could not reserve the report" };

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error("timeout")), 20_000);
    let res: { status: number; json: Record<string, any> };
    try {
      const r = await fetch(`${GRAPH}/${DATASET_ID}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qualifiedBody(lead, token, Date.now())), signal: ctl.signal });
      res = { status: r.status, json: await r.json().catch(() => ({})) };
    } finally { clearTimeout(timer); }
    const m = classifyMeta(res.status, res.json, token);
    const next = afterAnswer(m.outcome);
    if (next === "retry") { await release(leadId); return { status: "failed", reason: m.error_message || `Meta answered ${res.status}` }; }
    if (next === "accepted") { await note(leadId, `Meta CAPI ${QUALIFIED_EVENT} accepted (events_received ${m.events_received}${m.fbtrace_id ? `, trace ${m.fbtrace_id}` : ""})`); return { status: "sent" }; }
    await note(leadId, `Meta CAPI ${QUALIFIED_EVENT}: no clear answer (${m.outcome}); not resent`);
    return { status: "unclear", reason: m.outcome };
  } catch (e) {
    // No answer at all: Meta may have the event, so the marker stays and it is not resent.
    const msg = (e instanceof Error ? e.message : String(e)).split(token).join("[redacted]").slice(0, 200);
    await note(leadId, `Meta CAPI ${QUALIFIED_EVENT}: no answer (${msg}); not resent`);
    return { status: "unclear", reason: msg };
  }
}

// Leads that went Interested in the last `minutes` and are still there.
export async function recentlyInterestedLeadIds(minutes = 30): Promise<string[]> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const rows = await sbSelect(`activities?type=eq.STATUS_CHANGE&description=eq.${encodeURIComponent("Status → Interested")}&timestamp=gte.${encodeURIComponent(since)}&select=lead_id&limit=200`);
  return [...new Set(rows.map((r) => String(r.lead_id)))];
}
