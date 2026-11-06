// Auto-forward, the part that talks to the database and WhatsApp. The rules are in
// forward-core.ts. It follows the manual /f… tags: the wa_create_lead RPC makes the lead
// and picks the agent from wa_agents (the tag is a row there), and what a typed tag
// does around it happens here too: the pre-forward chat is put on the lead, Meta is
// told, the customer is told who their expert is.
//
// Two callers: wa-followup (Eyad contacts, 5 minutes after the first message) and the
// Facebook form intake (a form set to "forward", the moment the form is answered).
// Dubai forwards in its own bot, the moment a contact writes, and tells nobody.

import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbPatch, claimEvent, getBotSettings, sendWaMessageMirrored, resolveTarget, logConversationHistory } from "./wa.ts";
import { DATASET_ID, GRAPH, eventBody, classifyMeta } from "./capi-core.ts";
import { assignedText, dueQuery, hasDialableNumber, routeFor, shouldTell, BATCH, DUBAI_TAG } from "./forward-core.ts";

const COMPANY = "c1";
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ForwardedLead = {
  status?: string; lead_id?: string; first_name?: string; agent_name?: string; agent_phone?: string; notify?: boolean; ctwa_clid?: string;
};

// An RPC and the JSON it answers (wa.ts's sbRpc only says whether it worked); null if it failed.
export async function rpcJson(fn: string, args: Record<string, unknown>): Promise<any | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(args) });
    if (!r.ok) { console.error(`forward: ${fn} failed`, r.status, (await r.text()).slice(0, 200)); return null; }
    const body = await r.json();
    return Array.isArray(body) ? body[0] ?? null : body;
  } catch (e) { console.error(`forward: ${fn} threw`, e instanceof Error ? e.message : e); return null; }
}

// Make the lead for `phone` and give it to the agent the tag stands for ("/fctg": the Chattogram pool).
export const createLeadByTag = (phone: string, tag: string, company = COMPANY): Promise<ForwardedLead | null> =>
  rpcJson("wa_create_lead", { p_phone: phone, p_cmd: tag, p_company_id: company });

// "Your expert is …", from the Eyad number. Wasender takes one message per 5 seconds, so a
// refusal is tried once more after that. Never throws: the lead exists either way.
export async function tellCustomer(phone: string, lead: ForwardedLead): Promise<boolean> {
  try {
    const { to, remote } = await resolveTarget("eyad", phone);
    const msg = { type: "text" as const, text: assignedText(lead.first_name ?? "", lead.agent_name ?? "", lead.agent_phone ?? "") };
    if (await sendWaMessageMirrored("eyad", to, `eyad:${remote}`, phone, msg)) return true;
    await sleep(5500);
    return await sendWaMessageMirrored("eyad", to, `eyad:${remote}`, phone, msg);
  } catch (e) { console.error("forward: could not message the customer", e instanceof Error ? e.message : e); return false; }
}

// The Meta event a tagged lead from an ad gets (the same body the bots send). Not retried: the
// scheduled CAPI sweep picks up a lead that did not get through.
export async function reportLeadSubmitted(leadId: string, ctwaClid: string): Promise<void> {
  const token = Deno.env.get("META_CAPI_ACCESS_TOKEN") ?? "";
  if (!token || !leadId || !ctwaClid) return;
  try {
    const r = await fetch(`${GRAPH}/${DATASET_ID}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(eventBody({ id: leadId, ctwa_clid: ctwaClid }, token, Date.now())) });
    const m = classifyMeta(r.status, await r.json().catch(() => ({})), token);
    if (m.outcome === "accepted") await sbPatch("leads", `id=eq.${encodeURIComponent(leadId)}`, { CAPI_STATUS: "LeadSubmitted" });
    else console.error("forward: LeadSubmitted not accepted", m.outcome, m.error_message);
  } catch (e) { console.error("forward: LeadSubmitted failed", (e instanceof Error ? e.message : "error").split(token).join("[redacted]")); }
}

const releaseClaim = (id: string) =>
  fetch(`${SUPABASE_URL}/rest/v1/wa_webhook_events?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: H }).catch(() => {});

// Eyad contacts that have gone 5 minutes without a human: forward each (routeFor: /fctg, or /fdu for a foreign number) and, for /fctg, tell them.
// Run by wa-followup every couple of minutes; returns how many were forwarded this run.
//
// Off unless Admin > Bots > Eyad > Auto forward is on (a test number is always on, like every
// other switch). One try per contact, ever: the claim is made before the RPC, so a second run
// or a second copy of this one finds it taken. Only a failure that left nothing behind (the
// RPC could not be reached) gives the claim back.
export async function forwardDueContacts(nowMs = Date.now()): Promise<number> {
  const due = await sbSelect(dueQuery(nowMs));
  let done = 0;
  for (const row of due) {
    if (done >= BATCH) break;
    const tag = routeFor(row);
    if (!tag) continue;                                     // Dhaka / Cumilla: their own agents
    const settings = await getBotSettings("eyad", row.phone);
    if (!settings.autoForwardEnabled) continue;
    const { remote } = await resolveTarget("eyad", row.phone);
    if (!hasDialableNumber(row.phone, remote)) continue;   // a hidden number: a person picks it up

    const claimId = `autofwd:${row.id}`;
    if (!(await claimEvent(claimId, "auto_forward"))) continue;
    const lead = await createLeadByTag(row.phone, tag);
    if (!lead) { await releaseClaim(claimId); continue; }
    console.log("auto-forward", { prelead: row.id, phone: row.phone, tag, status: lead.status });
    if (lead.status !== "created" || !lead.lead_id) continue;   // already a lead / no agent free / unknown tag: nothing new was made

    const id = String(lead.lead_id);
    await logConversationHistory(id, COMPANY, row.phone, "Eyad Bot (auto-forward)");
    if (row.region) await sbPatch("leads", `id=eq.${encodeURIComponent(id)}`, { region: row.region });
    if (settings.metaCapiEnabled && lead.ctwa_clid) await reportLeadSubmitted(id, lead.ctwa_clid);
    if (tag !== DUBAI_TAG && shouldTell(lead, settings.customerNotifyEnabled)) { await tellCustomer(row.phone, lead); await sleep(5500); }
    done++;
  }
  return done;
}
