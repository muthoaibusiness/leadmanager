// google-oauth: connects the Gmail account that sends email-otp codes.
//   https://<project>.supabase.co/functions/v1/google-oauth/start?key=<GOOGLE_SETUP_KEY>
//   https://<project>.supabase.co/functions/v1/google-oauth/callback   ← add this to the
//     OAuth client's "Authorized redirect URIs" in Google Cloud Console.
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_SETUP_KEY
// (scripts/google-oauth-setup.mjs sets all three). Needs migration 0069.
// Deploy: npx supabase functions deploy google-oauth --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
// (--no-verify-jwt: Google's redirect carries no Supabase token.)
//   https://<project>.supabase.co/functions/v1/google-oauth/test?key=<GOOGLE_SETUP_KEY>&to=<email>
//     sends one test email through the connected Gmail (setup key required).
import { startOauth, finishOauth, sameKey } from "../_shared/google-oauth-core.ts";
import { gmailSend } from "../_shared/gmail.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const url = env("SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const H = { apikey: key, authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const rest = (path: string, init: RequestInit = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

const deps = {
  clientId: env("GOOGLE_CLIENT_ID"),
  clientSecret: env("GOOGLE_CLIENT_SECRET"),
  setupKey: env("GOOGLE_SETUP_KEY"),
  redirectUri: `${url}/functions/v1/google-oauth/callback`,
  async saveState(state: string) {
    const r = await rest("oauth_states", { method: "POST", body: JSON.stringify({ state }) });
    if (!r.ok) throw new Error(`oauth_states: HTTP ${r.status}`);
    await rest(`oauth_states?created_at=lt.${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`, { method: "DELETE" });
  },
  async takeState(state: string) {
    const r = await rest(`oauth_states?state=eq.${encodeURIComponent(state)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    return r.ok ? ((await r.json())[0] ?? null) : null;
  },
  async saveSecret(name: string, value: string) {
    const r = await rest("app_secrets?on_conflict=name", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ name, value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`app_secrets: HTTP ${r.status}`);
  },
  fetch: (u: string, i?: RequestInit) => fetch(u, i),
  now: () => Date.now(),
  random() { const b = new Uint8Array(24); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); },
};

async function appSecret(name: string): Promise<string> {
  const r = await rest(`app_secrets?name=eq.${name}&select=value`);
  return r.ok ? ((await r.json())[0]?.value ?? "") : "";
}

// One test email, to check the Gmail connection end to end.
async function sendTest(k: string, to: string): Promise<Response> {
  const text = (status: number, msg: string) => new Response(msg + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (!deps.setupKey || !sameKey(k, deps.setupKey)) return text(403, "Not allowed: this link's key is not valid.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return text(400, "Add &to=<email address>.");
  const sender = await appSecret("mail_from_email");
  try {
    await gmailSend({
      clientId: deps.clientId, clientSecret: deps.clientSecret,
      refreshToken: () => appSecret("google_refresh_token"),
      from: async () => `WEPRO CRM <${sender || "me"}>`,
      fetch: (u2, i) => fetch(u2, i),
    }, to, "WEPRO CRM test email", `<p style="font-family:Arial">This is a test from WEPRO CRM. Email codes are working.</p>`, "This is a test from WEPRO CRM. Email codes are working.");
    return text(200, `Sent a test email from ${sender || "the connected Gmail"} to ${to}. Check the inbox (and Spam).`);
  } catch (e) {
    console.error("google-oauth test send failed", e);
    return text(502, `Sending failed: ${String((e as Error).message || e).slice(0, 300)}`);
  }
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (u.pathname.endsWith("/test")) return sendTest(u.searchParams.get("key") ?? "", u.searchParams.get("to") ?? "");
  try {
    const out = u.pathname.endsWith("/start") ? await startOauth(u.searchParams.get("key") ?? "", deps)
      : u.pathname.endsWith("/callback") ? await finishOauth(u.searchParams, deps)
        : { status: 404, html: "Not found" };
    if (out.location) return new Response(null, { status: 302, headers: { Location: out.location, "Cache-Control": "no-store" } });
    return new Response(out.html, { status: out.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("google-oauth error", e);
    return new Response("Something went wrong. Is migration 0069 applied?", { status: 500 });
  }
});
