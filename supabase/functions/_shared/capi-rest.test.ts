// node --test — the PostgREST adapter behind meta-capi (capi-rest.ts), with a
// recording fetch. Checks the exact requests it makes: service-role headers,
// company scope, filters, paging, counts, and the RPC names and arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { restDeps } from "./capi-rest.ts";

const URL0 = "https://p.supabase.co";
const KEY = "service-role-KEY";
function rec(reply: (url: string, init: any) => { status?: number; body?: unknown; headers?: Record<string, string> } = () => ({ body: [] })) {
  const calls: any[] = [];
  const f = async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const r = reply(url, init);
    return new Response(JSON.stringify(r.body ?? []), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { calls, deps: restDeps({ url: URL0, serviceKey: KEY, token: () => "T", fetch: f as any, now: () => 0 }) };
}

test("every request carries the service role, never the anon key", async () => {
  const { calls, deps } = rec();
  await deps.user("u1"); await deps.lead("L1"); await deps.history("L1");
  for (const c of calls) { assert.equal(c.headers.apikey, KEY); assert.equal(c.headers.Authorization, `Bearer ${KEY}`); }
});

test("user and lead are read by id, URL-encoded, with only the needed columns", async () => {
  const { calls, deps } = rec();
  await deps.user("a&b=c");
  await deps.lead("x y");
  assert.equal(calls[0].url, `${URL0}/rest/v1/users?id=eq.a%26b%3Dc&select=id,role,is_active,company_id,allowed_features`);
  assert.equal(calls[1].url, `${URL0}/rest/v1/capi_lead_status?id=eq.x%20y&select=id,company_id,created_at,ctwa_clid,capi_status_column,qualified,unsure`);
});

test("page reads the status view with company scope, status, search, dates, order, range and an exact count", async () => {
  const { calls, deps } = rec(() => ({ body: [{ id: "L1" }], headers: { "content-range": "0-0/42" } }));
  const r = await deps.page({ company: "c1", status: "failed", search: "Nuz an", from: "2026-10-01T00:00:00.000Z", to: "2026-10-29T00:00:00.000Z", sort: "cutoff_asc", limit: 25, offset: 50 });
  assert.equal(r.total, 42); assert.deepEqual(r.rows, [{ id: "L1" }]);
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/rest/v1/capi_lead_status");
  assert.equal(u.searchParams.get("company_id"), "eq.c1");
  assert.equal(u.searchParams.get("status"), "eq.failed");
  assert.equal(u.searchParams.get("or"), "(id.ilike.*Nuz an*,name.ilike.*Nuz an*)");
  assert.deepEqual(u.searchParams.getAll("created_at"), ["gte.2026-10-01T00:00:00.000Z", "lte.2026-10-29T00:00:00.000Z"]);
  assert.equal(u.searchParams.get("order"), "cutoff_at.asc");
  assert.equal(calls[0].headers.Prefer, "count=exact");
  assert.equal(calls[0].headers.Range, "50-74");
});

test("page: all statuses and Master (null company) add no filter; search strips PostgREST syntax", async () => {
  const { calls, deps } = rec(() => ({ headers: { "content-range": "*/0" } }));
  await deps.page({ company: null, status: "all", search: "a,b)(c*", from: null, to: null, sort: "created_desc", limit: 10, offset: 0 });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("company_id"), null);
  assert.equal(u.searchParams.get("status"), null);
  assert.equal(u.searchParams.get("or"), "(id.ilike.*abc*,name.ilike.*abc*)");
});

test("history lists a lead's attempts, newest first", async () => {
  const { calls, deps } = rec();
  await deps.history("L1");
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/rest/v1/capi_event_attempts");
  assert.equal(u.searchParams.get("lead_id"), "eq.L1"); assert.equal(u.searchParams.get("order"), "attempt_no.desc");
});

test("unlock, record and summary call the migration's functions with its argument names", async () => {
  const { calls, deps } = rec((url) => ({ body: url.endsWith("capi_record_attempt") ? [{ attempt_no: 3 }] : {} }));
  await deps.unlock("L1");
  const saved = await deps.record({ lead_id: "L1", event_id: "L1", source: "ui_retry", initiated_by: "u", outcome: "rejected", http_status: 400, events_received: 0,
    error_code: 190, error_subcode: 464, error_type: "OAuthException", error_message: "m", fbtrace_id: "t", meta_response: { error: { code: 190 } }, lock_id: "k" });
  await deps.summary("c1");
  assert.equal(saved.attempt_no, 3);
  const by = Object.fromEntries(calls.map((c) => [new URL(c.url).pathname.split("/").pop(), c.body]));
  assert.deepEqual(by.capi_unlock, { p_lead: "L1" });
  assert.deepEqual(by.capi_record_attempt, { p_lead: "L1", p_event_id: "L1", p_source: "ui_retry", p_actor: "u", p_outcome: "rejected", p_http: 400, p_received: 0,
    p_code: 190, p_subcode: 464, p_type: "OAuthException", p_message: "m", p_trace: "t", p_response: { error: { code: 190 } }, p_lock: null });
  assert.deepEqual(by.capi_summary, { p_company: "c1" });
});

test("acquire calls the shared limiter and returns its verdict as given", async () => {
  const { calls, deps } = rec(() => ({ body: { result: "rate_limited", reason: "window", retry_at: "2026-10-29T11:01:00Z" } }));
  assert.deepEqual(await deps.acquire("L1", "ui_retry"), { result: "rate_limited", reason: "window", retry_at: "2026-10-29T11:01:00Z" });
  assert.equal(new URL(calls[0].url).pathname, "/rest/v1/rpc/capi_acquire");
  assert.deepEqual(calls[0].body, { p_lead: "L1", p_source: "ui_retry", p_ttl_seconds: 120 });
});

test("throttle passes Meta's hint, or null so the database picks the backoff", async () => {
  const { calls, deps } = rec(() => ({ body: "2026-10-29T11:02:00Z" }));
  assert.equal(await deps.throttle(90), "2026-10-29T11:02:00Z");
  await deps.throttle(null);
  assert.equal(new URL(calls[0].url).pathname, "/rest/v1/rpc/capi_throttle");
  assert.deepEqual(calls.map((c) => c.body), [{ p_hint_seconds: 90 }, { p_hint_seconds: null }]);
});

test("postMeta passes Meta's Retry-After hint on, in seconds, when it sends one", async () => {
  const a = rec(() => ({ status: 429, body: { error: { code: 4 } }, headers: { "retry-after": "42" } }));
  assert.deepEqual(await a.deps.postMeta({ data: [] }), { status: 429, json: { error: { code: 4 } }, retryAfter: 42 });
  const b = rec(() => ({ status: 429, body: { error: { code: 4 } } }));
  assert.equal((await b.deps.postMeta({ data: [] })).retryAfter, null);
});

test("bots reads only the two existing bots' CAPI switch; setBot goes through capi_set_bot", async () => {
  const { calls, deps } = rec((url) => ({ body: url.includes("capi_set_bot") ? [{ bot: "dubai", meta_capi_enabled: false }] : [{ bot: "eyad", display_name: "Eyad Bot", meta_capi_enabled: true }] }));
  assert.deepEqual(await deps.bots(), [{ bot: "eyad", display_name: "Eyad Bot", meta_capi_enabled: true }]);
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/rest/v1/wa_bot_settings");
  assert.equal(u.searchParams.get("select"), "bot,display_name,meta_capi_enabled");
  assert.equal(u.searchParams.get("bot"), "in.(eyad,dubai)");
  assert.deepEqual(await deps.setBot("dubai", false), { bot: "dubai", meta_capi_enabled: false });
  assert.equal(new URL(calls[1].url).pathname, "/rest/v1/rpc/capi_set_bot");
  assert.deepEqual(calls[1].body, { p_bot: "dubai", p_enabled: false });
});

test("the list carries the agent-qualified flag; the lead read carries no status the check could misuse", async () => {
  const { calls, deps } = rec(() => ({ headers: { "content-range": "*/0" } }));
  await deps.page({ company: "c1", status: "all", search: "", from: null, to: null, sort: "created_desc", limit: 10, offset: 0 });
  assert.ok(new URL(calls[0].url).searchParams.get("select")!.split(",").includes("qualified"));
  await deps.lead("L1");
  assert.equal(new URL(calls[1].url).pathname, "/rest/v1/capi_lead_status");
  assert.equal(new URL(calls[1].url).searchParams.get("id"), "eq.L1");
  assert.equal(new URL(calls[1].url).searchParams.get("select"), "id,company_id,created_at,ctwa_clid,capi_status_column,qualified,unsure");
});

test("a failed database call throws instead of passing silently", async () => {
  const b = rec(() => ({ status: 500, body: { message: "boom" } }));
  await assert.rejects(b.deps.lead("L1"));
  await assert.rejects(b.deps.record({ lead_id: "L1", event_id: "L1", source: "ui_retry", initiated_by: "u", outcome: "accepted", http_status: 200, events_received: 1,
    error_code: null, error_subcode: null, error_type: null, error_message: null, fbtrace_id: null, meta_response: null, lock_id: null }));
});

test("postMeta posts to the dataset's events endpoint with a timeout", async () => {
  const { calls, deps } = rec(() => ({ body: { events_received: 1 } }));
  const r = await deps.postMeta({ data: [], access_token: "T" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v26.0/869790160551668/events");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(r, { status: 200, json: { events_received: 1 }, retryAfter: null });
});

test("D1 switch: only the exact value 'local' opens privileged actions; anything else stays closed", () => {
  const mk = (v: string | undefined) => restDeps({ url: URL0, serviceKey: KEY, token: () => "T", fetch: (async () => new Response("[]")) as any, now: () => 0, allowUnverified: v });
  assert.equal(mk("local").allowUnverifiedActor!(), true);
  for (const v of [undefined, "", "true", "1", "yes", "LOCAL", "production"]) assert.equal(mk(v).allowUnverifiedActor!(), false, String(v));
});

test("Meta endpoint override is honoured only for a loopback/local stub, so production always posts to graph.facebook.com", async () => {
  const seen: string[] = [];
  const mk = (graph?: string) => restDeps({ url: URL0, serviceKey: KEY, token: () => "T", now: () => 0, graphBase: graph,
    fetch: (async (u: string) => { seen.push(u); return new Response(JSON.stringify({ events_received: 1 })); }) as any });
  await mk("http://host.docker.internal:55399").postMeta({ data: [] });
  await mk("http://127.0.0.1:55399").postMeta({ data: [] });
  await mk("https://evil.example.com").postMeta({ data: [] });
  await mk(undefined).postMeta({ data: [] });
  assert.deepEqual(seen, [
    "http://host.docker.internal:55399/869790160551668/events",
    "http://127.0.0.1:55399/869790160551668/events",
    "https://graph.facebook.com/v26.0/869790160551668/events",
    "https://graph.facebook.com/v26.0/869790160551668/events",
  ]);
});
