// node --test — wa-send's access rules (wa-send-auth.ts): set-credentials is
// gone (410, CR-001 CR-3), and "send" needs a verified, active CRM session.
// Agents send from the lead chat for their own leads (waCanChatLead), so any
// verified account may send; anonymous callers may not. Nothing is sent here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeWaSend } from "./wa-send-auth.ts";

const actorFor: Record<string, any> = {
  "tok-mgr": { id: "mgr", role: "MANAGEMENT", is_active: true, company_id: "c1", allowed_features: null },
  "tok-agent": { id: "agent", role: "AGENT", is_active: true, company_id: "c1", allowed_features: null },
  "tok-chat": { id: "chat", role: "AGENT", is_active: true, company_id: "c1", allowed_features: ["conversations"] },
};
const verify = async (req: Request) => {
  const tok = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const a = actorFor[tok];
  if (!a) { const e: any = new Error("Sign in required"); e.status = 401; throw e; }
  return a;
};
const req = (auth?: string) => new Request("http://fn.test", { method: "POST", headers: auth ? { authorization: auth } : {} });

test("set-credentials answers 410 for everyone, before any lookup", async () => {
  let looked = false;
  const v = async (r: Request) => { looked = true; return verify(r); };
  for (const a of [undefined, "Bearer tok-mgr"]) {
    const r = await authorizeWaSend(req(a), { action: "set-credentials", userId: "mgr" }, v);
    assert.equal(r.ok, false); assert.equal((r as any).status, 410);
  }
  assert.equal(looked, false);
});

test("send without a session, or with a forged body userId, is 401", async () => {
  for (const a of [undefined, "Bearer anon", "Bearer forged"]) {
    const r = await authorizeWaSend(req(a), { action: "send", userId: "mgr" }, verify);
    assert.equal((r as any).status, 401, String(a));
  }
});

test("send: any verified CRM account passes; unknown actions are 400", async () => {
  for (const t of ["tok-mgr", "tok-chat", "tok-agent"]) assert.equal((await authorizeWaSend(req(`Bearer ${t}`), { action: "send" }, verify)).ok, true, t);
  assert.equal(((await authorizeWaSend(req("Bearer tok-mgr"), { action: "broadcast" }, verify)) as any).status, 400);
});

test("the verified actor, not the body, names the sender", async () => {
  const r = await authorizeWaSend(req("Bearer tok-chat"), { action: "send", userId: "mgr" }, verify);
  assert.equal(r.ok && r.actor.id, "chat");
});
