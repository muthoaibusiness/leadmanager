// Service worker for the installed app (built by vite-plugin-pwa, registered by
// src/lib/pwa.js). Three jobs:
//
//   1. Keep the app's own files on the device, so it opens at once and without
//      a signal. The list (self.__WB_MANIFEST) is injected at build time.
//   2. Keep fonts and pictures that were already looked at.
//   3. Show push notifications sent by the push-send Edge Function.
//
// Supabase REST, auth, realtime and Edge Function calls are NOT handled here:
// they always go to the network. The data cache is src/lib/db.js alone, so
// mergeDB's rules and the tenant checks stay in one place.
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Must match IMAGE_CACHE in src/lib/deviceCache.js, which empties it on sign-out.
const IMAGE_CACHE = 'crm-images';

// ── 1. App shell ────────────────────────────────────────────────────────────
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Every in-app address is the one page. Paths with a file extension are real
// files (the demo pages, the PDF) and are left to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/\/[^/?]+\.[^/?]+$/] }));

// A new version waits until the page asks for it (pwa.js does, at launch), so
// the files under a running page never change. The first install takes the
// page over at once so pictures are kept from the first session.
clientsClaim();
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  // The page that a notification click opened asks what was clicked.
  if (type === 'CLIENT_READY' && pendingClick && event.source) {
    event.source.postMessage({ type: 'PUSH_CLICK', ...pendingClick });
    pendingClick = null;
  }
});

// ── 2. Fonts and pictures ───────────────────────────────────────────────────
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'crm-font-css' }),
);
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'crm-font-files',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 365 * 24 * 3600 })],
  }),
);
// Public Supabase Storage pictures (property media, chat images). An <img>
// asks without CORS, and such an answer is opaque: the browser counts each one
// as several MB of storage. Asking again with CORS (Storage allows any origin)
// gives a normal answer that costs its real size.
registerRoute(
  ({ url, request }) => request.destination === 'image'
    && url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/'),
  new CacheFirst({
    cacheName: IMAGE_CACHE,
    plugins: [
      { requestWillFetch: async ({ request }) => new Request(request.url, { mode: 'cors', credentials: 'omit' }) },
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true }),
    ],
  }),
);

// ── 3. Push ─────────────────────────────────────────────────────────────────
// Payload (push-send): { id, title, body, leadId }. A notification is always
// shown: iOS withdraws the subscription of an app that receives pushes silently.
self.addEventListener('push', (event) => {
  let d;
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'WEPRO CRM', {
    body: d.body || 'New notification',
    icon: '/pwa-192.png',
    badge: '/notif-badge.png',
    tag: d.id ? String(d.id) : undefined, // the same notification sent twice shows once
    data: { id: d.id || null, leadId: d.leadId || null },
  }));
});

// What was clicked, held for a window that is only just opening (see CLIENT_READY).
let pendingClick = null;
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) {
      try { await open.focus(); } catch { /* focus needs a user gesture on some browsers */ }
      open.postMessage({ type: 'PUSH_CLICK', ...data });
      return;
    }
    pendingClick = data;
    await self.clients.openWindow('/');
  })());
});
