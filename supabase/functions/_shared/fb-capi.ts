// Tells Meta a Lead Ads lead reached the CRM (Conversions API "Lead" event, matched by the
// leadgen id Meta gave us), so the form campaign can optimise for real leads. Called the moment
// fb-leads makes the lead. Same switches as the bots' events: META_CAPI_ACCESS_TOKEN must be set
// and wa_bot_settings.meta_capi_enabled (Eyad) must not be off. One report per lead: the first
// caller inserts a marker activity (id derived from the lead id) and owns the send.
// Never throws: a lead is not held up by Meta.

import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbPatch } from "./wa.ts";
import { DATASET_ID, GRAPH, classifyMeta } from "./capi-core.ts";

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
export const MARKER_ID = (leadId: string) => `capi-formlead-${leadId}`;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Meta wants identifiers normalised, then hashed: digits only with country code, lower-case names.
export async function formLeadBody(o: { leadId: string; leadgenId: string; phone: string; name: string }, token: string, nowMs: number) {
  const first = o.name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const user: Record<string, unknown> = { lead_id: o.leadgenId };
  const ph = o.phone.replace(/\D/g, "");
  if (ph) user.ph = [await sha256(ph)];
  if (first) user.fn = [await sha256(first)];
  return {
    data: [{
      event_name: "Lead", event_time: Math.floor(nowMs / 1000), event_id: o.leadId, action_source: "system_generated",
      user_data: user, custom_data: { event_source: "crm", lead_event_source: "WEPRO CRM" },
    }],
    access_token: token,
  };
}

export async function reportFormLead(o: { leadId: string; leadgenId: string; phone: string; name: string; companyId: string | null }): Promise<string> {
  const token = Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "";
  if (!token) return "off";
  const marker = MARKER_ID(o.leadId);
  try {
    const sw = (await sbSelect("wa_bot_settings?bot=eq.eyad&select=meta_capi_enabled"))[0];
    if (sw?.meta_capi_enabled === false) return "off";
    const claim = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
      method: "POST", headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ id: marker, lead_id: o.leadId, type: "NOTE", description: "Meta CAPI Lead: sending…", user_id: null, user_name: "Meta CAPI", duration_seconds: 0, timestamp: new Date().toISOString(), company_id: o.companyId }),
    });
    if (!claim.ok) return "sent";   // 409: already reported by another run
    const r = await fetch(`${GRAPH}/${DATASET_ID}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await formLeadBody(o, token, Date.now())) });
    const m = classifyMeta(r.status, await r.json().catch(() => ({})), token);
    if (m.outcome === "rejected" || m.outcome === "rate_limited") {   // nothing reached Meta: give the slot back
      await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(marker)}`, { method: "DELETE", headers: H }).catch(() => {});
      console.error("fb-capi: Lead not accepted", m.outcome, m.error_message);
      return "failed";
    }
    await sbPatch("activities", `id=eq.${encodeURIComponent(marker)}`, { description: m.outcome === "accepted" ? `Meta CAPI Lead accepted (events_received ${m.events_received})` : `Meta CAPI Lead: no clear answer (${m.outcome}); not resent` });
    return m.outcome === "accepted" ? "sent" : "unclear";
  } catch (e) { console.error("fb-capi: failed", (e instanceof Error ? e.message : "error").split(token).join("[redacted]")); return "failed"; }
}
