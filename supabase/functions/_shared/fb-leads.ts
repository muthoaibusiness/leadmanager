// Facebook Lead Ads intake, the part that talks to Meta and the database. The
// rules are in fb-leads-core.ts; the settings are what Admin > Facebook Leads saves
// (migration 0059). Called once per `leadgen` change in a Meta webhook.
//
// Every lead is claimed first (fb_lead_events.leadgen_id is the key), so Meta
// delivering the same lead twice, or two copies of this function running, create
// one lead. What happened to each one is written back to that row, which is what
// the page's "Received" tab shows.

import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbUpsert } from "./wa.ts";
import { samePhone } from "./phone.ts";
import { GRAPH } from "./capi-core.ts";
import { mapAnswers, pickAssignee, summarizeAnswers, fieldMapOf, type Change, type FieldData } from "./fb-leads-core.ts";

type Row = Record<string, any>;
export type Outcome = { leadgen_id: string; status: "created" | "duplicate" | "skipped" | "failed" | "repeat"; lead_id?: string; error?: string };

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const rest = (path: string, method: string, body?: unknown, prefer = "return=minimal") =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...H, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
const rid = (p: string) => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

async function finish(id: string, status: string, extra: Row = {}) {
  await rest(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}`, "PATCH", { status, processed_at: new Date().toISOString(), ...extra });
}

export async function processLeadgen(c: Change): Promise<Outcome> {
  const id = c.leadgen_id;
  const settings = (await sbSelect("fb_lead_settings?id=eq.default&select=*"))[0] ?? {};
  const company = settings.company_id ?? "c1";

  // Claim it. A repeat is dropped, unless the first try ended in failure or never finished.
  const claim = await rest("fb_lead_events", "POST", { leadgen_id: id, form_id: c.form_id || null, page_id: c.page_id || null, company_id: company, status: "received" });
  if (!claim.ok) {
    if (claim.status !== 409) return { leadgen_id: id, status: "failed", error: `could not record the lead (${claim.status})` };
    const prev = (await sbSelect(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}&select=status,received_at`))[0];
    const stale = prev?.status === "received" && Date.now() - Date.parse(prev.received_at) > 2 * 60_000;
    if (!(prev?.status === "failed" || stale)) return { leadgen_id: id, status: "repeat" };
    await rest(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}`, "PATCH", { status: "received", error: null });
  }

  const skip = async (why: string): Promise<Outcome> => { await finish(id, "skipped", { error: why }); return { leadgen_id: id, status: "skipped", error: why }; };
  const fail = async (why: string): Promise<Outcome> => { await finish(id, "failed", { error: why.slice(0, 300) }); return { leadgen_id: id, status: "failed", error: why }; };

  if (settings.enabled !== true) return skip("Facebook intake is switched off");
  if (settings.page_id && c.page_id && String(settings.page_id) !== c.page_id) return skip(`another Page (${c.page_id})`);
  const form = (await sbSelect(`fb_lead_forms?form_id=eq.${encodeURIComponent(c.form_id)}&select=*&limit=1`))[0];
  if (!form) return skip(`form ${c.form_id || "?"} is not set up`);
  if (form.active === false) return skip(`form "${form.label}" is switched off`);

  const token = Deno.env.get("FB_PAGE_ACCESS_TOKEN") ?? "";
  if (!token) return fail("FB_PAGE_ACCESS_TOKEN is not set");
  let fd: FieldData;
  try {
    const r = await fetch(`${GRAPH}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return fail(`Facebook refused the lead (${r.status}): ${String(j?.error?.message ?? "").split(token).join("[redacted]").slice(0, 200)}`);
    fd = Array.isArray(j.field_data) ? j.field_data : [];
  } catch (e) { return fail(`could not reach Facebook: ${e instanceof Error ? e.message.split(token).join("[redacted]") : "error"}`); }

  const m = mapAnswers(fd, fieldMapOf(form));
  // The questions Facebook sent are named (names only, never the answers) so the
  // mapping can be fixed from the Received tab.
  if (!m.phone) return fail(`the answers have no phone number: check which question fills Phone. The form sent: ${fd.map((f) => f.name).join(", ").slice(0, 200) || "no questions"}`);
  const now = new Date().toISOString();
  const answersText = summarizeAnswers(m.answers);
  const label = form.label || `form ${c.form_id}`;

  const users = await sbSelect(`users?select=id,name,role,team_id,is_active&company_id=eq.${encodeURIComponent(company)}`);
  const notify = async (userId: string | null, message: string, leadId: string) => {
    if (settings.notify_agent === false || !userId) return;
    await sbUpsert("notifications", [{ id: rid("n"), user_id: userId, type: "ASSIGNED", message, lead_id: leadId, is_read: false, created_at: now, company_id: company }]);
  };
  const note = (leadId: string, text: string) =>
    sbUpsert("activities", [{ id: crypto.randomUUID(), lead_id: leadId, type: "NOTE", description: text, user_id: null, user_name: "Facebook Leads", duration_seconds: 0, timestamp: now, company_id: company }]);

  // The same phone is already a lead.
  const tail = m.phone.slice(-9);
  const same = (await sbSelect(`leads?phone=like.*${tail}&select=id,name,phone,assigned_to&limit=20`)).find((l) => samePhone(l.phone, m.phone));
  const policy = settings.duplicate_policy ?? "note";
  if (same && policy === "skip") { await finish(id, "skipped", { lead_id: same.id, error: "this phone is already a lead" }); return { leadgen_id: id, status: "skipped", lead_id: same.id }; }
  if (same && policy === "note") {
    await note(same.id, `Facebook form answered again (${label}):\n${answersText}`);
    await notify(same.assigned_to ?? null, `${same.name} answered a Facebook form again`, same.id);
    await finish(id, "duplicate", { lead_id: same.id });
    return { leadgen_id: id, status: "duplicate", lead_id: same.id };
  }

  const made = (await sbSelect(`fb_lead_events?form_id=eq.${encodeURIComponent(c.form_id)}&status=eq.created&select=leadgen_id&limit=1000`)).length;
  const who = pickAssignee(form, users, made);
  const leadId = rid("l");
  const ins = await rest("leads", "POST", {
    id: leadId, name: m.name, phone: m.phone, email: m.email, company: "—", source: form.source || "META_ADS",
    status: form.status || settings.default_status || "NEW",
    assigned_to: who.user?.id ?? null, assigned_to_name: who.user?.name ?? null, assigned_role: who.user?.role ?? null, team_id: who.user?.team_id ?? null,
    previous_assignees: [], property_interest: form.project || "", budget: m.budget, profession: m.profession, city: m.city, deal_value: 0,
    call_count: 0, sms_count: 0, whatsapp_count: 0, visit_count: 0, created_at: now, updated_at: now, company_id: company,
  });
  if (!ins.ok) return fail(`could not create the lead (${ins.status}): ${(await ins.text()).slice(0, 200)}`);

  await sbUpsert("activities", [{ id: crypto.randomUUID(), lead_id: leadId, type: "CREATED", description: `Lead created from Facebook form: ${label}`, user_id: null, user_name: "Facebook Leads", duration_seconds: 0, timestamp: now, company_id: company }]);
  await note(leadId, `Facebook form answers (${label}):\n${answersText}${who.user ? "" : `\n\nNot assigned: ${who.why}.`}`);
  await notify(who.user?.id ?? null, `New Facebook lead: ${m.name}`, leadId);
  await finish(id, "created", { lead_id: leadId });
  return { leadgen_id: id, status: "created", lead_id: leadId };
}
