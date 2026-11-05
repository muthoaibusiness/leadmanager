// npx vite-node scripts/unit-status-keeps-sheet.test.mjs
// A hold or release must keep a unit's imported inventory row (`sheet`).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); // nothing reaches a real database
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const db = await import('../src/lib/db.js');
const { setUnitStatus, getProjectById } = await import('../src/lib/projects.js');
const sheet = { floor: '1st Floor', area: 1113, package: 46000000, status: 'OPEN' };
db.getDB().properties = [{ id: 'p1', name: 'T', variants: [{ id: 'v1', name: 'Shop', units: [{ id: 'SHOP-106', status: 'available', size: 1113, price: 46000000, sheet }] }] }];
setUnitStatus('p1', 'v1', 'SHOP-106', 'hold', { user: { id: 'u1', name: 'A' } });
let u = getProjectById('p1').variants[0].units[0];
assert.equal(u.status, 'hold'); assert.deepEqual(u.sheet, sheet); assert.equal(u.price, 46000000);
setUnitStatus('p1', 'v1', 'SHOP-106', 'available');
u = getProjectById('p1').variants[0].units[0];
assert.equal(u.status, 'available'); assert.deepEqual(u.sheet, sheet);
console.log('ok: setUnitStatus keeps sheet on hold and release');
