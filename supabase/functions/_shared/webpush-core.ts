// Web Push, on WebCrypto alone (no library): the message encryption of RFC 8291
// (aes128gcm, RFC 8188) and the VAPID signature of RFC 8292. Deno-free and
// fetch-free, so the Node tests drive it; push-core.ts does the sending.
//
// A browser's subscription is { endpoint, p256dh, auth }: where to POST, the
// browser's public key, and a shared secret. Only that browser can read the
// message; the push service in the middle (Google, Apple, Mozilla) cannot.

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// The server's identity: publicKey is the 65-byte uncompressed P-256 point
// (what the browser takes as applicationServerKey), privateKey its 32-byte
// scalar, both base64url. The format every Web Push tool uses.
export type VapidKeys = { publicKey: string; privateKey: string };

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: b64url(raw), privateKey: jwk.d as string };
}

function vapidSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = unb64url(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key is not an uncompressed P-256 point");
  const jwk = { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: keys.privateKey };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

// The Authorization header a push service checks: a short-lived token, signed
// with the VAPID key, saying who is sending to this push service (aud).
// `subject` is a mailto: or https: contact, required by the standard.
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // 12 hours: the standard allows 24, and Apple refuses anything longer.
  const body = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowS + 12 * 3600, sub: subject })));
  const key = await vapidSigningKey(keys);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

// Encrypts `payload` for one browser. Returns the request body; send it with
// Content-Encoding: aes128gcm. One record, so the payload must stay under the
// ~4 KB a push service accepts (push-core.ts keeps messages short).
export async function encryptPayload(target: PushTarget, payload: string): Promise<Uint8Array> {
  const uaPublic = unb64url(target.p256dh);
  const authSecret = unb64url(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("subscription key is not an uncompressed P-256 point");
  if (authSecret.length !== 16) throw new Error("subscription auth secret is not 16 bytes");

  // A fresh key pair for this one message, and the secret it shares with the browser.
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  // RFC 8291 section 3.4.
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, localPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 ends the last (only) record. RFC 8188 section 2.
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));

  // Header: salt (16) | record size (4, big-endian) | key length (1) | our public key.
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([localPublic.length]), localPublic, cipher);
}
