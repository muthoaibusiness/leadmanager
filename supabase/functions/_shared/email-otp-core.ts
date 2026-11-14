// Email one-time codes (migration 0069): verify your own email from Profile, and
// reset a forgotten password from the login page. Deno-free: storage, mail,
// hashing, the clock and the code generator are passed in, so Node tests drive it.
//
// A code is 6 digits, lives 10 minutes, allows 5 tries and works once. Only a
// salted SHA-256 of it is stored. Sending is limited to one per minute and five
// per hour per address. "Forgot password" answers the same whether or not the
// address has an account, so it cannot be used to find out who is a user.

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_TRIES = 5;
export const COOLDOWN_MS = 60_000;
export const MAX_PER_HOUR = 5;
export const MIN_PASSWORD = 10; // the same rule as Profile > change password

export type OtpUser = { id: string; name: string; email: string; auth_user_id: string | null; is_active: boolean; email_verified_at: string | null };
export type OtpRow = { id: number; email: string; user_id: string | null; purpose: "verify" | "reset"; code_hash: string; expires_at: string; attempts: number; used_at: string | null; created_at: string };
export type Actor = { id: string };

export type OtpDeps = {
  userByEmail(email: string): Promise<OtpUser | null>;
  userById(id: string): Promise<OtpUser | null>;
  sentSince(email: string, purpose: string, sinceIso: string): Promise<{ created_at: string }[]>;
  insertOtp(row: Omit<OtpRow, "id" | "attempts" | "used_at" | "created_at">): Promise<void>;
  latestOpen(email: string, purpose: string): Promise<OtpRow | null>;
  setAttempts(id: number, attempts: number): Promise<void>;
  closeAll(email: string, purpose: string, iso: string): Promise<void>;
  setVerified(userId: string, iso: string): Promise<void>;
  setAuthPassword(authUserId: string, password: string): Promise<boolean>;
  mail(to: string, subject: string, html: string, text: string): Promise<void>;
  hash(s: string): Promise<string>;
  now(): number;
  code(): string;
};

type Out = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}): Out => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Out => ({ status, body: { ok: false, error, ...extra } });

export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const codeHash = (d: OtpDeps, purpose: string, email: string, code: string) => d.hash(`${purpose}:${email}:${code}`);

export function otpEmail(purpose: "verify" | "reset", name: string, code: string) {
  const what = purpose === "verify" ? "verify your email" : "reset your password";
  const subject = purpose === "verify" ? `${code} is your WEPRO CRM verification code` : `${code} is your WEPRO CRM password reset code`;
  const hello = name ? `Hi ${name},` : "Hi,";
  const text = `${hello}\n\nUse this code to ${what} in WEPRO CRM: ${code}\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const html = `<!doctype html><html><body style="margin:0;background:#0b0b0c;font-family:Arial,Helvetica,sans-serif;color:#e8e8e8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#141416;border:1px solid #26262a;border-radius:16px;padding:28px">
<tr><td style="font-size:18px;font-weight:700;letter-spacing:.5px"><span style="color:#54B848">WEPRO</span> CRM</td></tr>
<tr><td style="padding-top:18px;font-size:15px;line-height:1.5">${esc(hello)}<br>Use this code to ${what}:</td></tr>
<tr><td style="padding:18px 0"><div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#ffffff;background:#0b0b0c;border:1px solid #2f5f2b;border-radius:12px;padding:16px;text-align:center">${code}</div></td></tr>
<tr><td style="font-size:13px;color:#a0a0a8;line-height:1.5">It expires in 10 minutes. If you did not ask for it, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}

// Sends a code unless the address is cooling down. Returns why it did not send.
async function issue(d: OtpDeps, purpose: "verify" | "reset", user: OtpUser, email: string): Promise<{ sent: true } | { sent: false; retryIn: number }> {
  const now = d.now();
  const recent = await d.sentSince(email, purpose, new Date(now - 3600_000).toISOString());
  const last = recent.reduce((m, r) => Math.max(m, Date.parse(r.created_at)), 0);
  if (last && now - last < COOLDOWN_MS) return { sent: false, retryIn: Math.ceil((COOLDOWN_MS - (now - last)) / 1000) };
  if (recent.length >= MAX_PER_HOUR) {
    const oldest = recent.reduce((m, r) => Math.min(m, Date.parse(r.created_at)), Infinity);
    return { sent: false, retryIn: Math.max(1, Math.ceil((oldest + 3600_000 - now) / 1000)) };
  }
  const code = d.code();
  // A new code replaces any older open one.
  await d.closeAll(email, purpose, new Date(now).toISOString());
  await d.insertOtp({ email, user_id: user.id, purpose, code_hash: await codeHash(d, purpose, email, code), expires_at: new Date(now + CODE_TTL_MS).toISOString() });
  const m = otpEmail(purpose, user.name, code);
  await d.mail(user.email, m.subject, m.html, m.text);
  return { sent: true };
}

// Checks a code against the newest open one. null = right; otherwise the answer.
async function check(d: OtpDeps, purpose: "verify" | "reset", email: string, code: unknown): Promise<Out | null> {
  const c = String(code ?? "").replace(/\D/g, "");
  if (c.length !== 6) return fail(400, "Enter the 6-digit code from the email.");
  const row = await d.latestOpen(email, purpose);
  if (!row || Date.parse(row.expires_at) <= d.now()) return fail(400, "This code has expired. Ask for a new one.");
  if (row.attempts >= MAX_TRIES) return fail(429, "Too many wrong tries. Ask for a new code.");
  if ((await codeHash(d, purpose, email, c)) !== row.code_hash) {
    const used = row.attempts + 1;
    await d.setAttempts(row.id, used);
    const left = MAX_TRIES - used;
    return left > 0 ? fail(400, `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`) : fail(429, "Too many wrong tries. Ask for a new code.");
  }
  await d.closeAll(email, purpose, new Date(d.now()).toISOString());
  return null;
}

export async function handleEmailOtp(body: Record<string, unknown>, actor: Actor | null, d: OtpDeps): Promise<Out> {
  const action = String(body.action ?? "");

  if (action === "verify.status" || action === "verify.send" || action === "verify.check") {
    if (!actor) return fail(401, "Sign in required");
    const user = await d.userById(actor.id);
    if (!user) return fail(403, "No CRM account for this sign-in");
    const email = normEmail(user.email);
    if (!looksLikeEmail(email)) return fail(400, "Your account has no valid email address. Ask an admin to fix it.");
    if (user.email_verified_at) return ok({ verified: true, verifiedAt: user.email_verified_at, email: user.email });
    if (action === "verify.status") return ok({ verified: false, email: user.email });
    if (action === "verify.send") {
      const r = await issue(d, "verify", user, email);
      return r.sent ? ok({ sent: true, to: user.email }) : fail(429, `Please wait ${r.retryIn}s before asking for another code.`, { retryIn: r.retryIn });
    }
    const bad = await check(d, "verify", email, body.code);
    if (bad) return bad;
    const at = new Date(d.now()).toISOString();
    await d.setVerified(user.id, at);
    return ok({ verified: true, verifiedAt: at });
  }

  if (action === "reset.send") {
    const email = normEmail(body.email);
    if (!looksLikeEmail(email)) return fail(400, "Enter your email address.");
    const user = await d.userByEmail(email);
    // Same answer either way: never reveal whether the address has an account.
    if (user && user.is_active !== false && user.auth_user_id) await issue(d, "reset", user, email);
    return ok({ sent: true });
  }

  if (action === "reset.confirm") {
    const email = normEmail(body.email);
    const password = String(body.password ?? "");
    if (!looksLikeEmail(email)) return fail(400, "Enter your email address.");
    if (password.length < MIN_PASSWORD) return fail(400, `The new password needs at least ${MIN_PASSWORD} characters.`);
    const bad = await check(d, "reset", email, body.code);
    if (bad) return bad;
    const user = await d.userByEmail(email);
    if (!user || user.is_active === false || !user.auth_user_id) return fail(400, "This code has expired. Ask for a new one.");
    if (!(await d.setAuthPassword(user.auth_user_id, password))) return fail(502, "Could not change the password. Try again.");
    // Reading the code from the inbox proves the address too.
    if (!user.email_verified_at) await d.setVerified(user.id, new Date(d.now()).toISOString());
    return ok({ changed: true });
  }

  return fail(400, "Unknown action");
}
