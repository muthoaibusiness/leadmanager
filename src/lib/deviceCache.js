// What the installed app keeps on the device besides the db.js snapshot:
//
//   * the last answer for each lead-list page (IndexedDB), so a list shows at
//     once and the fresh rows replace it when the server answers;
//   * pictures the service worker kept (Cache Storage, see src/sw.js).
//
// Both hold one account's data. clearDeviceData() runs wherever clearLocalDB()
// does (sign-out, a cache that belongs to another account), for the same reason:
// handing them to the next account is a data leak.
//
// Everything is best effort. A browser without IndexedDB or Cache Storage, or
// with storage blocked, just gets no cache; nothing here throws.

const DB_NAME = 'wepro-device';
const STORE = 'leadPages';
const MAX_PAGES = 40;
// Must match IMAGE_CACHE in src/sw.js.
export const IMAGE_CACHE = 'crm-images';

// key → { rows, total } for the pages seen or stored in this session.
const mem = new Map();

let _open = null;
function open() {
  if (_open) return _open;
  _open = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return _open;
}

// One request against the store; resolves to its result, or null on any failure.
async function run(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

// The last stored answer for this page, or null. Memory first (same session),
// then the device (a cold start).
export async function loadLeadPage(key) {
  if (mem.has(key)) return mem.get(key);
  const hit = await run('readonly', (s) => s.get(key));
  if (hit && Array.isArray(hit.rows)) { mem.set(key, hit); return hit; }
  return null;
}

// Every key on the device, least recently stored first. Read once per session:
// pages kept by earlier sessions count as the oldest, so the store stays capped
// across sessions and not only within one.
let _keys = null;
async function keys() {
  if (!_keys) _keys = (await run('readonly', (s) => s.getAllKeys())) || [];
  return _keys;
}

export async function storeLeadPage(key, res) {
  if (!res || !Array.isArray(res.rows)) return;
  const entry = { rows: res.rows, total: res.total };
  mem.set(key, entry);
  const ks = await keys();
  const i = ks.indexOf(key);
  if (i >= 0) ks.splice(i, 1);
  ks.push(key);
  const dropped = ks.splice(0, Math.max(0, ks.length - MAX_PAGES));
  dropped.forEach((k) => mem.delete(k));
  await run('readwrite', (s) => { dropped.forEach((k) => s.delete(k)); return s.put(entry, key); });
}

export function clearDeviceData() {
  mem.clear();
  _keys = [];
  run('readwrite', (s) => s.clear());
  try { if (typeof caches !== 'undefined') caches.delete(IMAGE_CACHE).catch(() => {}); } catch { /* no Cache Storage */ }
}
