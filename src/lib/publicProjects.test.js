import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus, unitCard, planBoxes, projectCounts, findUnitIn, matchPublicRoute, isPortfolioRoute } from './publicProjects.js';

const project = {
  variants: [
    { id: 'v1', name: 'Shop', size: 200, listRate: 10000, units: [
      { id: 'SHOP-01', status: 'available' },
      { id: 'SHOP-02', status: 'hold' },
      { id: 'SHOP-03', status: 'sold' },
      { id: 'SHOP-04', status: 'available', tag: 'st-res', size: 250, price: 3000000 },
    ] },
  ],
  unitStatuses: [{ id: 'st-res', name: 'Reserved', color: '#7C3AED', base: 'hold' }],
};

test('normalizeStatus maps the three base states', () => {
  const u = (s) => normalizeStatus(project, { status: s });
  assert.equal(u('available'), 'available');
  assert.equal(u('hold'), 'booked');
  assert.equal(u('sold'), 'sold');
});

test('normalizeStatus resolves custom statuses to their base', () => {
  assert.equal(normalizeStatus(project, project.variants[0].units[3]), 'booked'); // st-res base=hold → booked
});

test('findUnitIn finds a unit across variants', () => {
  const loc = findUnitIn(project, 'SHOP-02');
  assert.equal(loc.unit.status, 'hold');
  assert.equal(findUnitIn(project, 'NOPE'), null);
});

test('unitCard reports public status and only existing fields', () => {
  const c = unitCard(project, 'SHOP-02');
  assert.equal(c.status, 'booked');
  assert.equal(c.statusLabel, 'Booked');
  assert.equal(c.size, 200); // from variant size
  assert.equal(c.price, 2_000_000); // variant listRate × size
  const custom = unitCard(project, 'SHOP-04');
  assert.equal(custom.size, 250);
  assert.equal(custom.price, 3_000_000);
  assert.equal(unitCard(project, 'NOPE'), null);
});

test('planBoxes maps statuses to canvas bases and keeps labels', () => {
  const fp = {
    image: { width: 1000, height: 500 },
    boxes: [
      { id: 'b1', unitId: 'SHOP-01', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { id: 'b2', unitId: 'SHOP-02', x: 0.4, y: 0.1, w: 0.2, h: 0.2 },
      { id: 'b3', unitId: 'SHOP-03', x: 0.1, y: 0.4, w: 0.2, h: 0.2 },
      { id: 'b4', unitId: 'GONE', x: 0.7, y: 0.1, w: 0.2, h: 0.2 },
    ],
  };
  const boxes = planBoxes(project, fp);
  assert.equal(boxes[0].status, 'available');
  assert.equal(boxes[1].status, 'hold'); // booked renders as hold
  assert.equal(boxes[2].status, 'sold');
  assert.equal(boxes[3].status, 'unlinked');
  assert.equal(boxes[0].x, 100);
  assert.equal(boxes[0].h, 100);
  assert.match(boxes[1].aria, /booked/);
});

test('projectCounts tallies the three public buckets', () => {
  assert.deepEqual(projectCounts(project), { available: 1, booked: 2, sold: 1 });
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
