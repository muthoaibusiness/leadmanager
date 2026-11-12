// email-otp: 6-digit email codes, sent through the Gmail API (migration 0069).
//   verify.send / verify.check   signed-in user verifies their own email (Profile)
//   reset.send / reset.confirm   "Forgot password?" on the login page (no session)
// Logic: ../_shared/email-otp-core.ts, tested under Node.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET; optional MAIL_FROM, OTP_PEPPER.
// The Gmail refresh token and sender address come from app_secrets, written by
// the google-oauth function's one-time sign-in (GOOGLE_REFRESH_TOKEN overrides).
// Deploy: npx supabase functions deploy email-otp --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
// --no-verify-jwt because the reset actions run before sign-in; verify.* checks
// the session itself (actor.ts).
import { handleEmailOtp } from "../_shared/email-otp-core.ts";
import { restOtpDeps } from "../_shared/email-otp-rest.ts";
import { verifiedActor, actorDepsFromEnv, ActorError } from "../_shared/actor.ts";

const env = (k: string) => Deno.env.get(k);
const actorDeps = actorDepsFromEnv(env);
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
// app_secrets values, read fresh each time (cheap; a reconnect applies at once).
async function appSecret(name: string): Promise<string> {
  try {
    const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/app_secrets?name=eq.${name}&select=value`, { headers: H });
    return r.ok ? ((await r.json())[0]?.value ?? "") : "";
  } catch { return ""; }
}
const deps = restOtpDeps({
  url: env("SUPABASE_URL") ?? "",
  serviceKey,
  pepper: env("OTP_PEPPER") ?? serviceKey,
  fetch: (u, i) => fetch(u, i),
  gmail: {
    clientId: env("GOOGLE_CLIENT_ID") ?? "",
    clientSecret: env("GOOGLE_CLIENT_SECRET") ?? "",
    refreshToken: async () => env("GOOGLE_REFRESH_TOKEN") || (await appSecret("google_refresh_token")),
    from: async () => env("MAIL_FROM") || `WEPRO CRM <${(await appSecret("mail_from_email")) || "me"}>`,
    fetch: (u, i) => fetch(u, i),
  },
});
const CORS = {
  "Access-Control-Allow-Origin": env("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  try {
    const needsSession = String(body.action ?? "").startsWith("verify.");
    const actor = needsSession ? await verifiedActor(req, actorDeps) : null;
    const r = await handleEmailOtp(body, actor, deps);
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof ActorError) return json({ ok: false, error: e.message }, e.status);
    console.error("email-otp error", e);
    return json({ ok: false, error: "Could not send the email right now. Try again in a minute." }, 500);
  }
});
