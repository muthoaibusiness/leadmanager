// The installed app's link to its service worker (src/sw.js): registration,
// updates, and what the user tapped in a push notification.
//
// Updates: a new version is downloaded in the background and waits. It is
// switched to only at launch, before anything was touched; after that it waits
// for the next launch. The page is never reloaded under a half-typed form.

// Opened from the home screen (Android, desktop install) or iOS "Add to Home Screen".
export function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  catch { return false; }
}

// iPadOS reports itself as a Mac with touch points.
export function isIOS() {
  try { return /iP(hone|od|ad)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  catch { return false; }
}

// ── Push notification taps ──────────────────────────────────────────────────
// The service worker says what was tapped ({ id, leadId }). It can arrive before
// the app has a signed-in user to act on it, so it is held until taken.
let _click = null;
const _clickSubs = new Set();
export function onPushClick(fn) { _clickSubs.add(fn); return () => _clickSubs.delete(fn); }
export function takePushClick() { const c = _click; _click = null; return c; }

const APPLY_WINDOW_MS = 8000;

export function registerServiceWorker() {
  // Not in dev: a service worker there would serve stale modules over Vite's.
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const startedAt = Date.now();
  let touched = false;
  const touch = () => { touched = true; };
  window.addEventListener('pointerdown', touch, { once: true, capture: true, passive: true });
  window.addEventListener('keydown', touch, { once: true, capture: true, passive: true });

  sw.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'PUSH_CLICK') return;
    _click = { id: e.data.id || null, leadId: e.data.leadId || null };
    _clickSubs.forEach((fn) => fn());
  });

  // Reload only for a switch this page asked for (not the first install, which
  // also changes the controller).
  let asked = false;
  sw.addEventListener('controllerchange', () => { if (asked) window.location.reload(); });
  const apply = (worker) => {
    if (asked || !worker || !sw.controller) return;
    if (touched || Date.now() - startedAt > APPLY_WINDOW_MS) return;
    asked = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  };

  const start = async () => {
    try {
      const reg = await sw.register('/sw.js');
      apply(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') apply(w); });
      });
      // A phone keeps the app alive for days without a page load, and only a
      // page load checks for a new version on its own.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      // If a notification tap opened this window, ask what was tapped.
      const ready = await sw.ready;
      if (ready.active) ready.active.postMessage({ type: 'CLIENT_READY' });
    } catch (e) { console.warn('[pwa] service worker not registered:', e); }
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
