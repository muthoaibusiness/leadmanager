// node --test: a Facebook form set to "forward" (processLeadgen in fb-leads.ts), run against a
// fake PostgREST / Graph / Wasender. Nothing here is live: the point is the order of the steps,
// what is written where, and when the customer is (and is not) messaged.
import { test } from "node:test";
import assert from "node:assert/strict";

const ENV: Record<string, string> = { SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "svc", FB_PAGE_ACCESS_TOKEN: "page-token", META_CAPI_ACCESS_TOKEN: "capi-token" };
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };   // wa.ts reads Deno.env when it is imported
const { processLeadgen } = await import("./fb-leads.ts");

const CHANGE = { leadgen_id: "444", form_id: "555", page_id: "104718884272119" };
const ANSWERS = [
  { name: "full_name", values: ["Rahim Uddin"] }, { name: "phone_number", values: ["01712345678"] },
  { name: "email", values: ["r@x.com"] }, { name: "city", values: ["Chattogram"] },
];
const CREATED = { status: "created", lead_id: "L-1", first_name: "Rahim", agent_name: "Karim", agent_phone: "8801711000000", notify: true };

type Call = { method: string; url: string; body: any };
function world(o: { form?: any; createLead?: any; botNotify?: boolean } = {}) {
  const calls: Call[] = [];
  const form = { form_id: "555", label: "Citizen form", active: true, project: "Wecon Citizen Avenue", source: "META_ADS", status: null,
    assign_mode: "forward", forward_tag: "/fctg", notify_customer: true, field_map: {}, ...o.form };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = String(input), method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/events")) return json({ events_received: 1 });
    if (url.startsWith("https://graph.facebook.com/")) return json({ field_data: ANSWERS });
    if (url.endsWith("/send-message")) return json({ success: true, data: { msgId: "w1" } });
    const path = url.replace("https://sb.test/rest/v1/", "");
    if (path.startsWith("rpc/wa_upsert_prelead")) return json({ id: "pre-1" });
    if (path.startsWith("rpc/wa_create_lead")) return o.createLead === "down" ? new Response("boom", { status: 500 }) : json(o.createLead ?? CREATED);
    if (method !== "GET") return new Response(null, { status: method === "PATCH" ? 204 : 201 });
    if (path.startsWith("fb_lead_settings")) return json([{ enabled: true, page_id: "104718884272119", company_id: "c1", default_status: "NEW", duplicate_policy: "note", notify_agent: true }]);
    if (path.startsWith("fb_lead_forms")) return json([form]);
    if (path.startsWith("wa_bot_settings")) return json([{ bot: "eyad", customer_notify_enabled: o.botNotify !== false }]);
    if (path.startsWith("wa_secrets")) return json([{ id: "eyad", api_token: "tok", webhook_secret: "" }]);
    return json([]);   // users, leads by phone, events made, wa_settings, wa_conversations: none
  };
  return calls;
}
const sent = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/send-message"));
const notes = (calls: Call[]) => calls.filter((c) => c.url.includes("/activities?")).flatMap((c) => c.body);
const finishOf = (calls: Call[]) => calls.find((c) => c.method === "PATCH" && c.url.includes("fb_lead_events?leadgen_id=eq.444"))?.body;
const directInsert = (calls: Call[]) => calls.find((c) => c.method === "POST" && c.url.endsWith("/rest/v1/leads"));

test("forward: the lead goes through wa_create_lead, gets the form's fields, and the customer is told", async () => {
  const calls = world();
  assert.deepEqual(await processLeadgen(CHANGE), { leadgen_id: "444", status: "created", lead_id: "L-1" });

  assert.deepEqual(calls.find((c) => c.url.endsWith("rpc/wa_create_lead"))!.body, { p_phone: "8801712345678", p_cmd: "/fctg", p_company_id: "c1" });
  const pre = calls.find((c) => c.url.endsWith("rpc/wa_upsert_prelead"))!.body;
  assert.equal(pre.p_phone, "8801712345678");
  assert.equal(pre.p_name, "Rahim Uddin");
  assert.equal(directInsert(calls), undefined);   // the RPC made the lead; no second one

  assert.deepEqual(calls.find((c) => c.method === "PATCH" && c.url.includes("/leads?id=eq.L-1"))!.body,
    { source: "META_ADS", email: "r@x.com", city: "Chattogram", property_interest: "Wecon Citizen Avenue" });
  assert.equal(calls.find((c) => c.method === "PATCH" && c.url.includes("/preleads?id=eq.pre-1"))!.body.flow_stage, "agent_assigned");

  const msgs = sent(calls);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body.to, "8801712345678");
  assert.ok(msgs[0].body.text.startsWith("প্রিয় Rahim,") && msgs[0].body.text.includes("Karim") && msgs[0].body.text.includes("8801711000000"));
  // the message lands in the phone-JID thread, where the customer's reply will also land
  assert.equal(calls.find((c) => c.url.includes("wa_conversations?on_conflict"))!.body[0].id, "eyad:8801712345678@s.whatsapp.net");

  const all = notes(calls);
  assert.ok(all.some((a: any) => a.type === "CREATED" && a.lead_id === "L-1"));
  const note = all.find((a: any) => a.type === "NOTE")!;
  assert.ok(note.description.includes("full name: Rahim Uddin"));
  assert.ok(note.description.includes("Forwarded with /fctg to Karim."));
  assert.ok(note.description.includes("The customer was messaged on WhatsApp."));
  assert.deepEqual({ status: finishOf(calls).status, lead_id: finishOf(calls).lead_id, error: finishOf(calls).error }, { status: "created", lead_id: "L-1", error: undefined });
});

test("forward with 'message the customer' off: forwarded, nobody messaged", async () => {
  const calls = world({ form: { notify_customer: false } });
  assert.equal((await processLeadgen(CHANGE)).status, "created");
  assert.equal(sent(calls).length, 0);
  assert.ok(notes(calls).find((a: any) => a.type === "NOTE")!.description.endsWith("Forwarded with /fctg to Karim."));
});

test("forward with the Eyad bot's customer notice off, or the agent's row saying no: forwarded, nobody messaged", async () => {
  let calls = world({ botNotify: false });
  assert.equal((await processLeadgen(CHANGE)).status, "created");
  assert.equal(sent(calls).length, 0);
  assert.ok(notes(calls).find((a: any) => a.type === "NOTE")!.description.includes("The customer was not messaged"));

  calls = world({ createLead: { ...CREATED, notify: false } });
  assert.equal((await processLeadgen({ ...CHANGE, leadgen_id: "445" })).status, "created");
  assert.equal(sent(calls).length, 0);
});

test("forward finds no agent: the lead is still made, unassigned, with the reason where it can be seen", async () => {
  const calls = world({ createLead: { status: "no_agent_available" } });
  const out = await processLeadgen(CHANGE);
  assert.equal(out.status, "created");
  const ins = directInsert(calls)!.body;
  assert.equal(ins.assigned_to, null);
  assert.equal(ins.phone, "8801712345678");
  assert.equal(ins.property_interest, "Wecon Citizen Avenue");
  assert.equal(sent(calls).length, 0);                                                 // nobody was assigned, so nobody is announced
  assert.ok(notes(calls).find((a: any) => a.type === "NOTE")!.description.includes("Not assigned: no agent is free for /fctg."));
  assert.equal(finishOf(calls).error, "Not forwarded: no agent is free for /fctg");
});

test("forward when the route does not answer: the lead is still made", async () => {
  const calls = world({ createLead: "down" });
  assert.equal((await processLeadgen(CHANGE)).status, "created");
  assert.ok(directInsert(calls));
  assert.ok(finishOf(calls).error.includes("did not answer"));
  assert.equal(sent(calls).length, 0);
});

test("forward for a phone that is already a lead: a note on that lead, no second lead, no message", async () => {
  const calls = world({ createLead: { status: "exists", lead_id: "L-9", first_name: "Rahim", agent_name: "Karim", agent_phone: "8801711000000", notify: true } });
  const out = await processLeadgen(CHANGE);
  assert.deepEqual(out, { leadgen_id: "444", status: "duplicate", lead_id: "L-9" });
  assert.equal(directInsert(calls), undefined);
  assert.equal(sent(calls).length, 0);
  const note = notes(calls).find((a: any) => a.type === "NOTE")!;
  assert.equal(note.lead_id, "L-9");
  assert.ok(note.description.startsWith("Facebook form answered again (Citizen form)"));
  assert.equal(finishOf(calls).status, "duplicate");
});

test("the lead is reported to Meta once, the moment it exists, by its leadgen id", async () => {
  const calls = world();
  await processLeadgen(CHANGE);
  const ev = calls.filter((c) => c.url.includes("/events"));
  assert.equal(ev.length, 1);
  const e = ev[0].body.data[0];
  assert.equal(e.event_name, "Lead");
  assert.equal(e.action_source, "system_generated");
  assert.equal(e.user_data.lead_id, "444");
  assert.equal(e.user_data.ph[0].length, 64);                                       // hashed, never the number
  assert.ok(!JSON.stringify(ev[0].body).includes("8801712345678"));
  assert.equal(e.event_id, "L-1");
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/activities") && c.body.id === "capi-formlead-L-1"));   // the once-only marker
});

test("a lead that fell back to unassigned is reported to Meta too", async () => {
  const calls = world({ createLead: { status: "no_agent_available" } });
  await processLeadgen(CHANGE);
  assert.equal(calls.filter((c) => c.url.includes("/events")).length, 1);
});

test("the Received row records who got it, the customer message and the Meta report", async () => {
  const calls = world();
  await processLeadgen(CHANGE);
  const st = calls.filter((c) => c.method === "PATCH" && c.url.includes("fb_lead_events?leadgen_id=eq.444") && c.body.customer_msg !== undefined).at(-1)!.body;
  assert.deepEqual(st, { agent_name: "Karim", forward_tag: "/fctg", customer_msg: "sent", capi: "sent" });
  const off = world({ form: { notify_customer: false } });
  await processLeadgen({ ...CHANGE, leadgen_id: "446" });
  assert.equal(off.filter((c) => c.method === "PATCH" && c.body?.customer_msg !== undefined).at(-1)!.body.customer_msg, "skipped");
});
