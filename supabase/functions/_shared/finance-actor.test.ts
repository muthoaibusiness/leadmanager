// node --test — finance takes its caller from the verified session (D1), never
// from body.userId. GoTrue and PostgREST are a stubbed global fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleFinance } from "./finance-core.ts";

const URL_ = "http://sb.test";
const env = { url: URL_, serviceKey: "svc", anonKey: "anon" };
const users = [
  { id: "mgr", auth_user_id: "a-mgr", name: "M", role: "MANAGEMENT", is_active: true, company_id: "c1", team_id: null, allowed_features: null },
  { id: "agent", auth_user_id: "a-agent", name: "A", role: "AGENT", is_active: true, company_id: "c1", team_id: null, allowed_features: null },
];
const sessions: Record<string, string> = { "tok-mgr": "a-mgr", "tok-agent": "a-agent" };
const seen: string[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input); const h = new Headers(init?.headers);
  seen.push(u);
  if (u === `${URL_}/auth/v1/user`) {
    const sub = sessions[(h.get("authorization") || "").replace("Bearer ", "")];
    return sub ? new Response(JSON.stringify({ id: sub })) : new Response("{}", { status: 401 });
  }
  const m = /users\?auth_user_id=eq\.([^&]+)/.exec(u);
  if (m) return new Response(JSON.stringify(users.filter((x) => x.auth_user_id === decodeURIComponent(m[1]))));
  if (/\/rest\/v1\/users\?id=eq\./.test(u)) return new Response(JSON.stringify(users.filter((x) => u.includes(`id=eq.${x.id}`))));
  return new Response("[]");
}) as typeof fetch;

const post = (body: any, auth?: string) => handleFinance(new Request("http://fn.test/finance", {
  method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body),
}), env);

test("a forged userId with no session is 401, and the claimed id is never looked up", async () => {
  seen.length = 0;
  const r = await post({ userId: "mgr", action: "budget.list" });
  assert.equal(r.status, 401);
  assert.ok(!seen.some((u) => u.includes("id=eq.mgr")), "body.userId was not consulted");
});

test("the anon key is not a session", async () => {
  assert.equal((await post({ userId: "mgr", action: "budget.list" }, "Bearer anon")).status, 401);
});

test("an Agent's real session claiming the manager's id is still the Agent: 403", async () => {
  assert.equal((await post({ userId: "mgr", action: "budget.list" }, "Bearer tok-agent")).status, 403);
});

test("the manager's real session passes the actor check", async () => {
  const r = await post({ action: "no.such.action" }, "Bearer tok-mgr");
  assert.equal(r.status, 400, "past the actor check, stopped at the unknown action");
});
