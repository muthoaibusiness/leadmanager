// Facebook Lead Ads intake, the part that talks to Meta and the database. The
// rules are in fb-leads-core.ts; the settings are what Admin > Facebook Leads saves
// (migration 0059). Called once per `leadgen` change in a Meta webhook.
//
// Every lead is claimed first (fb_lead_events.leadgen_id is the key), so Meta
// delivering the same lead twice, or two copies of this function running, create
// one lead. What happened to each one is written back to that row, which is what
// the page's "Received" tab shows.

import { SUPABASE_URL, SERVICE_KEY, sbSelect, sbUpsert, sbPatch, getBotSettings } from "./wa.ts";
import { samePhone } from "./phone.ts";
import { GRAPH } from "./capi-core.ts";
import { mapAnswers, pickAssignee, summarizeAnswers, fieldMapOf, type Change, type FieldData } from "./fb-leads-core.ts";
import { rpcJson, createLeadByTag, tellCustomer } from "./forward.ts";
import { shouldTell, tagFor, DUBAI_TAG } from "./forward-core.ts";
import { reportFormLead } from "./fb-capi.ts";

type Row = Record<string, any>;
export type Outcome = { leadgen_id: string; status: "created" | "duplicate" | "skipped" | "failed" | "repeat"; lead_id?: string; error?: string };

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const rest = (path: string, method: string, body?: unknown, prefer = "return=minimal") =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...H, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
const rid = (p: string) => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

async function finish(id: string, status: string, extra: Row = {}) {
  await rest(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}`, "PATCH", { status, processed_at: new Date().toISOString(), ...extra });
}

// `replay`: a lead Meta delivered while intake was off or the form was not set up (skipped) is
// taken again, which a live webhook delivery never does.
// What happened to the lead, for the Received tab (migration 0062). A column that is not there yet only loses the chips.
const keepState = (id: string, st: Row) => rest(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}`, "PATCH", st).catch(() => {});

export async function processLeadgen(c: Change, opts: { replay?: boolean } = {}): Promise<Outcome> {
  const id = c.leadgen_id;
  const settings = (await sbSelect("fb_lead_settings?id=eq.default&select=*"))[0] ?? {};
  const company = settings.company_id ?? "c1";

  // Claim it. A repeat is dropped, unless the first try ended in failure or never finished.
  const claim = await rest("fb_lead_events", "POST", { leadgen_id: id, form_id: c.form_id || null, page_id: c.page_id || null, company_id: company, status: "received" });
  if (!claim.ok) {
    if (claim.status !== 409) return { leadgen_id: id, status: "failed", error: `could not record the lead (${claim.status})` };
    const prev = (await sbSelect(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}&select=status,received_at`))[0];
    const stale = prev?.status === "received" && Date.now() - Date.parse(prev.received_at) > 2 * 60_000;
    if (!(prev?.status === "failed" || stale || (opts.replay && prev?.status === "skipped"))) return { leadgen_id: id, status: "repeat" };
    await rest(`fb_lead_events?leadgen_id=eq.${encodeURIComponent(id)}`, "PATCH", { status: "received", error: null });
  }

  const skip = async (why: string): Promise<Outcome> => { await finish(id, "skipped", { error: why }); return { leadgen_id: id, status: "skipped", error: why }; };
  const fail = async (why: string): Promise<Outcome> => { await finish(id, "failed", { error: why.slice(0, 300) }); return { leadgen_id: id, status: "failed", error: why }; };

  if (settings.enabled !== true) return skip("Facebook intake is switched off");
  if (settings.page_id && c.page_id && String(settings.page_id) !== c.page_id) return skip(`another Page (${c.page_id})`);
  // A form nobody set up in Admin is still received: a lead must never be lost because a form was
  // made on Facebook first. It lands unassigned with the standard question keys; a manager hands it out.
  const row = (await sbSelect(`fb_lead_forms?form_id=eq.${encodeURIComponent(c.form_id)}&select=*&limit=1`))[0];
  const form = row ?? { label: `Facebook form ${c.form_id || "?"} (not set up in Admin)`, active: true, project: "", source: "META_ADS", assign_mode: "none", field_map: {} };
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

  // Forward: the lead takes the route a typed /f… tag takes in WhatsApp (wa_create_lead makes it
  // and picks the agent from wa_agents; the customer is told who their expert is). If that gives
  // nothing (no agent free, an unknown tag) the lead is still made below, unassigned, with the
  // reason on it: a Facebook lead is never dropped.
  const forward = async (): Promise<Outcome | string> => {
    const wanted = String(form.forward_tag || "/fctg").trim().toLowerCase();
    const tag = tagFor(m.phone, wanted);   // a foreign number goes to Dubai, whatever the form says
    const toDubai = tag === DUBAI_TAG && wanted !== DUBAI_TAG;
    // wa_create_lead builds the lead from the contact's prelead (name, number), so there must be one.
    const pre = await rpcJson("wa_upsert_prelead", { p_phone: m.phone, p_name: m.name, p_message: `Facebook form: ${label}`, p_ad_text: "", p_ctwa_clid: "", p_location: m.city });
    if (!pre?.id) return "the contact could not be prepared for forwarding";
    const res = await createLeadByTag(m.phone, tag, company);
    if (!res) return `the ${tag} forward did not answer`;
    if (res.status === "exists" && res.lead_id) {
      await note(String(res.lead_id), `Facebook form answered again (${label}):\n${answersText}`);
      await finish(id, "duplicate", { lead_id: String(res.lead_id) });
      return { leadgen_id: id, status: "duplicate", lead_id: String(res.lead_id) };
    }
    if (res.status !== "created" || !res.lead_id) {
      return res.status === "no_agent_available" ? `no agent is free for ${tag}`
        : res.status === "unknown_command" ? `${tag} is not a forward tag`
        : `${tag} could not forward (${res.status ?? "no answer"})`;
    }
    const leadId = String(res.lead_id);
    // What the form knows and the WhatsApp contact does not.
    const patch: Row = { source: form.source || "META_ADS" };
    for (const [k, v] of Object.entries({ email: m.email, budget: m.budget, profession: m.profession, city: m.city, property_interest: form.project })) if (v) patch[k] = v;
    const want = form.status || settings.default_status || "NEW";
    if (want !== "NEW") patch.status = want;
    await sbPatch("leads", `id=eq.${encodeURIComponent(leadId)}`, patch);
    // An agent owns this customer now: the bot's "want a dedicated agent?" steps stay quiet.
    await sbPatch("preleads", `id=eq.${encodeURIComponent(String(pre.id))}`, { flow_stage: "agent_assigned", stage_at: now });
    let told = toDubai ? " Foreign number: sent to the Dubai pool, the customer is not messaged." : "", msg = "skipped";
    if (form.notify_customer !== false && !toDubai) {
      const bot = await getBotSettings("eyad", m.phone);
      if (!shouldTell(res, bot.customerNotifyEnabled)) { told = " The customer was not messaged (that notice is off, or this agent's row says not to)."; msg = "off"; }
      else if (await tellCustomer(m.phone, res)) { told = " The customer was messaged on WhatsApp."; msg = "sent"; }
      else { told = " The customer could not be messaged on WhatsApp."; msg = "failed"; }
    }
    await sbUpsert("activities", [{ id: crypto.randomUUID(), lead_id: leadId, type: "CREATED", description: `Lead created from Facebook form: ${label}`, user_id: null, user_name: "Facebook Leads", duration_seconds: 0, timestamp: now, company_id: company }]);
    await note(leadId, `Facebook form answers (${label}):\n${answersText}\n\nForwarded with ${tag}${res.agent_name ? ` to ${res.agent_name}` : ""}.${told}`);
    const capi = await reportFormLead({ leadId, leadgenId: id, phone: m.phone, name: m.name, companyId: company });
    await finish(id, "created", { lead_id: leadId });
    await keepState(id, { agent_name: res.agent_name ?? null, forward_tag: tag, customer_msg: msg, capi });
    return { leadgen_id: id, status: "created", lead_id: leadId };
  };
  let missed = "";
  if (form.assign_mode === "forward") {
    const fwd = await forward();
    if (typeof fwd !== "string") return fwd;
    missed = fwd;
  }

  const made = (await sbSelect(`fb_lead_events?form_id=eq.${encodeURIComponent(c.form_id)}&status=eq.created&select=leadgen_id&limit=1000`)).length;
  const who = form.assign_mode === "forward" ? { user: null, why: missed } : pickAssignee(form, users, made);
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
  const capi = await reportFormLead({ leadId, leadgenId: id, phone: m.phone, name: m.name, companyId: company });
  // A forward that found nobody leaves the reason on the Received tab, where it can be seen.
  await finish(id, "created", { lead_id: leadId, ...(missed ? { error: `Not forwarded: ${missed}` } : {}) });
  await keepState(id, { agent_name: who.user?.name ?? null, forward_tag: "", customer_msg: "", capi });
  return { leadgen_id: id, status: "created", lead_id: leadId };
}
