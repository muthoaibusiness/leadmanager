// node --test — the verified caller (actor.ts). GoTrue and PostgREST are
// scripted fetches; nothing leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedActor, ActorError } from "./actor.ts";

const URL_ = "http://sb.test";
const users = [
  { id: "u-mgr", auth_user_id: "auth-mgr", role: "MANAGEMENT", is_active: true, company_id: "c1", allowed_features: null, name: "M" },
  { id: "u-off", auth_user_id: "auth-off", role: "MANAGEMENT", is_active: false, company_id: "c1", allowed_features: null, name: "Off" },
];
const tokens: Record<string, string> = { "good-mgr": "auth-mgr", "good-off": "auth-off", "good-orphan": "auth-nobody" };

function fakeFetch(calls: string[]) {
  return async (input: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push(`${init?.method || "GET"} ${input}`);
    if (input === `${URL_}/auth/v1/user`) {
      const tok = (h.get("authorization") || "").replace(/^Bearer /, "");
      const sub = tokens[tok];
      return sub ? new Response(JSON.stringify({ id: sub })) : new Response(JSON.stringify({ msg: "invalid JWT" }), { status: 401 });
    }
    const m = /\/rest\/v1\/users\?auth_user_id=eq\.([^&]+)/.exec(input);
    if (m) {
      assert.equal(h.get("authorization"), "Bearer service-key", "the users row is read with the service role");
      return new Response(JSON.stringify(users.filter((u) => u.auth_user_id === decodeURIComponent(m[1]))));
    }
    return new Response("unexpected", { status: 500 });
  };
}
const deps = (calls: string[] = []) => ({ url: URL_, serviceKey: "service-key", anonKey: "anon-key", fetch: fakeFetch(calls) });
const req = (auth?: string, body: unknown = {}) => new Request("http://fn.test", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });

test("a valid session token resolves to its users row", async () => {
  const a = await verifiedActor(req("Bearer good-mgr"), deps());
  assert.equal(a.id, "u-mgr");
  assert.equal(a.role, "MANAGEMENT");
  assert.equal(a.company_id, "c1");
});

test("no token, the anon key, or a forged token is 401", async () => {
  for (const h of [undefined, "Bearer anon-key", "Bearer forged.jwt.value", "Basic abc", "Bearer "]) {
    await assert.rejects(verifiedActor(req(h), deps()), (e: any) => e instanceof ActorError && e.status === 401, String(h));
  }
});

test("a userId in the body is never used to pick the account", async () => {
  const calls: string[] = [];
  await assert.rejects(verifiedActor(req(undefined, { userId: "u-mgr", user_id: "u-mgr" }), deps(calls)), (e: any) => e.status === 401);
  assert.ok(!calls.some((c) => c.includes("u-mgr")), "the claimed id was never looked up");
});

test("an inactive account or a sign-in with no CRM account is 403", async () => {
  await assert.rejects(verifiedActor(req("Bearer good-off"), deps()), (e: any) => e.status === 403);
  await assert.rejects(verifiedActor(req("Bearer good-orphan"), deps()), (e: any) => e.status === 403);
});

test("GoTrue unreachable fails closed (503), never open", async () => {
  const d = { ...deps(), fetch: async () => { throw new TypeError("fetch failed"); } };
  await assert.rejects(verifiedActor(req("Bearer good-mgr"), d), (e: any) => e.status === 503);
});

test("the users lookup failing on the network is 503, never 401 with a raw error", async () => {
  const base = fakeFetch([]);
  const d = { ...deps(), fetch: async (input: string, init?: RequestInit) => { if (input.includes("/rest/v1/users")) throw new TypeError("fetch failed http://internal"); return base(input, init); } };
  await assert.rejects(verifiedActor(req("Bearer good-mgr"), d), (e: any) => e instanceof ActorError && e.status === 503 && !/internal/.test(e.message));
});
