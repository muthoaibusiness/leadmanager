// node --test supabase/functions/_shared/push-core.test.ts
// The encryption is checked against a second implementation: the receiving side
// of RFC 8291, written here with node:crypto rather than WebCrypto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, hkdfSync, createDecipheriv, createPublicKey, verify } from "node:crypto";
import { b64url, unb64url, encryptPayload, generateVapidKeys, vapidAuthorization } from "./webpush-core.ts";
import { handlePush, allowedEndpoint, payloadFor, vapidKeys, isExpoToken, EXPO_PUSH_URL, type PushDeps, type Sub, type Device } from "./push-core.ts";

const u8 = (b: Buffer | ArrayBuffer) => new Uint8Array(b as ArrayBuffer);

// A browser: its key pair and auth secret, and how it reads a push message.
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const pub = u8(ecdh.getPublicKey());
  const decrypt = (body: Uint8Array): string => {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    const idLen = body[20];
    const senderPub = body.slice(21, 21 + idLen);
    const cipher = body.slice(21 + idLen);
    assert.equal(rs, 4096);
    assert.equal(idLen, 65);
    const shared = u8(ecdh.computeSecret(senderPub));
    const info = Buffer.concat([Buffer.from("WebPush: info\0"), pub, senderPub]);
    const ikm = u8(hkdfSync("sha256", shared, auth, info, 32));
    const cek = u8(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = u8(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(cipher.slice(cipher.length - 16));
    const plain = Buffer.concat([d.update(cipher.slice(0, cipher.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
    return plain.subarray(0, plain.length - 1).toString("utf8");
  };
  return { p256dh: b64url(pub), auth: b64url(auth), decrypt };
}

test("base64url round-trips every byte value", () => {
  const all = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual(unb64url(b64url(all)), all);
  assert.doesNotMatch(b64url(all), /[+/=]/);
});

test("a browser can read what encryptPayload wrote", async () => {
  const b = browser();
  const text = JSON.stringify({ id: "n1", title: "New lead", body: "নতুন লিড: Rahim (from Karim)", leadId: "L1" });
  const body = await encryptPayload({ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: b.p256dh, auth: b.auth }, text);
  assert.equal(b.decrypt(body), text);
});

test("two messages to one browser share nothing (fresh salt and key)", async () => {
  const b = browser();
  const t = { endpoint: "https://fcm.googleapis.com/x", p256dh: b.p256dh, auth: b.auth };
  const [m1, m2] = [await encryptPayload(t, "same"), await encryptPayload(t, "same")];
  assert.notDeepEqual(m1.slice(0, 16), m2.slice(0, 16));
  assert.notDeepEqual(m1.slice(21, 86), m2.slice(21, 86));
  assert.equal(b.decrypt(m1), "same");
  assert.equal(b.decrypt(m2), "same");
});

test("another browser cannot read it; a bad subscription is refused", async () => {
  const [a, other] = [browser(), browser()];
  const body = await encryptPayload({ endpoint: "https://fcm.googleapis.com/x", p256dh: a.p256dh, auth: a.auth }, "secret");
  assert.throws(() => other.decrypt(body));
  await assert.rejects(encryptPayload({ endpoint: "https://x", p256dh: b64url(new Uint8Array(10)), auth: a.auth }, "x"));
  await assert.rejects(encryptPayload({ endpoint: "https://x", p256dh: a.p256dh, auth: b64url(new Uint8Array(8)) }, "x"));
});

test("the VAPID header is a token the public key verifies, for that push service, 12 h", async () => {
  const keys = await generateVapidKeys();
  assert.equal(unb64url(keys.publicKey).length, 65);
  assert.equal(unb64url(keys.privateKey).length, 32);
  const h = await vapidAuthorization("https://web.push.apple.com/abc/def", keys, "https://example.supabase.co", 1_000_000);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(unb64url(m[1])).toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(unb64url(m[2])).toString()), { aud: "https://web.push.apple.com", exp: 1_000_000 + 43200, sub: "https://example.supabase.co" });
  const pub = unb64url(keys.publicKey);
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) }, format: "jwk" });
  assert.equal(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, unb64url(m[3])), true);
});

test("only real push services are called", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/a", "https://web.push.apple.com/a", "https://updates.push.services.mozilla.com/wpush/v2/a", "https://db5p.notify.windows.com/w/?token=a"]) assert.equal(allowedEndpoint(ok), true, ok);
  for (const bad of ["http://fcm.googleapis.com/a", "https://evil.example/a", "https://fcm.googleapis.com.evil.example/a", "https://169.254.169.254/", "https://notpush.apple.com/a", "nope"]) assert.equal(allowedEndpoint(bad), false, bad);
});

test("payload: title by type, message capped, lead id carried", () => {
  assert.deepEqual(JSON.parse(payloadFor({ id: "n1", user_id: "u1", type: "FOLLOW_UP", message: "Call Rahim", lead_id: "L1" })), { id: "n1", title: "Follow-up reminder", body: "Call Rahim", leadId: "L1" });
  const p = JSON.parse(payloadFor({ id: "n2", user_id: "u1", type: "SOMETHING_NEW", message: "x".repeat(900) }));
  assert.equal(p.title, "WEPRO CRM");
  assert.equal(p.body.length, 300);
  assert.equal(p.leadId, null);
});

// ── handlePush ──────────────────────────────────────────────────────────────
const HOOK = "k".repeat(64);
function world(subs: Sub[], respond: (url: string) => number = () => 201, devices: Device[] = [], expoTickets: (messages: { to: string }[]) => unknown = (m) => ({ data: m.map(() => ({ status: "ok" })) })) {
  const secrets = new Map<string, string>([["push_hook_key", HOOK]]);
  const calls: { url: string; init: RequestInit }[] = [];
  const deleted: string[] = [];
  const deletedDevices: string[] = [];
  const deps: PushDeps = {
    getSecret: async (n) => secrets.get(n) ?? "",
    putSecretIfAbsent: async (n, v) => { if (!secrets.has(n)) secrets.set(n, v); return secrets.get(n)!; },
    subsForUsers: async (ids) => subs.filter((s) => ids.includes(s.user_id)),
    deleteSubs: async (e) => { deleted.push(...e); },
    devicesForUsers: async (ids) => devices.filter((x) => ids.includes(x.user_id)),
    deleteDevices: async (t) => { deletedDevices.push(...t); },
    fetch: async (url, init) => {
      calls.push({ url, init: init! });
      if (url === EXPO_PUSH_URL) {
        const status = respond(url);
        return status >= 400 ? new Response("down", { status }) : new Response(JSON.stringify(expoTickets(JSON.parse(init!.body as string))), { status: 200 });
      }
      return new Response(null, { status: respond(url) });
    },
    subject: "https://example.supabase.co",
  };
  return { deps, secrets, calls, deleted, deletedDevices };
}
const req = (body: unknown, key?: string, method = "POST") => ({ method, header: (h: string) => (h === "x-push-key" ? key ?? null : null), json: async () => body });

test("vapid: anybody gets the public key; it is made once and kept", async () => {
  const w = world([]);
  const a = await handlePush(req({ action: "vapid" }), w.deps);
  const b = await handlePush(req({ action: "vapid" }), w.deps);
  assert.equal(a.status, 200);
  assert.equal(unb64url(a.body.publicKey as string).length, 65);
  assert.equal(a.body.publicKey, b.body.publicKey);
  assert.equal(JSON.stringify(a.body).includes(JSON.parse(w.secrets.get("push_vapid_keys")!).privateKey), false);
  assert.equal((await vapidKeys(w.deps)).publicKey, a.body.publicKey);
});

test("send: refused without the hook key, with a wrong one, and when none is set", async () => {
  const w = world([]);
  const rows = [{ id: "n1", user_id: "u1", message: "m" }];
  assert.equal((await handlePush(req({ rows }), w.deps)).status, 401);
  assert.equal((await handlePush(req({ rows }, "x".repeat(64)), w.deps)).status, 401);
  assert.equal((await handlePush(req({ rows }, HOOK, "GET"), w.deps)).status, 405);
  w.secrets.delete("push_hook_key");
  assert.equal((await handlePush(req({ rows }, ""), w.deps)).status, 503);
  assert.equal(w.calls.length, 0);
});

test("send: each recipient's phones get their own message, readable only there", async () => {
  const [p1, p2, p3] = [browser(), browser(), browser()];
  const subs: Sub[] = [
    { endpoint: "https://fcm.googleapis.com/fcm/send/1", user_id: "u1", p256dh: p1.p256dh, auth: p1.auth },
    { endpoint: "https://web.push.apple.com/2", user_id: "u1", p256dh: p2.p256dh, auth: p2.auth },
    { endpoint: "https://fcm.googleapis.com/fcm/send/3", user_id: "u2", p256dh: p3.p256dh, auth: p3.auth },
  ];
  const w = world(subs);
  const r = await handlePush(req({ rows: [
    { id: "n1", user_id: "u1", type: "ASSIGNED", message: "New lead assigned: Rahim", lead_id: "L1" },
    { id: "n2", user_id: "u2", type: "DEAL_WON", message: "Deal won: Karim" },
    { id: "n3", user_id: "u9", type: "ASSIGNED", message: "nobody's phone" },
  ] }, HOOK), w.deps);
  assert.deepEqual(r, { status: 200, body: { sent: 3, gone: 0, failed: 0 } });
  const to = (e: string) => w.calls.find((c) => c.url === e)!;
  assert.equal(JSON.parse(p1.decrypt(to(subs[0].endpoint).init.body as Uint8Array)).body, "New lead assigned: Rahim");
  assert.equal(JSON.parse(p2.decrypt(to(subs[1].endpoint).init.body as Uint8Array)).leadId, "L1");
  assert.equal(JSON.parse(p3.decrypt(to(subs[2].endpoint).init.body as Uint8Array)).title, "Deal won");
  const h = to(subs[1].endpoint).init.headers as Record<string, string>;
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.equal(h.TTL, "86400");
  assert.match(h.Authorization, /^vapid t=.+, k=.+$/);
  assert.equal(w.deleted.length, 0);
});

test("send: a phone that removed the app is forgotten; a failing one is kept; a made-up endpoint is never called", async () => {
  const b = browser();
  const sub = (endpoint: string): Sub => ({ endpoint, user_id: "u1", p256dh: b.p256dh, auth: b.auth });
  const w = world(
    [sub("https://fcm.googleapis.com/gone"), sub("https://fcm.googleapis.com/down"), sub("https://fcm.googleapis.com/ok"), sub("https://internal.example/steal")],
    (url) => (url.endsWith("/gone") ? 410 : url.endsWith("/down") ? 503 : 201),
  );
  const r = await handlePush(req({ rows: [{ id: "n1", user_id: "u1", message: "m" }] }, HOOK), w.deps);
  assert.deepEqual(r.body, { sent: 1, gone: 2, failed: 1 });
  assert.deepEqual(w.deleted.sort(), ["https://fcm.googleapis.com/gone", "https://internal.example/steal"]);
  assert.equal(w.calls.some((c) => c.url.includes("internal.example")), false);
});

test("send: nothing to send is not an error", async () => {
  const w = world([]);
  assert.deepEqual((await handlePush(req({ rows: [] }, HOOK), w.deps)).body, { sent: 0, gone: 0, failed: 0 });
  assert.deepEqual((await handlePush(req({ rows: [{ id: "n1", user_id: "u1", message: "m" }] }, HOOK), w.deps)).body, { sent: 0, gone: 0, failed: 0 });
  assert.equal(w.calls.length, 0);
});

// ── Native app (Expo) ───────────────────────────────────────────────────────
test("an Expo token is recognised; anything else is not", () => {
  for (const ok of ["ExponentPushToken[abcDEF123_-]", "ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]"]) assert.equal(isExpoToken(ok), true, ok);
  for (const bad of ["", "ExponentPushToken[]", "https://exp.host/x", "ExponentPushToken[a] extra", "fcm:abc"]) assert.equal(isExpoToken(bad), false, bad);
});

test("native: each phone of the recipient gets the message through Expo, in one request", async () => {
  const devices: Device[] = [
    { token: "ExponentPushToken[aaa]", user_id: "u1" },
    { token: "ExponentPushToken[bbb]", user_id: "u1" },
    { token: "ExponentPushToken[ccc]", user_id: "u2" },
  ];
  const w = world([], () => 201, devices);
  const r = await handlePush(req({ rows: [
    { id: "n1", user_id: "u1", type: "ASSIGNED", message: "New lead assigned: Rahim", lead_id: "L1" },
    { id: "n2", user_id: "u9", type: "ASSIGNED", message: "a phone nobody has" },
  ] }, HOOK), w.deps);
  assert.deepEqual(r.body, { sent: 2, gone: 0, failed: 0 });
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].url, EXPO_PUSH_URL);
  const sentMsgs = JSON.parse(w.calls[0].init.body as string);
  assert.deepEqual(sentMsgs.map((m: { to: string }) => m.to), ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"]);
  assert.deepEqual(sentMsgs[0], { to: "ExponentPushToken[aaa]", title: "New lead", body: "New lead assigned: Rahim", data: { id: "n1", leadId: "L1" }, sound: "default", channelId: "default", priority: "high", ttl: 86400 });
  // No web subscription was involved, so no VAPID key pair was made.
  assert.equal(w.secrets.has("push_vapid_keys"), false);
});

test("native: a removed app is forgotten, an error is counted, a made-up token is never sent", async () => {
  const devices: Device[] = [
    { token: "ExponentPushToken[ok]", user_id: "u1" },
    { token: "ExponentPushToken[gone]", user_id: "u1" },
    { token: "ExponentPushToken[err]", user_id: "u1" },
    { token: "https://internal.example/steal", user_id: "u1" },
  ];
  const w = world([], () => 201, devices, (m) => ({ data: m.map((x) => (x.to.includes("gone") ? { status: "error", details: { error: "DeviceNotRegistered" } } : x.to.includes("err") ? { status: "error", details: { error: "MessageRateExceeded" } } : { status: "ok" })) }));
  const r = await handlePush(req({ rows: [{ id: "n1", user_id: "u1", message: "m" }] }, HOOK), w.deps);
  assert.deepEqual(r.body, { sent: 1, gone: 2, failed: 1 });
  assert.deepEqual(w.deletedDevices.sort(), ["ExponentPushToken[gone]", "https://internal.example/steal"]);
  assert.equal(JSON.stringify(w.calls).includes("internal.example"), false);
});

test("native: Expo being down fails the messages and forgets nobody", async () => {
  const w = world([], () => 503, [{ token: "ExponentPushToken[aaa]", user_id: "u1" }]);
  const r = await handlePush(req({ rows: [{ id: "n1", user_id: "u1", message: "m" }] }, HOOK), w.deps);
  assert.deepEqual(r.body, { sent: 0, gone: 0, failed: 1 });
  assert.equal(w.deletedDevices.length, 0);
});

test("an account with both kinds of phone gets both", async () => {
  const b = browser();
  const w = world([{ endpoint: "https://fcm.googleapis.com/fcm/send/1", user_id: "u1", p256dh: b.p256dh, auth: b.auth }], () => 201, [{ token: "ExponentPushToken[aaa]", user_id: "u1" }]);
  const r = await handlePush(req({ rows: [{ id: "n1", user_id: "u1", message: "hello" }] }, HOOK), w.deps);
  assert.deepEqual(r.body, { sent: 2, gone: 0, failed: 0 });
  assert.deepEqual(w.calls.map((c) => c.url).sort(), [EXPO_PUSH_URL, "https://fcm.googleapis.com/fcm/send/1"].sort());
});
