// Push notifications for the installed app (migration 0074, Edge Function
// push-send, service worker src/sw.js).
//
// A phone that installed the app registers a Web Push subscription for the
// signed-in account; the server then sends every new notification to it, app
// open or closed. Only the installed app subscribes: a browser tab keeps the
// quiet behaviour of pushNotify.js (one unread summary per page load), because
// there every notification would otherwise raise an OS popup.
//
// iOS: Web Push exists only for an app added to the Home Screen (16.4+), and
// permission can only be asked from a tap. enablePush() is that tap (the bell
// panel's button); syncPush() is the silent part, run at every sign-in.
import { SB_URL, SB_KEY, SB_H, ensureFreshToken } from './supabase.js';
import { isStandalone } from './pwa.js';

const KEY_CACHE = 'pcrm_push_key';

export function pushSupported() {
  try {
    return isStandalone() && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
  } catch { return false; }
}

// 'unsupported' | 'default' (not asked yet) | 'granted' | 'denied'
export function pushPermission() {
  return pushSupported() ? Notification.permission : 'unsupported';
}

const b64url = (buf) => {
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// The server's public key, which a subscription is bound to. Asked for at each
// sign-in so a replaced key is noticed; the stored copy covers a failed request.
async function serverKey() {
  let cached = null;
  try { cached = localStorage.getItem(KEY_CACHE); } catch { /* storage disabled */ }
  try {
    const r = await fetch(`${SB_URL}/functions/v1/push-send`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vapid' }),
    });
    const key = r.ok ? (await r.json()).publicKey : null;
    if (!key) return cached;
    try { localStorage.setItem(KEY_CACHE, key); } catch { /* storage disabled */ }
    return key;
  } catch { return cached; }
}

// `token`: a session's access token, for a call made while that session is
// being ended (sign-out); otherwise the current session's.
async function rpc(fn, args, token) {
  if (!token) await ensureFreshToken();
  const headers = token ? { ...SB_H, Authorization: `Bearer ${token}` } : { ...SB_H };
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  return r.ok;
}

// Make sure this phone is registered for the signed-in account. Does nothing
// (and asks nothing) unless notifications are already allowed. Resolves to
// whether the phone is registered.
export async function syncPush() {
  try {
    if (!SB_URL || !pushSupported() || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const key = await serverKey();
    if (!key) return false;
    let sub = await reg.pushManager.getSubscription();
    // Bound to another server key (the key pair was replaced): start again.
    const bound = sub && sub.options && sub.options.applicationServerKey;
    if (sub && bound && b64url(bound) !== key) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(key) });
    const j = sub.toJSON();
    return await rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
  } catch (e) { console.warn('[push] not registered:', e); return false; }
}

// Ask for permission and register. Call from a tap (iOS refuses otherwise).
// Resolves to 'on' | 'denied' | 'default' (dismissed) | 'failed' | 'unsupported'.
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
  if (perm !== 'granted') return perm;
  return (await syncPush()) ? 'on' : 'failed';
}

// Sign-out: this phone stops receiving the account's notifications. Sign-out
// does not wait for it (auth.js), so it is given the ending session's token.
// The subscription is cancelled on the phone whether or not the server could be
// told: a cancelled one is refused by the push service, and push-send then
// removes its row.
export async function disablePush(token) {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    await sub.unsubscribe();
    if (token) await rpc('push_unsubscribe', { p_endpoint: sub.endpoint }, token);
  } catch { /* offline: see above */ }
}
