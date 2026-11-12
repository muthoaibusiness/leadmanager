// Sends mail through the Gmail API as the account that granted the refresh token.
// The token and sender come from the google-oauth function's one-time sign-in
// (stored in app_secrets, 0069); GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are
// Supabase secrets. Deno-free: fetch and the lookups are passed in.

export type GmailCfg = {
  clientId: string; clientSecret: string;
  refreshToken: () => Promise<string>;
  from: () => Promise<string>; // e.g. "WEPRO CRM <crm@gmail.com>"
  fetch: (u: string, i?: RequestInit) => Promise<Response>;
};

let cached: { token: string; until: number } | null = null;

async function accessToken(c: GmailCfg, refreshToken: string): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const r = await c.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: c.clientId, client_secret: c.clientSecret, refresh_token: refreshToken }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`gmail token: HTTP ${r.status} ${j.error || ""}`.trim());
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

const b64 = (bytes: Uint8Array) => { let s = ""; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const b64url = (s: string) => b64(new TextEncoder().encode(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(new TextEncoder().encode(s))}?=`);

export function mimeMessage(from: string, to: string, subject: string, html: string, text: string) {
  const boundary = "b" + Math.random().toString(36).slice(2);
  return [
    `From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(new TextEncoder().encode(text)),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(new TextEncoder().encode(html)),
    `--${boundary}--`, "",
  ].join("\r\n");
}

export async function gmailSend(c: GmailCfg, to: string, subject: string, html: string, text: string) {
  const refresh = await c.refreshToken();
  if (!c.clientId || !c.clientSecret || !refresh) throw new Error("gmail: not connected. Run the google-oauth setup (scripts/google-oauth-setup.mjs).");
  const token = await accessToken(c, refresh);
  const r = await c.fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(mimeMessage(await c.from(), to, subject, html, text)) }),
  });
  if (!r.ok) throw new Error(`gmail send: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}
