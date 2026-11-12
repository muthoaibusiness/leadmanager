// node --test supabase/functions/_shared/google-oauth-core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { startOauth, finishOauth, idTokenEmail, type OauthDeps } from "./google-oauth-core.ts";

function deps(tokenReply: Record<string, unknown>, ok = true) {
  const states = new Map<string, string>();
  const secrets: Record<string, string> = {};
  let t = Date.parse("2026-11-12T10:00:00Z");
  const d: OauthDeps = {
    clientId: "cid", clientSecret: "csec", setupKey: "k".repeat(36), redirectUri: "https://x.supabase.co/functions/v1/google-oauth/callback",
    async saveState(s) { states.set(s, new Date(t).toISOString()); },
    async takeState(s) { const v = states.get(s); states.delete(s); return v ? { created_at: v } : null; },
    async saveSecret(n, v) { secrets[n] = v; },
    fetch: async () => new Response(JSON.stringify(tokenReply), { status: ok ? 200 : 400 }),
    now: () => t, random: () => "st1",
  };
  return { d, secrets, tick: (ms: number) => { t += ms; } };
}
const idTok = (email: string) => "h." + btoa(JSON.stringify({ email })).replace(/=+$/, "") + ".s";

test("start needs the setup key and redirects to Google with gmail.send", async () => {
  const w = deps({});
  assert.equal((await startOauth("wrong", w.d)).status, 403);
  const r = await startOauth("k".repeat(36), w.d);
  assert.equal(r.status, 302);
  const u = new URL(r.location!);
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.supabase.co/functions/v1/google-oauth/callback");
  assert.match(u.searchParams.get("scope")!, /gmail\.send/);
  assert.equal(u.searchParams.get("access_type"), "offline");
});

test("callback stores the refresh token and sender once; a reused or late state is refused", async () => {
  const w = deps({ refresh_token: "rt", scope: "https://www.googleapis.com/auth/gmail.send openid email", id_token: idTok("crm@gmail.com") });
  await startOauth("k".repeat(36), w.d);
  const ok = await finishOauth(new URLSearchParams({ state: "st1", code: "c" }), w.d);
  assert.equal(ok.status, 200);
  assert.deepEqual(w.secrets, { google_refresh_token: "rt", mail_from_email: "crm@gmail.com" });
  assert.equal((await finishOauth(new URLSearchParams({ state: "st1", code: "c" }), w.d)).status, 400, "state is single use");
  await startOauth("k".repeat(36), w.d);
  w.tick(11 * 60_000);
  assert.equal((await finishOauth(new URLSearchParams({ state: "st1", code: "c" }), w.d)).status, 400, "expired");
});

test("no refresh token or no gmail.send permission: nothing stored", async () => {
  for (const reply of [{ scope: "gmail.send" }, { refresh_token: "rt", scope: "openid email" }]) {
    const w = deps(reply);
    await startOauth("k".repeat(36), w.d);
    assert.notEqual((await finishOauth(new URLSearchParams({ state: "st1", code: "c" }), w.d)).status, 200);
    assert.deepEqual(w.secrets, {});
  }
});

test("id_token email is read safely", () => {
  assert.equal(idTokenEmail(idTok("a@b.co")), "a@b.co");
  assert.equal(idTokenEmail("garbage"), "");
});
