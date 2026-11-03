import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStatus, projectCounts, matchPublicRoute, isPortfolioRoute,
  countUnits, unitDetail, planBoxes, glanceRows, sizeRange, toPublic, safeUrl, sortPlans,
} from './publicProjects.js';

// A full CRM project, as the admin store holds it.
const crm = {
  id: 'p1', name: 'ALPHA TOWER', purpose: 'Residential', address: 'Road 1', handover: '2027', storeys: 'G+9',
  media: { images: [{ url: 'https://cdn.example/a.jpg' }, { url: 'javascript:alert(1)' }], docs: [{ label: 'Brochure', url: 'https://cdn.example/a.pdf' }, { url: 'http://x/y.pdf' }] },
  variants: [
    { id: 'v1', name: 'Shop', size: 200, beds: 0, listRate: 10000, floorRate: 50, units: [
      { id: 'SHOP-01', status: 'available' },
      { id: 'SHOP-02', status: 'hold', clientName: 'Karim', heldBy: 'u1', note: 'cash' },
      { id: 'SHOP-03', status: 'sold' },
      { id: 'SHOP-04', status: 'available', tag: 'st-res', size: 250, price: 3000000 },
    ] },
  ],
  unitStatuses: [{ id: 'st-res', name: 'Reserved', color: '#7C3AED', base: 'hold' }],
  floorPlans: [
    { id: 'f2', name: 'Upper', order: 2, updatedBy: 'u1', image: { url: 'https://cdn.example/u.png', width: 1000, height: 500 }, boxes: [] },
    { id: 'f1', name: 'Ground', order: 1, image: { url: 'https://cdn.example/g.png', width: 1000, height: 500 }, boxes: [
      { id: 'b1', unitId: 'SHOP-01', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { id: 'b2', unitId: 'SHOP-02', x: 0.4, y: 0.1, w: 0.2, h: 0.2 },
      { id: 'b3', unitId: 'SHOP-03', x: 0.1, y: 0.4, w: 0.2, h: 0.2 },
      { id: 'b4', unitId: 'GONE', x: 0.7, y: 0.1, w: 0.2, h: 0.2 },
    ] },
    { id: 'f3', name: 'Bad', image: { url: 'data:image/png;base64,AA', width: 1, height: 1 }, boxes: [] },
  ],
};
const pub = toPublic(crm);

test('normalizeStatus maps the three base states and resolves custom statuses', () => {
  const u = (s) => normalizeStatus(crm, { status: s });
  assert.equal(u('available'), 'available');
  assert.equal(u('hold'), 'booked');
  assert.equal(u('sold'), 'sold');
  assert.equal(normalizeStatus(crm, crm.variants[0].units[3]), 'booked'); // st-res base=hold
});

test('projectCounts (admin) and countUnits (public) agree', () => {
  assert.deepEqual(projectCounts(crm), { available: 1, booked: 2, sold: 1 });
  assert.deepEqual(countUnits(pub), { available: 1, booked: 2, sold: 1 });
});

test('toPublic keeps only public fields: no hold metadata, rates, prices or custom names', () => {
  const s = JSON.stringify(pub);
  for (const k of ['clientName', 'Karim', 'heldBy', 'note', 'cash', 'listRate', 'floorRate', 'price', '3000000', 'Reserved', '#7C3AED', 'updatedBy']) {
    assert.ok(!s.includes(k), `leaked ${k}`);
  }
  assert.deepEqual(Object.keys(pub.variants[0].units[0]).sort(), ['id', 'size', 'status']);
});

test('toPublic: https media only, plans sorted, unit size falls back to the variant', () => {
  assert.deepEqual(pub.photos, ['https://cdn.example/a.jpg']);
  assert.equal(pub.cover, 'https://cdn.example/a.jpg');
  assert.deepEqual(pub.brochures, [{ label: 'Brochure', url: 'https://cdn.example/a.pdf' }]);
  assert.deepEqual(pub.plans.map(f => f.id), ['f1', 'f2']);
  assert.deepEqual(pub.variants[0].units.map(u => u.size), [200, 200, 200, 250]);
  assert.deepEqual(pub.counts, { minSize: 200, maxSize: 250 });
});

test('unitDetail opens only for an available unit', () => {
  const d = unitDetail(pub, 'SHOP-01');
  assert.deepEqual(d, { code: 'SHOP-01', status: 'available', statusLabel: 'Available', type: 'Shop', size: 200, beds: null, baths: null });
  assert.equal(unitDetail(pub, 'SHOP-02'), null); // booked
  assert.equal(unitDetail(pub, 'SHOP-03'), null); // sold
  assert.equal(unitDetail(pub, 'SHOP-04'), null); // custom status, base hold -> booked
  assert.equal(unitDetail(pub, 'NOPE'), null);
});

test('planBoxes maps public statuses to canvas bases, in image px, with spoken status', () => {
  const boxes = planBoxes(pub, pub.plans[0]);
  assert.deepEqual(boxes.map(b => b.status), ['available', 'hold', 'sold', 'unlinked']);
  assert.equal(boxes[0].x, 100);
  assert.equal(boxes[0].h, 100);
  assert.match(boxes[1].aria, /booked$/);
  assert.match(boxes[3].aria, /not linked/);
});

test('glanceRows lists only fields with a value', () => {
  assert.deepEqual(glanceRows(pub), [
    ['Project type', 'Residential'], ['Location', 'Road 1'], ['Handover', '2027'],
    ['Floors', 'G+9'], ['Unit sizes', '200 - 250 sft'], ['Total units', '4'],
  ]);
});

test('sizeRange formats one size, a range, or nothing', () => {
  assert.equal(sizeRange(2800, 2800), '2,800 sft');
  assert.equal(sizeRange(70, 1678), '70 - 1,678 sft');
  assert.equal(sizeRange(null, null), '');
});

test('safeUrl lets only https through', () => {
  assert.equal(safeUrl('https://a/b.jpg'), 'https://a/b.jpg');
  assert.equal(safeUrl('http://a/b.jpg'), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl(undefined), '');
});

test('sortPlans orders by order', () => {
  assert.deepEqual(sortPlans([{ id: 'b', order: 2 }, { id: 'a', order: 1 }, { id: 'c' }]).map(p => p.id), ['c', 'a', 'b']);
});

test('matchPublicRoute parses only the public path', () => {
  assert.deepEqual(matchPublicRoute('#/p/px12abc34'), { id: 'px12abc34' });
  assert.deepEqual(matchPublicRoute('#/p/a%20b'), { id: 'a b' });
  assert.equal(matchPublicRoute('#/leads'), null);
  assert.equal(matchPublicRoute('#/p/'), null);
  assert.equal(matchPublicRoute(''), null);
});

test('isPortfolioRoute matches the bare portfolio landing only', () => {
  assert.equal(isPortfolioRoute('#/p'), true);
  assert.equal(isPortfolioRoute('#/p/'), true);
  assert.equal(isPortfolioRoute('#/p/px12abc34'), false);
  assert.equal(isPortfolioRoute('#/leads'), false);
  assert.equal(isPortfolioRoute(''), false);
});
