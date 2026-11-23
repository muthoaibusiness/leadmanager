// ── Floor plans redrawn in CSS (Booking tab) ─────────────────────────────────
// Redraws a floor plan as markup instead of an image: one tile per shop, placed
// at the box's own position and size (the boxes are 0–1 fractions of the plan
// image, so they map straight to percentages), with the building outline and
// the lifts, stairs, escalators, washrooms, parking bays and so on drawn
// around them. Pure data, no React.

import { findUnit, unitSize, unitPrice } from './projects.js';
import { statusLook } from './floorPlan.js';

// Floor button codes: 5th Floor → F5, Ground Floor → FG, Semi Basement → FSB,
// Basement → FB. The F keeps them apart from shop numbers (S-115).
export function floorCode(name) {
  const n = String(name || '').trim();
  const num = /(\d+)/.exec(n);
  if (num) return 'F' + num[1];
  if (/^ground/i.test(n)) return 'FG';
  if (/semi/i.test(n)) return 'FSB';
  if (/base/i.test(n)) return 'FB';
  return 'F' + (n.charAt(0) || '?').toUpperCase();
}

// Short shop number for a tile: SHOP-115 → S-115, SUPERSHOP-01 → SS-01,
// GOLDSOUK-04 → GS-04; short prefixes (ATM) stay as they are.
const SHORT = { SHOP: 'S', SUPERSHOP: 'SS', GOLDSOUK: 'GS' };
export function shortCode(code) {
  const m = /^([A-Za-z]+)[-\s]?(.*)$/.exec(String(code || ''));
  if (!m) return String(code || '');
  const p = m[1].toUpperCase();
  return (SHORT[p] || p.slice(0, 3)) + (m[2] ? '-' + m[2] : '');
}

// The heading for a shop: SHOP-115 → "Shop 115"; other codes as they are.
export const shopLabel = (code) => (/^SHOP-/i.test(code) ? 'Shop ' + String(code).slice(5) : String(code || ''));

// ৳1.05 Cr / ৳85 L / ৳45,000 — short enough for a tile.
export function takaShort(n) {
  if (!(n > 0)) return '';
  if (n >= 1e7) return '৳' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (n >= 1e5) return '৳' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L';
  return '৳' + Math.round(n).toLocaleString('en-IN');
}

// ── what is on a floor besides shops ─────────────────────────────────────────
// The building outline and everything that is not a shop. The plan's own
// boxes are shops only, so these are measured off each floor's drawing and
// kept here, in that drawing's pixels (`ref`); frame() turns them into 0–1
// fractions. A floor with no entry shows its shops alone.
// A mark may carry `clip`: a polygon of [x, y] fractions of its own box, for a
// room whose wall is not square (it is cut to the building's slanted edge).
//   kind: lift | cargo | stair | esclane | void | wc | service | kiosk | plant
//         | seating | parking | zone | label
const UPPER = { // 2nd, 3rd and 4th floor share one drawing
  ref: { w: 2000, h: 1765 },
  hull: [[780, 45], [1125, 45], [1125, 25], [1885, 25], [1965, 150], [1965, 1310], [1910, 1310], [1910, 1445], [1582, 1445], [1582, 1385], [1340, 1385], [1340, 1545], [200, 1735], [190, 1700], [35, 1718], [35, 355], [130, 355], [130, 300], [445, 300], [445, 345], [575, 305], [745, 185], [780, 185]],
  marks: [
    { kind: 'stair', label: 'UP', x: 60, y: 370, w: 165, h: 205 },
    { kind: 'service', label: 'AHU', x: 140, y: 312, w: 80, h: 40 },
    { kind: 'service', label: 'GARBAGE DUMP', x: 333, y: 325, w: 105, h: 68 },
    { kind: 'cargo', label: 'CARGO LIFT', x: 333, y: 412, w: 105, h: 105 },
    { kind: 'lift', label: 'LIFT', x: 463, y: 365, w: 105, h: 70 },
    { kind: 'lift', label: 'LIFT', x: 463, y: 448, w: 105, h: 70 },
    { kind: 'service', label: 'FHC', x: 515, y: 318, w: 45, h: 28 },
    { kind: 'stair', label: 'UP', x: 1500, y: 32, w: 130, h: 145 },
    { kind: 'wc', label: 'WASHROOM', x: 1645, y: 32, w: 310, h: 175 },
    { kind: 'void', label: 'ATRIUM', x: 862, y: 650, w: 188, h: 420 },
    { kind: 'esclane', x: 805, y: 650, w: 52, h: 418 },
    { kind: 'esclane', x: 1058, y: 650, w: 55, h: 418 },
    { kind: 'kiosk', label: 'KIOSK', x: 1262, y: 1022, w: 64, h: 140 },
    { kind: 'stair', label: 'UP', x: 1335, y: 1018, w: 240, h: 162 },
    { kind: 'label', label: 'LIFT LOBBY', x: 1330, y: 1205, w: 230, h: 45 },
    { kind: 'kiosk', label: 'KIOSK', x: 1262, y: 1285, w: 62, h: 155 },
    { kind: 'lift', label: 'LIFT', x: 1348, y: 1288, w: 100, h: 82 },
    { kind: 'lift', label: 'LIFT', x: 1468, y: 1288, w: 100, h: 82 },
    { kind: 'plant', x: 735, y: 625, w: 65, h: 70 }, { kind: 'plant', x: 1112, y: 622, w: 65, h: 70 },
    { kind: 'plant', x: 737, y: 988, w: 65, h: 75 }, { kind: 'plant', x: 1112, y: 988, w: 65, h: 75 },
    { kind: 'plant', x: 722, y: 188, w: 52, h: 52 }, { kind: 'plant', x: 580, y: 298, w: 50, h: 50 },
  ],
};

const LAYOUTS = {
  'Basement': {
    ref: { w: 2000, h: 1414 },
    hull: [[990, 222], [1243, 222], [1243, 192], [1315, 192], [1315, 205], [1437, 205], [1448, 980], [1307, 980], [1307, 1035], [1198, 1035], [1198, 1080], [630, 1305], [572, 1305], [572, 412], [765, 410], [765, 378], [870, 378]],
    marks: [
      { kind: 'service', label: 'GENERATOR ROOM', x: 575, y: 1062, w: 340, h: 243, clip: [[0, 0], [1, 0], [1, 0.535], [0.162, 1], [0, 1]] },
      { kind: 'service', label: 'DRIVERS WAITING ROOM', x: 918, y: 1062, w: 278, h: 128, clip: [[0, 0], [1, 0], [1, 0.148], [0, 1]] },
      { kind: 'parking', label: 'CAR PARKING', x: 585, y: 968, w: 612, h: 82 },
      { kind: 'parking', label: 'CAR PARKING', x: 1005, y: 232, w: 412, h: 90 },
      { kind: 'parking', label: 'CAR PARKING', x: 902, y: 432, w: 205, h: 375 },
      { kind: 'parking', x: 1198, y: 415, w: 100, h: 390 },
      { kind: 'parking', label: 'CAR PARKING', x: 588, y: 597, w: 224, h: 92 },
      { kind: 'parking', x: 590, y: 785, w: 224, h: 82 },
      { kind: 'zone', label: 'BIKE PARKING', x: 655, y: 505, w: 150, h: 78 },
      { kind: 'zone', label: 'BIKE PARKING', x: 902, y: 818, w: 200, h: 52 },
      { kind: 'label', label: 'VEHICLE DRIVEWAY', x: 590, y: 718, w: 215, h: 26 },
      { kind: 'label', label: 'VEHICLE DRIVEWAY', x: 590, y: 902, w: 215, h: 26 },
      { kind: 'label', label: 'VEHICLE DRIVEWAY', x: 930, y: 902, w: 300, h: 26 },
      { kind: 'label', label: 'VEHICLE DRIVEWAY', x: 1040, y: 356, w: 230, h: 26 },
      { kind: 'stair', label: 'UP', x: 578, y: 418, w: 75, h: 130 },
      { kind: 'service', label: 'STORE', x: 655, y: 430, w: 110, h: 68 },
      { kind: 'service', label: 'PUMP ROOM', x: 808, y: 386, w: 115, h: 52 },
      { kind: 'stair', label: 'RAMP DOWN', x: 1303, y: 425, w: 138, h: 548 },
      { kind: 'stair', label: 'UP', x: 1198, y: 812, w: 108, h: 92 },
      { kind: 'label', label: 'LIFT LOBBY', x: 1198, y: 925, w: 108, h: 36 },
      { kind: 'lift', label: 'LIFT', x: 1203, y: 980, w: 47, h: 52 },
      { kind: 'lift', label: 'LIFT', x: 1253, y: 980, w: 47, h: 52 },
    ],
  },
  'Semi Basement': {
    ref: { w: 1680, h: 2000 },
    hull: [[752, 55], [795, 40], [1565, 40], [1625, 100], [1640, 880], [1640, 1390], [1610, 1435], [810, 1842], [505, 1935], [305, 1960], [105, 1960], [40, 1900], [40, 625], [65, 572]],
    marks: [
      { kind: 'lift', label: 'LIFTS', x: 1347, y: 895, w: 228, h: 485 },
    ],
  },
  'Ground Floor': {
    ref: { w: 1526, h: 2000 },
    hull: [[610, 72], [640, 57], [855, 38], [1050, 38], [1075, 48], [1375, 195], [1405, 235], [1410, 255], [1487, 1265], [1487, 1400], [1455, 1445], [185, 1960], [100, 1960], [40, 1900], [45, 640], [60, 620]],
    marks: [
      { kind: 'void', label: 'ATRIUM · ESCALATORS', x: 610, y: 643, w: 225, h: 345 },
      { kind: 'esclane', x: 676, y: 697, w: 20, h: 175 },
      { kind: 'esclane', x: 748, y: 697, w: 20, h: 175 },
      { kind: 'lift', label: 'LIFTS', x: 977, y: 1002, w: 183, h: 317 },
    ],
  },
  '1st Floor': {
    ref: { w: 1852, h: 1988 },
    hull: [[740, 48], [1045, 48], [1045, 26], [1380, 26], [1380, 40], [1440, 40], [1440, 26], [1735, 26], [1797, 165], [1822, 1448], [1760, 1448], [1760, 1562], [1462, 1562], [1462, 1510], [1248, 1510], [1248, 1665], [185, 1960], [22, 1945], [22, 375], [125, 375], [125, 325], [425, 325], [425, 360], [520, 340], [740, 195]],
    marks: [
      { kind: 'stair', label: 'UP', x: 25, y: 380, w: 195, h: 240 },
      { kind: 'service', label: 'AHU', x: 140, y: 340, w: 70, h: 38 },
      { kind: 'service', label: 'GARBAGE DUMP', x: 300, y: 340, w: 112, h: 72 },
      { kind: 'cargo', label: 'CARGO LIFT', x: 300, y: 428, w: 112, h: 124 },
      { kind: 'lift', label: 'LIFT', x: 430, y: 378, w: 110, h: 79 },
      { kind: 'lift', label: 'LIFT', x: 430, y: 472, w: 110, h: 80 },
      { kind: 'service', label: 'FHC', x: 488, y: 340, w: 42, h: 22 },
      { kind: 'stair', label: 'UP', x: 1380, y: 65, w: 125, h: 125 },
      { kind: 'wc', label: 'WASHROOM', x: 1520, y: 30, w: 270, h: 220 },
      { kind: 'escalator', label: 'ESCALATOR', x: 735, y: 720, w: 290, h: 428 },
      { kind: 'kiosk', label: 'KIOSK', x: 1160, y: 1100, w: 65, h: 155 },
      { kind: 'stair', label: 'UP', x: 1240, y: 1105, w: 215, h: 160 },
      { kind: 'label', label: 'LIFT LOBBY', x: 1250, y: 1295, w: 175, h: 50 },
      { kind: 'kiosk', label: 'KIOSK', x: 1163, y: 1380, w: 67, h: 160 },
      { kind: 'lift', label: 'LIFT', x: 1248, y: 1378, w: 97, h: 112 },
      { kind: 'lift', label: 'LIFT', x: 1360, y: 1378, w: 98, h: 112 },
      { kind: 'plant', x: 665, y: 690, w: 65, h: 65 }, { kind: 'plant', x: 1028, y: 690, w: 65, h: 65 },
      { kind: 'plant', x: 665, y: 1045, w: 65, h: 65 }, { kind: 'plant', x: 1028, y: 1045, w: 65, h: 65 },
      { kind: 'plant', x: 682, y: 202, w: 52, h: 52 }, { kind: 'plant', x: 540, y: 302, w: 52, h: 52 },
    ],
  },
  '2nd Floor': UPPER,
  '3rd Floor': UPPER,
  '4th Floor': UPPER,
  '5th Floor': { // the food court: seating areas instead of shops in the middle
    ref: { w: 1834, h: 2000 },
    hull: [[705, 55], [1035, 52], [1040, 25], [1765, 28], [1805, 80], [1805, 1365], [1745, 1365], [1745, 1495], [1430, 1495], [1430, 1455], [1230, 1455], [1230, 1610], [195, 1955], [175, 1920], [30, 1938], [30, 385], [105, 385], [105, 335], [395, 335], [395, 360], [480, 358], [705, 170]],
    marks: [
      { kind: 'stair', label: 'UP', x: 50, y: 395, w: 140, h: 205 },
      { kind: 'service', label: 'AHU', x: 118, y: 340, w: 65, h: 45 },
      { kind: 'service', label: 'GARBAGE DUMP', x: 278, y: 352, w: 100, h: 72 },
      { kind: 'cargo', label: 'CARGO LIFT', x: 278, y: 430, w: 105, h: 110 },
      { kind: 'lift', label: 'LIFT', x: 405, y: 385, w: 95, h: 72 },
      { kind: 'lift', label: 'LIFT', x: 405, y: 465, w: 95, h: 72 },
      { kind: 'stair', label: 'UP', x: 1385, y: 88, w: 120, h: 115 },
      { kind: 'wc', label: 'WASHROOM', x: 1515, y: 30, w: 285, h: 215 },
      { kind: 'void', label: 'ATRIUM', x: 795, y: 695, w: 180, h: 400 },
      { kind: 'esclane', x: 745, y: 695, w: 50, h: 400 },
      { kind: 'esclane', x: 978, y: 695, w: 50, h: 400 },
      { kind: 'stair', label: 'UP', x: 1215, y: 1080, w: 225, h: 170 },
      { kind: 'kiosk', x: 1160, y: 1080, w: 55, h: 165 },
      { kind: 'lift', label: 'LIFT', x: 1243, y: 1338, w: 90, h: 90 },
      { kind: 'lift', label: 'LIFT', x: 1335, y: 1338, w: 90, h: 90 },
      { kind: 'seating', label: 'SEATING', x: 738, y: 65, w: 134, h: 258 },
      { kind: 'seating', x: 660, y: 395, w: 352, h: 202 },
      { kind: 'seating', x: 1058, y: 395, w: 365, h: 202 },
      { kind: 'seating', x: 465, y: 640, w: 140, h: 482 },
      { kind: 'seating', x: 1145, y: 650, w: 300, h: 352 },
      { kind: 'seating', x: 465, y: 1190, w: 140, h: 212 },
      { kind: 'seating', x: 665, y: 1190, w: 288, h: 212 },
      { kind: 'seating', x: 465, y: 1455, w: 140, h: 282 },
      { kind: 'seating', x: 665, y: 1455, w: 288, h: 205 },
      { kind: 'plant', x: 690, y: 645, w: 70, h: 70 }, { kind: 'plant', x: 1010, y: 645, w: 70, h: 70 },
      { kind: 'plant', x: 695, y: 1040, w: 70, h: 70 }, { kind: 'plant', x: 1015, y: 1040, w: 70, h: 70 },
      { kind: 'plant', x: 508, y: 312, w: 55, h: 55 }, { kind: 'plant', x: 958, y: 62, w: 45, h: 45 },
      { kind: 'plant', x: 970, y: 1625, w: 55, h: 55 }, { kind: 'plant', x: 415, y: 1828, w: 55, h: 55 },
    ],
  },
};

const PAD = 0.012; // breathing room around the building, as a share of the frame

// The part of the drawing worth showing: the building's outline (and every
// shop and fixture, in case one pokes out), with a little room. Cropping to it
// means a drawing with wide margins (the basement) does not shrink the plan.
// → { view: { x, y, w, h } (0–1 of the image), hull: [[x, y]…], marks: […] }, all
// in image fractions; a floor with no layout is framed on its shop boxes.
function frame(plan) {
  const L = LAYOUTS[plan?.name];
  const hull = L?.hull ? L.hull.map(([x, y]) => [x / L.ref.w, y / L.ref.h]) : null;
  const marks = L ? L.marks.map(m => ({ ...m, x: m.x / L.ref.w, y: m.y / L.ref.h, w: m.w / L.ref.w, h: m.h / L.ref.h })) : [];
  const pts = [];
  (hull || []).forEach(([x, y]) => pts.push([x, y]));
  (plan?.boxes || []).forEach(b => { pts.push([b.x, b.y], [b.x + b.w, b.y + b.h]); });
  marks.forEach(m => { pts.push([m.x, m.y], [m.x + m.w, m.y + m.h]); });
  if (!pts.length) return { view: { x: 0, y: 0, w: 1, h: 1 }, hull, marks };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.max(0, Math.min(...xs) - PAD), y0 = Math.max(0, Math.min(...ys) - PAD);
  const x1 = Math.min(1, Math.max(...xs) + PAD), y1 = Math.min(1, Math.max(...ys) + PAD);
  return { view: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, hull, marks };
}

// → { hull: 'polygon(…)' | null, marks: [{ kind, label, x, y, w, h }] }, 0–1 of the frame
export function landmarks(plan) {
  const { view: v, hull, marks } = frame(plan);
  const pct = (n) => `${+(n * 100).toFixed(2)}%`;
  return {
    hull: hull ? `polygon(${hull.map(([x, y]) => `${pct((x - v.x) / v.w)} ${pct((y - v.y) / v.h)}`).join(', ')})` : null,
    marks: marks.map(m => ({ ...m, x: (m.x - v.x) / v.w, y: (m.y - v.y) / v.h, w: m.w / v.w, h: m.h / v.h })),
  };
}

// The ground floor drawing is narrow and its shops are small, so their numbers got
// cut off. Drawing it this much wider (x / y stay fractions of the frame) gives
// every tile that much more room for its number. The floors keep their own shapes.
const WIDEN = { 'Ground Floor': 1.45 };

// → { aspect, shops: [shop], counts: { available, hold, sold, total } }
// aspect = the frame's width / height, so the CSS plan keeps the drawing's shape.
// shop = { code, status, look, size, price, rate, type, category, ownership,
//          x, y, w, h }  (x/y/w/h: 0–1 of the frame)
// A box whose unit no longer exists is skipped.
export function textFloor(project, plan) {
  const img = plan?.image || {};
  const { view: v } = frame(plan);
  const pxAspect = img.width > 0 && img.height > 0 ? img.width / img.height : 1;
  const aspect = pxAspect * v.w / v.h * (WIDEN[plan?.name] || 1);
  const counts = { available: 0, hold: 0, sold: 0, total: 0 };
  const shops = [];
  (plan?.boxes || []).forEach(b => {
    const loc = b.unitId ? findUnit(project, b.unitId) : null;
    if (!loc) return;
    const { unit, variant } = loc;
    const size = unitSize(unit, variant), price = unitPrice(unit, variant);
    const status = unit.status || 'available';
    shops.push({
      code: unit.id, status, variantId: variant.id,
      clientName: unit.clientName || '', heldByName: unit.heldByName || '', holdUntil: unit.holdUntil || null,
      look: statusLook(project.unitStatuses, unit),
      size, price, rate: size > 0 && price > 0 ? price / size : 0,
      type: variant.name || '',
      category: unit.sheet?.category || '',
      ownership: unit.sheet?.ownership || '',
      x: (b.x - v.x) / v.w, y: (b.y - v.y) / v.h, w: b.w / v.w, h: b.h / v.h,
    });
    counts[status] = (counts[status] || 0) + 1;
    counts.total++;
  });
  return { aspect, shops, counts };
}
