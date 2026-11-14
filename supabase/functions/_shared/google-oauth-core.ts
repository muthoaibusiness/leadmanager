// One-time Gmail connection for email-otp, done entirely on Supabase:
//   GET  /google-oauth/start?key=<GOOGLE_SETUP_KEY>  → redirect to Google's consent page
//   GET  /google-oauth/callback?code&state           → Google returns here; the
//        refresh token and the sender address are stored in app_secrets (0069).
// The setup key keeps strangers from connecting their own Gmail; the state row
// (10 minutes, single use) ties the callback to a start this server issued.
// Deno-free: storage and fetch are passed in.

export const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];
export const STATE_TTL_MS = 10 * 60_000;

export type OauthDeps = {
  clientId: string; clientSecret: string; setupKey: string; redirectUri: string;
  saveState(state: string): Promise<void>;
  takeState(state: string): Promise<{ created_at: string } | null>; // deletes it
  saveSecret(name: string, value: string): Promise<void>;
  fetch: (u: string, i?: RequestInit) => Promise<Response>;
  now(): number;
  random(): string;
};

type Out = { status: number; html?: string; location?: string };
// Supabase serves function responses on its own domain as plain text (HTML is
// shown as source), so the result pages are short plain-text messages.
const page = (status: number, title: string, msg: string): Out => ({ status, html: `${title}

${msg.replace(/<[^>]+>/g, "")}
` });

// Constant-time string compare (the setup key).
export function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// The email inside Google's id_token (already trusted: it came straight from
// Google's token endpoint over TLS, not from the browser).
export function idTokenEmail(idToken: unknown): string {
  try {
    const part = String(idToken).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String(JSON.parse(atob(part.padEnd(part.length + (4 - part.length % 4) % 4, "="))).email || "");
  } catch { return ""; }
}

export async function startOauth(key: string, d: OauthDeps): Promise<Out> {
  if (!d.clientId || !d.clientSecret || !d.setupKey) return page(500, "Not configured", "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_SETUP_KEY first (scripts/google-oauth-setup.mjs).");
  if (!sameKey(key, d.setupKey)) return page(403, "Not allowed", "This setup link is not valid.");
  const state = d.random();
  await d.saveState(state);
  const q = new URLSearchParams({
    client_id: d.clientId, redirect_uri: d.redirectUri, response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", state,
  });
  return { status: 302, location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
}

export async function finishOauth(params: URLSearchParams, d: OauthDeps): Promise<Out> {
  const state = params.get("state") || "";
  const row = state ? await d.takeState(state) : null;
  if (!row || d.now() - Date.parse(row.created_at) > STATE_TTL_MS) return page(400, "Link expired", "Start the setup again from the setup link.");
  if (params.get("error")) return page(400, "Not connected", "Access was not granted on the Google page.");
  const code = params.get("code");
  if (!code) return page(400, "Not connected", "Google sent no code. Start again.");
  const r = await d.fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: d.clientId, client_secret: d.clientSecret, redirect_uri: d.redirectUri, grant_type: "authorization_code" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) {
    return page(502, "Not connected", "Google sent no refresh token. Remove WEPRO at myaccount.google.com/permissions and start again.");
  }
  const scopes = String(j.scope || "");
  if (!scopes.includes("gmail.send")) return page(400, "Not connected", "Sending email was not allowed. Start again and tick the Gmail permission.");
  await d.saveSecret("google_refresh_token", j.refresh_token);
  const email = idTokenEmail(j.id_token);
  if (email) await d.saveSecret("mail_from_email", email);
  return page(200, "Gmail connected", `WEPRO CRM will send verification and password reset codes from <b>${email || "this Gmail account"}</b>. You can close this tab.`);
}
