// OtpDeps backed by PostgREST + GoTrue admin with the service key (email-otp).
import type { OtpDeps, OtpRow, OtpUser } from "./email-otp-core.ts";
import { gmailSend, type GmailCfg } from "./gmail.ts";

type F = (u: string, i?: RequestInit) => Promise<Response>;
const USER_COLS = "id,name,email,auth_user_id,is_active,email_verified_at";
const enc = encodeURIComponent;

export function restOtpDeps(o: { url: string; serviceKey: string; pepper: string; gmail: GmailCfg; fetch: F }): OtpDeps {
  const H = { apikey: o.serviceKey, authorization: `Bearer ${o.serviceKey}`, "Content-Type": "application/json" };
  const rest = async (path: string, init: RequestInit = {}) => {
    const r = await o.fetch(`${o.url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`rest ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  const rows = async <T>(path: string) => (await (await rest(path)).json()) as T[];
  return {
    // Emails are stored as typed; match case-insensitively (ilike, wildcards escaped).
    async userByEmail(email) {
      const pat = email.replace(/[\\%_*]/g, (c) => "\\" + c);
      const u = await rows<OtpUser>(`users?email=ilike.${enc(pat)}&select=${USER_COLS}&limit=2`);
      return u.length === 1 ? u[0] : null; // ambiguous: treat as none
    },
    async userById(id) { return (await rows<OtpUser>(`users?id=eq.${enc(id)}&select=${USER_COLS}`))[0] ?? null; },
    sentSince: (email, purpose, since) => rows(`email_otps?email=eq.${enc(email)}&purpose=eq.${purpose}&created_at=gte.${enc(since)}&select=created_at`),
    async insertOtp(row) { await rest("email_otps", { method: "POST", body: JSON.stringify(row) }); },
    async latestOpen(email, purpose) {
      return (await rows<OtpRow>(`email_otps?email=eq.${enc(email)}&purpose=eq.${purpose}&used_at=is.null&order=created_at.desc&limit=1&select=*`))[0] ?? null;
    },
    async setAttempts(id, attempts) { await rest(`email_otps?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ attempts }) }); },
    async closeAll(email, purpose, iso) {
      await rest(`email_otps?email=eq.${enc(email)}&purpose=eq.${purpose}&used_at=is.null`, { method: "PATCH", body: JSON.stringify({ used_at: iso }) });
    },
    async setVerified(userId, iso) { await rest(`users?id=eq.${enc(userId)}`, { method: "PATCH", body: JSON.stringify({ email_verified_at: iso }) }); },
    async setAuthPassword(authUserId, password) {
      const r = await o.fetch(`${o.url}/auth/v1/admin/users/${enc(authUserId)}`, { method: "PUT", headers: H, body: JSON.stringify({ password }) });
      return r.ok;
    },
    mail: (to, subject, html, text) => gmailSend(o.gmail, to, subject, html, text),
    async hash(s) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${o.pepper}:${s}`));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
    now: () => Date.now(),
    code() {
      const n = new Uint32Array(1);
      crypto.getRandomValues(n);
      return String(n[0] % 1_000_000).padStart(6, "0");
    },
  };
}
