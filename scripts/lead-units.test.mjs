// npx vite-node scripts/lead-units.test.mjs
// Hold Unit paints the project's "Reserved" status, and the lead panel's
// Interest unit row lists the floor, size and latest price of what the lead holds.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); // nothing reaches a real database
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const db = await import('../src/lib/db.js');
const { setUnitStatus, getProjectById, reservedTag, leadUnits } = await import('../src/lib/projects.js');

db.getDB().properties = [{
  id: 'p1', name: 'MALL', unitStatuses: [{ id: 'st-landowner', name: 'Landowner', color: '#A78BFA' }, { id: 'st-reserved', name: 'Reserved', color: '#38BDF8' }],
  floorPlans: [{ id: 'fp1', name: '1st Floor', boxes: [{ id: 'b1', unitId: 'SHOP-106' }] }],
  variants: [{ id: 'v1', name: 'Shop', units: [{ id: 'SHOP-106', status: 'available', size: 1113, sheet: { package: 46000000 } }, { id: 'SHOP-107', status: 'available', size: 500 }] }],
}];
const p = getProjectById('p1');
assert.equal(reservedTag(p), 'st-reserved');
assert.equal(reservedTag({ unitStatuses: [] }), undefined);

setUnitStatus('p1', 'v1', 'SHOP-106', 'hold', { user: { id: 'u1', name: 'A' }, client: { id: 'L1', name: 'Rahim' }, tag: reservedTag(p) });
assert.equal(getProjectById('p1').variants[0].units[0].tag, 'st-reserved', 'hold carries the Reserved colour');

// No request yet: price falls back to the sheet package.
assert.deepEqual(leadUnits('L1').map(u => [u.code, u.floor, u.size, u.price]), [['SHOP-106', '1st Floor', 1113, 46000000]]);
// A reserve request's deal total is the latest price.
db.getDB().holdRequests = [{ id: 'h1', propertyId: 'p1', unitId: 'SHOP-106', dealTotal: 45000000, status: 'pending', createdAt: new Date().toISOString() }];
assert.equal(leadUnits('L1')[0].price, 45000000);
assert.deepEqual(leadUnits('other'), []);
// Released: the lead no longer shows it.
setUnitStatus('p1', 'v1', 'SHOP-106', 'available');
assert.deepEqual(leadUnits('L1'), []);
console.log('ok: reservedTag + leadUnits');

// Save project details: the pick lands on the lead (cart) and the unit stays available.
db.getDB().leads = [{ id: 'L2', name: 'Karim', status: 'NEW', companyId: 'c1' }];
db.saveLeadPick('L2', { project: getProjectById('p1'), variant: { id: 'v1' }, floor: '1st Floor', unitNo: 'SHOP-107', size: 500, value: 1 }, { id: 'u1', name: 'A' });
const l2 = db.getLead('L2');
assert.deepEqual([l2.cart.unitNo, l2.cart.floor, l2.cart.stage, l2.propertyInterest], ['SHOP-107', '1st Floor', 'CART', 'MALL']);
assert.equal(getProjectById('p1').variants[0].units[1].status, 'available', 'saving a pick never reserves the unit');
console.log('ok: saveLeadPick keeps the unit available');
