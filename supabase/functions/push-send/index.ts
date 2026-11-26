// push-send: push notifications for the installed web app (Web Push, migration
// 0074) and the native app (Expo push tokens, migration 0076).
//   { action: "vapid" }            anybody: the public key a browser subscribes with
//   { rows: [notifications...] }   the push_notify_new trigger only (x-push-key)
// Logic: ../_shared/push-core.ts and webpush-core.ts, tested under Node.
//
// No secrets to set. The hook key (written by migration 0074) and the VAPID key
// pair (made here on first use) live in app_secrets. Optional: PUSH_CONTACT, a
// mailto: or https: address push services may use about this sender.
// Deploy: npx supabase functions deploy push-send --no-verify-jwt --project-ref sbqmougcvnplgjgihpwe
// --no-verify-jwt because the trigger calls without a session; the send path
// checks x-push-key itself.
import { handlePush, type PushDeps, type Sub, type Device } from "../_shared/push-core.ts";

const env = (k: string) => Deno.env.get(k);
const url = env("SUPABASE_URL") ?? "";
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const H = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const inList = (vals: string[]) => `in.(${vals.map((v) => `"${v.replace(/["\]/g, "\$&")}"`).join(",")})`;

async function getSecret(name: string): Promise<string> {
  const r = await fetch(`${url}/rest/v1/app_secrets?name=eq.${name}&select=value`, { headers: H });
  if (!r.ok) throw new Error(`app_secrets read failed (HTTP ${r.status})`);
  return (await r.json())[0]?.value ?? "";
}

const deps: PushDeps = {
  getSecret,
  putSecretIfAbsent: async (name, value) => {
    const r = await fetch(`${url}/rest/v1/app_secrets?on_conflict=name`, {
      method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ name, value }),
    });
    if (!r.ok) throw new Error(`app_secrets write failed (HTTP ${r.status})`);
    return getSecret(name);
  },
  subsForUsers: async (userIds) => {
    const r = await fetch(`${url}/rest/v1/push_subscriptions?user_id=${encodeURIComponent(inList(userIds))}&select=endpoint,user_id,p256dh,auth`, { headers: H });
    if (!r.ok) throw new Error(`push_subscriptions read failed (HTTP ${r.status})`);
    return (await r.json()) as Sub[];
  },
  deleteSubs: async (endpoints) => {
    await fetch(`${url}/rest/v1/push_subscriptions?endpoint=${encodeURIComponent(inList(endpoints))}`, { method: "DELETE", headers: H });
  },
  // push_devices is migration 0076; before it is applied there are simply none.
  devicesForUsers: async (userIds) => {
    const r = await fetch(`${url}/rest/v1/push_devices?user_id=${encodeURIComponent(inList(userIds))}&select=token,user_id`, { headers: H });
    return r.ok ? ((await r.json()) as Device[]) : [];
  },
  deleteDevices: async (tokens) => {
    await fetch(`${url}/rest/v1/push_devices?token=${encodeURIComponent(inList(tokens))}`, { method: "DELETE", headers: H });
  },
  fetch: (u, i) => fetch(u, i),
  subject: env("PUSH_CONTACT") || url,
};

const CORS = {
  "Access-Control-Allow-Origin": env("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const r = await handlePush({ method: req.method, header: (h) => req.headers.get(h), json: () => req.json() }, deps);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("push-send error", e);
    return new Response(JSON.stringify({ error: "push-send failed" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
