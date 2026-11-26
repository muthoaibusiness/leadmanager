// push-send's logic (migrations 0074, 0076): turn new notifications rows into
// push messages for the recipients' phones. Two kinds of phone:
//   * the installed web app: a Web Push subscription (push_subscriptions),
//     encrypted and sent here (webpush-core.ts);
//   * the native app: an Expo push token (push_devices), sent through Expo's
//     push service, which holds the FCM / APNs credentials.
// Deno-free: storage and fetch are passed in, so the Node tests drive it.
//
// Two callers:
//   * anybody: { action: "vapid" } -> the public key a browser subscribes with.
//     It is public by design (it only lets a browser check who is sending).
//   * the database trigger push_notify_new: { rows: [...] } with the shared
//     key in x-push-key. Nothing else may ask for a send.

import { cronKeyGate } from "./cron-key.ts";
import { encryptPayload, generateVapidKeys, vapidAuthorization, type VapidKeys } from "./webpush-core.ts";

export type NotifRow = { id: string; user_id: string; type?: string | null; message?: string | null; lead_id?: string | null };
export type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
export type Device = { token: string; user_id: string };

export type PushDeps = {
  // app_secrets (service role only): the hook key and the VAPID key pair.
  getSecret: (name: string) => Promise<string>;
  // Stores a value only if the name is free; resolves to the value now stored.
  putSecretIfAbsent: (name: string, value: string) => Promise<string>;
  subsForUsers: (userIds: string[]) => Promise<Sub[]>;
  deleteSubs: (endpoints: string[]) => Promise<void>;
  devicesForUsers: (userIds: string[]) => Promise<Device[]>;
  deleteDevices: (tokens: string[]) => Promise<void>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  // mailto: or https: contact a push service may use about this sender.
  subject: string;
};

export type PushResult = { status: number; body: Record<string, unknown> };

// The push services browsers actually use. A subscription is whatever the
// browser hands over, and the function POSTs to it with the service role's
// network access, so anything else is refused (push_subscribe checks https only).
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge, Android
  /(^|\.)push\.apple\.com$/,                // Safari, iOS
  /(^|\.)push\.services\.mozilla\.com$/,    // Firefox
  /(^|\.)notify\.windows\.com$/,            // old Edge
];
export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

// The VAPID key pair, made on first use and kept in app_secrets. Two cold
// starts at once both generate, one insert wins, and both read the winner back.
export async function vapidKeys(d: PushDeps): Promise<VapidKeys> {
  const read = async (): Promise<VapidKeys | null> => {
    const raw = await d.getSecret("push_vapid_keys");
    if (!raw) return null;
    try { const k = JSON.parse(raw); return k.publicKey && k.privateKey ? k : null; } catch { return null; }
  };
  const have = await read();
  if (have) return have;
  const stored = await d.putSecretIfAbsent("push_vapid_keys", JSON.stringify(await generateVapidKeys()));
  return JSON.parse(stored);
}

const TITLES: Record<string, string> = {
  ASSIGNED: "New lead",
  FORWARDED: "Lead forwarded",
  FOLLOW_UP: "Follow-up reminder",
  VISIT_SCHED: "Site visit scheduled",
  VISIT_DONE: "Site visit done",
  DEAL_WON: "Deal won",
  DEAL_LOST: "Deal lost",
  HOLD_REQUEST: "Hold request",
  HOLD_APPROVED: "Hold approved",
  HOLD_REJECTED: "Hold rejected",
};

// What the service worker (src/sw.js) receives.
export function payloadFor(n: NotifRow): string {
  return JSON.stringify({
    id: n.id,
    title: TITLES[n.type || ""] || "WEPRO CRM",
    body: String(n.message || "New notification").slice(0, 300),
    leadId: n.lead_id || null,
  });
}

async function sendOne(d: PushDeps, keys: VapidKeys, sub: Sub, n: NotifRow): Promise<"sent" | "gone" | "failed"> {
  try {
    const body = await encryptPayload(sub, payloadFor(n));
    const r = await d.fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, keys, d.subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",        // the push service keeps it a day for a phone that is off
        Urgency: "high",     // wake the phone: these are things to act on
      },
      body,
    });
    if (r.status === 404 || r.status === 410) return "gone"; // the app was removed, or permission withdrawn
    return r.ok ? "sent" : "failed";
  } catch { return "failed"; }
}

// ── Native app (Expo push service) ──────────────────────────────────────────
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(t || "");

// One request carries up to 100 messages. The answer has one ticket per
// message, in order: { status: "ok" } or { status: "error", details: { error } }.
// "DeviceNotRegistered" means the app was removed: that token is forgotten.
async function sendExpo(d: PushDeps, pairs: { device: Device; n: NotifRow }[]): Promise<{ sent: number; failed: number; gone: string[] }> {
  let sent = 0, failed = 0;
  const gone: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    const messages = chunk.map(({ device, n }) => {
      const p = JSON.parse(payloadFor(n));
      return { to: device.token, title: p.title, body: p.body, data: { id: p.id, leadId: p.leadId }, sound: "default", channelId: "default", priority: "high", ttl: 86400 };
    });
    try {
      const r = await d.fetch(EXPO_PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(messages) });
      const tickets = r.ok ? ((await r.json())?.data ?? []) : [];
      chunk.forEach(({ device }, k) => {
        const t = tickets[k];
        if (t?.status === "ok") sent++;
        else if (t?.details?.error === "DeviceNotRegistered") gone.push(device.token);
        else failed++;
      });
    } catch { failed += chunk.length; }
  }
  return { sent, failed, gone };
}

export async function handlePush(req: { method: string; header: (name: string) => string | null; json: () => Promise<unknown> }, d: PushDeps): Promise<PushResult> {
  if (req.method !== "POST") return { status: 405, body: { error: "POST only" } };
  let body: { action?: string; rows?: NotifRow[] };
  try { body = (await req.json()) as typeof body; } catch { return { status: 400, body: { error: "Bad JSON" } }; }

  if (body?.action === "vapid") return { status: 200, body: { publicKey: (await vapidKeys(d)).publicKey } };

  const gate = cronKeyGate({ headers: { get: (h: string) => req.header(h) } } as unknown as Request, await d.getSecret("push_hook_key"), "x-push-key");
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };

  const rows = (Array.isArray(body?.rows) ? body.rows : []).filter((n) => n && n.id && n.user_id).slice(0, 200);
  if (!rows.length) return { status: 200, body: { sent: 0, gone: 0, failed: 0 } };

  const userIds = [...new Set(rows.map((n) => n.user_id))];
  const [subs, devices] = await Promise.all([d.subsForUsers(userIds), d.devicesForUsers(userIds)]);
  // A stored endpoint outside the known push services is never called, and removed.
  const gone = new Set(subs.filter((s) => !allowedEndpoint(s.endpoint)).map((s) => s.endpoint));
  const keys = subs.length ? await vapidKeys(d) : null;
  const jobs: Promise<void>[] = [];
  let sent = 0, failed = 0;

  // Native phones: anything that is not an Expo token is never sent, and removed.
  const badTokens = devices.filter((x) => !isExpoToken(x.token)).map((x) => x.token);
  const pairs = rows.flatMap((n) => devices.filter((x) => x.user_id === n.user_id && isExpoToken(x.token)).map((device) => ({ device, n })));
  let goneTokens: string[] = badTokens;
  if (pairs.length) {
    jobs.push(sendExpo(d, pairs).then((res) => { sent += res.sent; failed += res.failed; goneTokens = [...new Set([...goneTokens, ...res.gone])]; }));
  }

  for (const n of rows) {
    for (const s of subs) {
      if (s.user_id !== n.user_id || gone.has(s.endpoint)) continue;
      jobs.push(sendOne(d, keys as VapidKeys, s, n).then((res) => {
        if (res === "sent") sent++;
        else if (res === "gone") gone.add(s.endpoint);
        else failed++;
      }));
    }
  }
  await Promise.all(jobs);
  if (gone.size) await d.deleteSubs([...gone]);
  if (goneTokens.length) await d.deleteDevices(goneTokens);
  return { status: 200, body: { sent, gone: gone.size + goneTokens.length, failed } };
}
