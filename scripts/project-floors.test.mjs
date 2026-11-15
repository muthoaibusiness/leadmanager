import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFloors } from '../src/lib/projects.js';

test('projectFloors: plan box first, sheet floor second, rest last', () => {
  const project = {
    floorPlans: [
      { name: '2nd Floor', order: 2, boxes: [{ unitId: 'S-201' }] },
      { name: '1st Floor', order: 1, boxes: [{ unitId: 'S-101' }] },
      { name: '3rd Floor', order: 3, boxes: [] },
    ],
    variants: [
      { id: 'shop', units: [{ id: 'S-101' }, { id: 'S-102', sheet: { floor: '1st floor' } }, { id: 'S-201' }] },
      { id: 'atm', units: [{ id: 'A-1', sheet: { floor: 'Ground' } }, { id: 'X-9' }] },
    ],
  };
  const f = projectFloors(project);
  assert.deepEqual(f.map(x => x.name), ['Ground', '2nd Floor', '1st Floor', 'Other units']);
  assert.deepEqual([...f[2].ids], ['S-101', 'S-102']);
  assert.deepEqual([...f[3].ids], ['X-9']);
});

test('projectFloors: no floor data at all reads as All units', () => {
  const f = projectFloors({ variants: [{ id: 'v', units: [{ id: 'U-1' }] }] });
  assert.deepEqual(f.map(x => x.name), ['All units']);
});

test('projectFloors: top floor first whatever the saved plan order', () => {
  const f = projectFloors({
    floorPlans: [
      { name: '5th Floor', order: 0, boxes: [{ unitId: 'S-501' }] },
      { name: '1st Floor', order: 4, boxes: [{ unitId: 'S-101' }] },
      { name: '10th Floor', order: 1, boxes: [{ unitId: 'S-1001' }] },
    ],
    variants: [{ id: 'shop', units: [{ id: 'S-501' }, { id: 'S-101' }, { id: 'S-1001' }] }],
  });
  assert.deepEqual(f.map(x => x.name), ['10th Floor', '5th Floor', '1st Floor']);
});

import { statusLook } from '../src/lib/floorPlan.js';

test('statusLook: a project status (Landowner, or one added later) names and colours the unit', () => {
  const statuses = [{ id: 'st-landowner', name: 'Landowner', color: '#A78BFA', base: 'sold' }, { id: 'st-new', name: 'Owner pick', color: '#22C55E', base: 'hold' }];
  assert.equal(statusLook(statuses, { id: 'S-01', status: 'sold', tag: 'st-landowner' }).label, 'Landowner');
  assert.equal(statusLook(statuses, { id: 'S-02', status: 'hold', tag: 'st-new' }).color, '#22C55E');
  // a deleted status falls back to the base
  assert.equal(statusLook([], { id: 'S-03', status: 'sold', tag: 'st-gone' }).label, 'Sold');
});
