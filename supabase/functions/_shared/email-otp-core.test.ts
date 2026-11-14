// node --test supabase/functions/_shared/email-otp-core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEmailOtp, type OtpDeps, type OtpRow, type OtpUser } from "./email-otp-core.ts";

function world() {
  let t = Date.parse("2026-11-12T10:00:00Z");
  const users: OtpUser[] = [
    { id: "u1", name: "Rahim", email: "Rahim@Example.com", auth_user_id: "a1", is_active: true, email_verified_at: null },
    { id: "u2", name: "Off", email: "off@example.com", auth_user_id: "a2", is_active: false, email_verified_at: null },
  ];
  const otps: OtpRow[] = [];
  const mails: { to: string; subject: string; text: string }[] = [];
  const passwords: Record<string, string> = {};
  let next = 1, codeSeq = 0;
  const d: OtpDeps = {
    async userByEmail(e) { return users.find((u) => u.email.toLowerCase() === e) ?? null; },
    async userById(id) { return users.find((u) => u.id === id) ?? null; },
    async sentSince(e, p, since) { return otps.filter((o) => o.email === e && o.purpose === p && o.created_at >= since); },
    async insertOtp(r) { otps.push({ ...r, id: next++, attempts: 0, used_at: null, created_at: new Date(t).toISOString() } as OtpRow); },
    async latestOpen(e, p) { return [...otps].reverse().find((o) => o.email === e && o.purpose === p && !o.used_at) ?? null; },
    async setAttempts(id, n) { otps.find((o) => o.id === id)!.attempts = n; },
    async closeAll(e, p, iso) { otps.filter((o) => o.email === e && o.purpose === p && !o.used_at).forEach((o) => { o.used_at = iso; }); },
    async setVerified(id, iso) { users.find((u) => u.id === id)!.email_verified_at = iso; },
    async setAuthPassword(a, pw) { passwords[a] = pw; return true; },
    async mail(to, subject, _h, text) { mails.push({ to, subject, text }); },
    async hash(s) { return "h:" + s; },
    now: () => t,
    code: () => ["123456", "654321", "111111", "222222", "333333", "444444"][codeSeq++ % 6],
  };
  return { d, users, otps, mails, passwords, tick: (ms: number) => { t += ms; } };
}

test("verify: needs a session, sends a code, accepts it once, marks verified", async () => {
  const w = world();
  assert.equal((await handleEmailOtp({ action: "verify.send" }, null, w.d)).status, 401);
  const s = await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d);
  assert.equal(s.status, 200);
  assert.equal(w.mails.length, 1);
  assert.match(w.mails[0].subject, /^123456 is your WEPRO CRM verification code$/);
  assert.equal(w.otps[0].code_hash, "h:verify:rahim@example.com:123456", "only a hash is stored");
  assert.equal((await handleEmailOtp({ action: "verify.check", code: "000000" }, { id: "u1" }, w.d)).body.error, "Wrong code. 4 tries left.");
  const ok = await handleEmailOtp({ action: "verify.check", code: "123 456" }, { id: "u1" }, w.d);
  assert.equal(ok.body.verified, true);
  assert.ok(w.users[0].email_verified_at);
  const again = await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d);
  assert.equal(again.body.verified, true, "already verified: nothing more is sent");
  assert.equal(w.mails.length, 1);
});

test("status says whether the email is verified", async () => {
  const w = world();
  assert.deepEqual((await handleEmailOtp({ action: "verify.status" }, { id: "u1" }, w.d)).body, { ok: true, verified: false, email: "Rahim@Example.com" });
  assert.equal(w.mails.length, 0);
});

test("one send a minute, five an hour", async () => {
  const w = world();
  await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d);
  const soon = await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d);
  assert.equal(soon.status, 429); assert.equal(soon.body.retryIn, 60);
  for (let i = 0; i < 4; i++) { w.tick(61_000); assert.equal((await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d)).status, 200); }
  w.tick(61_000);
  assert.equal((await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d)).status, 429, "sixth in the hour");
});

test("a new code replaces the old one; codes expire; five wrong tries lock it", async () => {
  const w = world();
  await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d);
  w.tick(61_000);
  await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d); // code 654321
  assert.equal((await handleEmailOtp({ action: "verify.check", code: "123456" }, { id: "u1" }, w.d)).status, 400, "old code dead");
  for (let i = 0; i < 4; i++) await handleEmailOtp({ action: "verify.check", code: "000000" }, { id: "u1" }, w.d);
  const locked = await handleEmailOtp({ action: "verify.check", code: "654321" }, { id: "u1" }, w.d);
  assert.equal(locked.status, 429, "fifth try used up, even the right code is refused");
  w.tick(61_000);
  await handleEmailOtp({ action: "verify.send" }, { id: "u1" }, w.d); // 111111
  w.tick(10 * 60_000 + 1);
  assert.match(String((await handleEmailOtp({ action: "verify.check", code: "111111" }, { id: "u1" }, w.d)).body.error), /expired/);
});

test("reset: same answer for unknown and inactive addresses, and nothing is sent", async () => {
  const w = world();
  for (const email of ["nobody@example.com", "off@example.com"]) {
    const r = await handleEmailOtp({ action: "reset.send", email }, null, w.d);
    assert.deepEqual(r, { status: 200, body: { ok: true, sent: true } });
  }
  assert.equal(w.mails.length, 0);
});

test("reset: code + new password changes the sign-in password and verifies the email", async () => {
  const w = world();
  await handleEmailOtp({ action: "reset.send", email: " RAHIM@example.com " }, null, w.d);
  assert.equal(w.mails.length, 1);
  assert.match(w.mails[0].subject, /password reset code/);
  assert.equal((await handleEmailOtp({ action: "reset.confirm", email: "rahim@example.com", code: "123456", password: "short" }, null, w.d)).status, 400);
  const r = await handleEmailOtp({ action: "reset.confirm", email: "rahim@example.com", code: "123456", password: "newpass1234" }, null, w.d);
  assert.equal(r.body.changed, true);
  assert.equal(w.passwords.a1, "newpass1234");
  assert.ok(w.users[0].email_verified_at);
  const reuse = await handleEmailOtp({ action: "reset.confirm", email: "rahim@example.com", code: "123456", password: "other12345" }, null, w.d);
  assert.equal(reuse.status, 400, "single use");
});
