// Sends the Mela invitation card to one Citizen Avenue lead on WhatsApp. Called
// right after the CRM moves a lead to Contacted (functions/mela-invite) and by the
// follow-up cron as a safety net for status changes made elsewhere.
//
// One invitation per lead, ever: the first caller to insert the marker activity
// (its id is derived from the lead id) owns the send; every other call finds the
// row already there and does nothing. A failed send removes the marker so the next
// call can try again.

import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbPatch, sendWaMessageMirroredId } from "./wa.ts";
import { normPhone } from "./phone.ts";
import { MELA_CARD_URL, MELA_INVITE_ID, MELA_SENT_PREFIX, isCitizenLead, pickContact, melaInviteText } from "./mela.ts";

export type InviteResult = { status: "sent" | "skipped" | "already" | "failed"; reason?: string };

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function claim(leadId: string, companyId: string | null): Promise<"won" | "taken" | "error"> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/activities`, {
    method: "POST",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({
      id: MELA_INVITE_ID(leadId), lead_id: leadId, type: "NOTE", description: "Mela invitation: sending…",
      user_id: null, user_name: "Mela Bot", duration_seconds: 0, timestamp: new Date().toISOString(), company_id: companyId,
    }),
  });
  if (r.ok) return "won";
  if (r.status === 409) return "taken";
  console.error("mela claim failed", r.status, await r.text());
  return "error";
}

const release = (leadId: string) =>
  fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${encodeURIComponent(MELA_INVITE_ID(leadId))}`, { method: "DELETE", headers: H }).catch(() => {});

export async function inviteLead(leadId: string): Promise<InviteResult> {
  const lead = (await sbSelect(`leads?id=eq.${encodeURIComponent(leadId)}&select=id,name,phone,status,property_interest,assigned_to,team_id,company_id`))[0];
  if (!lead) return { status: "skipped", reason: "no such lead" };
  if (!isCitizenLead(lead)) return { status: "skipped", reason: "not a Citizen Avenue lead" };
  if (lead.status !== "CONTACTED") return { status: "skipped", reason: "status is not Contacted" };
  const to = normPhone(lead.phone);
  if (!to) return { status: "skipped", reason: "no usable phone" };

  const won = await claim(leadId, lead.company_id ?? null);
  if (won === "taken") return { status: "already" };
  if (won === "error") return { status: "failed", reason: "could not reserve the invitation" };

  try {
    const tail = to.slice(-10);
    const [users, conv, prelead] = await Promise.all([
      sbSelect("users?select=id,name,role,team_id,phone,is_active&or=(role.eq.TEAM_LEAD,id.eq." + encodeURIComponent(String(lead.assigned_to || "")) + ")"),
      sbSelect(`wa_conversations?phone=like.*${tail}&order=last_message_at.desc.nullslast&select=id,account,phone&limit=1`),
      sbSelect(`preleads?phone=like.*${tail}&select=WA&order=created_at.desc&limit=1`),
    ]);
    const account = conv[0]?.account ?? (prelead[0]?.WA === "Jaber" ? "dubai" : "eyad");
    const convId = conv[0]?.id ?? `${account}:${to}@s.whatsapp.net`;
    const contact = pickContact(lead, users);
    const id = await sendWaMessageMirroredId(account, to, convId, to, { type: "image", text: melaInviteText(contact), mediaUrl: MELA_CARD_URL, fileName: "mela-invitation.png" },
      { senderName: "AI Agent", storeWaId: true });
    if (id === null) { await release(leadId); return { status: "failed", reason: "WhatsApp send failed" }; }
    await sbPatch("activities", `id=eq.${encodeURIComponent(MELA_INVITE_ID(leadId))}`, {
      description: `${MELA_SENT_PREFIX} on WhatsApp${contact ? ` — contact shown: ${contact.name}` : ""}`,
    });
    return { status: "sent" };
  } catch (e) {
    console.error("mela invite failed", e);
    await release(leadId);
    return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
  }
}

// Leads that went to Contacted in the last `minutes` and are still there: what the
// cron retries. Older ones are left alone, so switching this on never invites the
// people contacted before it existed.
export async function recentlyContactedLeadIds(minutes = 30): Promise<string[]> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const rows = await sbSelect(`activities?type=eq.STATUS_CHANGE&description=eq.${encodeURIComponent("Status → Contacted")}&timestamp=gte.${encodeURIComponent(since)}&select=lead_id&limit=200`);
  return [...new Set(rows.map((r) => String(r.lead_id)))];
}
