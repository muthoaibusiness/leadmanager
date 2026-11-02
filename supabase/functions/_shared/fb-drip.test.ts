// node --test: the backlog drip against a fake Meta / PostgREST. One lead per 5-minute slot, the oldest
// one that is not yet a CRM lead, handled like a live lead (forwarded to /fctg and the customer told).
import { test } from "node:test";
import assert from "node:assert/strict";

const ENV: Record<string, string> = { SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "svc", FB_PAGE_ACCESS_TOKEN: "page-token" };
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
const { dripBacklog } = await import("./fb-drip.ts");

const NOW = Date.parse("2026-11-03T12:00:00Z");
function world(o: { on?: boolean; slotTaken?: boolean; handled?: string[] } = {}) {
  const calls: { method: string; url: string; body: any }[] = [];
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = String(input), method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/555/leads?")) return json({ data: [{ id: "302", created_time: "2026-11-02T10:00:00+0000" }, { id: "301", created_time: "2026-11-01T10:00:00+0000" }, { id: "300", created_time: "2026-10-31T10:00:00+0000" }] });
    if (url.startsWith("https://graph.facebook.com/")) return json({ field_data: [{ name: "full_name", values: ["Rahim"] }, { name: "phone", values: ["01712345678"] }] });
    if (url.endsWith("/send-message")) return json({ success: true, data: { msgId: "w1" } });
    const path = url.replace("https://sb.test/rest/v1/", "");
    if (path.startsWith("wa_webhook_events")) return o.slotTaken ? new Response("dup", { status: 409 }) : new Response(null, { status: 201 });
    if (path.startsWith("rpc/wa_upsert_prelead")) return json({ id: "pre-1" });
    if (path.startsWith("rpc/wa_create_lead")) return json({ status: "created", lead_id: "L-1", first_name: "Rahim", agent_name: "Karim", agent_phone: "8801711000000", notify: true });
    if (method !== "GET") return new Response(null, { status: method === "PATCH" ? 204 : 201 });
    if (path.startsWith("fb_lead_settings?id=eq.default&select=enabled")) return json([{ enabled: true, backlog_drip: o.on !== false }]);
    if (path.startsWith("fb_lead_settings")) return json([{ enabled: true, page_id: "1", company_id: "c1", default_status: "NEW", duplicate_policy: "note", notify_agent: true }]);
    if (path.startsWith("fb_lead_forms?active")) return json([{ form_id: "555" }]);
    if (path.startsWith("fb_lead_forms")) return json([{ form_id: "555", label: "BD", active: true, project: "P", source: "META_ADS", assign_mode: "forward", forward_tag: "/fctg", notify_customer: true, field_map: {} }]);
    if (path.startsWith("fb_lead_events?leadgen_id=in.")) return json((o.handled ?? []).map((id) => ({ leadgen_id: id, status: "created" })));
    if (path.startsWith("wa_bot_settings")) return json([{ bot: "eyad", customer_notify_enabled: true }]);
    if (path.startsWith("wa_secrets")) return json([{ id: "eyad", api_token: "tok", webhook_secret: "" }]);
    return json([]);
  };
  return calls;
}

test("the oldest lead that is not a CRM lead is forwarded to /fctg and the customer told", async () => {
  const calls = world({ handled: ["300"] });
  const out: any = await dripBacklog(NOW);
  assert.equal(out.status, "created");
  assert.equal(out.leadgen_id, "301");   // 300 is done; 301 is the oldest left
  assert.equal(calls.filter((c) => c.url.endsWith("rpc/wa_create_lead")).length, 1);
  assert.equal(calls.find((c) => c.url.endsWith("rpc/wa_create_lead"))!.body.p_cmd, "/fctg");
  assert.equal(calls.filter((c) => c.url.endsWith("/send-message")).length, 1);
});

test("off, or its 5-minute slot already used: nothing is fetched or sent", async () => {
  let calls = world({ on: false });
  assert.deepEqual(await dripBacklog(NOW), { status: "off" });
  assert.equal(calls.some((c) => c.url.startsWith("https://graph.facebook.com/")), false);
  calls = world({ slotTaken: true });
  assert.deepEqual(await dripBacklog(NOW), { status: "waiting" });
  assert.equal(calls.some((c) => c.url.startsWith("https://graph.facebook.com/")), false);
});

test("nothing left: empty", async () => {
  world({ handled: ["300", "301", "302"] });
  assert.deepEqual(await dripBacklog(NOW), { status: "empty" });
});
