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
  const unit = /^unit[\s-]*([a-z])\b/i.exec(n);
  if (unit) return 'U' + unit[1].toUpperCase();
  if (/^ground/i.test(n)) return 'FG';
  if (/semi/i.test(n)) return 'FSB';
  if (/base/i.test(n)) return 'FB';
  return 'F' + (n.charAt(0) || '?').toUpperCase();
}

// Short shop number for a tile: SHOP-115 → S-115, SUPERSHOP-01 → SS-01,
// GOLDSOUK-04 → GS-04; short prefixes (ATM) stay as they are.
const SHORT = { SHOP: 'S', SUPERSHOP: 'SS', GOLDSOUK: 'GS', SHOWROOM: 'SR', OFFICE: 'OF' };
export function shortCode(code) {
  const m = /^([A-Za-z]+)[-\s]?(.*)$/.exec(String(code || ''));
  if (!m) return String(code || '');
  const p = m[1].toUpperCase();
  return (SHORT[p] || p.slice(0, 3)) + (m[2] ? '-' + m[2] : '');
}

// The heading for a shop: SHOP-115 → "Shop 115"; other codes as they are.
export const shopLabel = (code) => {
  const m = /^(SHOP|SHOWROOM|OFFICE)-(.+)$/i.exec(String(code || ''));
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2] : String(code || '');
};

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

// A plan picks its drawing with plan.layout, else by its name.
const layoutKey = (plan) => (LAYOUTS[plan?.layout] ? plan.layout : LAYOUTS[plan?.name] ? plan.name : null);
// Shafiq Sapphire typical floor: the rooms of Unit B (top), measured off the drawing (px of the
// 1350 x 1800 page), and Unit A as its mirror image below; then the shared core.
const SHAFIQ_B = [
  ['zone', 'VER', 392, 297, 118, 59], ['zone', 'VER', 840, 297, 125, 63],
  ['zone', 'MASTER BED', 335, 365, 225, 185],
  ['service', 'S/A', 308, 552, 76, 88], ['wc', 'A. TOILET', 386, 552, 100, 88],
  ['service', 'KITCHEN', 372, 648, 198, 125], ['service', 'D/W', 330, 772, 42, 62], ['service', 'K.VER', 372, 772, 38, 40],
  ['zone', 'VER', 572, 365, 200, 98], ['zone', 'DINING', 572, 490, 200, 305],
  ['service', 'S/A', 683, 318, 88, 50], ['wc', 'A. TOILET', 683, 370, 88, 92], ['service', 'DINNER WAGON', 683, 465, 90, 22],
  ['zone', 'BED-02', 778, 365, 207, 180], ['wc', 'C. TOILET', 862, 548, 123, 85], ['zone', 'BED-03', 778, 637, 207, 160],
  ['zone', 'VER', 348, 842, 62, 100], ['zone', 'LIVING', 412, 802, 243, 144],
];
// verandas and living rooms say which apartment they belong to
const own = (u) => (m) => (m[1] === 'VER' || m[1] === 'LIVING' ? [m[0], u + ' · ' + m[1], ...m.slice(2)] : m);
const SHAFIQ_TYPICAL = [
  ...SHAFIQ_B.map(own('B')),
  ...SHAFIQ_B.filter((m) => m[3] < 800).map(([k, l, x, y, w, h]) => [k, l, x, 1893 - y - h, w, h]).map(own('A')),
  ...[['zone', 'VER', 348, 952, 62, 100], ['zone', 'LIVING', 412, 950, 243, 148]].map(own('A')),
  ['label', 'UNIT B · 1460 SFT', 572, 770, 200, 26], ['label', 'UNIT A · 1460 SFT', 572, 1097, 200, 26],
  ['zone', 'LIFT LOBBY', 656, 802, 178, 283], ['lift', 'LIFT', 852, 818, 106, 100], ['stair', 'STAIR', 812, 925, 206, 155],
].map(([kind, label, x, y, w, h]) => ({ kind, label, x, y, w, h }));

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
  'JM Basement': { // JM Heritage Mall: 25 car bays, lifts, stair; no shops
    ref: { w: 2000, h: 1414 },
    hull: [[442, 185], [1562, 185], [1562, 430], [1475, 880], [1465, 1080], [1430, 1190], [1330, 1265], [668, 1265], [668, 1135], [585, 1135], [585, 1215], [452, 1215], [452, 1000], [442, 800]],
    marks: [
      { kind: 'service', label: "DRIVER'S WAITING", x: 450, y: 230, w: 150, h: 95 },
      { kind: 'lift', label: "LIFT", x: 855, y: 215, w: 70, h: 125 },
      { kind: 'lift', label: "LIFT", x: 950, y: 215, w: 70, h: 125 },
      { kind: 'stair', label: "STAIR", x: 1425, y: 195, w: 135, h: 230 },
      { kind: 'parking', x: 655, y: 212, w: 70, h: 170 },
      { kind: 'parking', x: 752, y: 212, w: 70, h: 170 },
      { kind: 'parking', x: 1080, y: 212, w: 70, h: 170 },
      { kind: 'parking', x: 1170, y: 212, w: 70, h: 170 },
      { kind: 'parking', x: 1315, y: 212, w: 70, h: 170 },
      { kind: 'parking', x: 880, y: 395, w: 70, h: 170 },
      { kind: 'parking', x: 980, y: 395, w: 70, h: 170 },
      { kind: 'parking', x: 1080, y: 395, w: 70, h: 170 },
      { kind: 'parking', x: 1170, y: 395, w: 70, h: 170 },
      { kind: 'parking', x: 1285, y: 395, w: 70, h: 170 },
      { kind: 'parking', x: 1378, y: 395, w: 70, h: 170 },
      { kind: 'parking', x: 472, y: 385, w: 168, h: 62 },
      { kind: 'parking', x: 472, y: 468, w: 168, h: 62 },
      { kind: 'parking', x: 472, y: 577, w: 168, h: 68 },
      { kind: 'parking', x: 472, y: 685, w: 168, h: 68 },
      { kind: 'parking', x: 472, y: 790, w: 168, h: 62 },
      { kind: 'parking', x: 472, y: 905, w: 168, h: 62 },
      { kind: 'parking', x: 1030, y: 765, w: 170, h: 66 },
      { kind: 'parking', x: 1030, y: 850, w: 170, h: 66 },
      { kind: 'parking', x: 1030, y: 933, w: 170, h: 66 },
      { kind: 'parking', x: 1030, y: 1015, w: 170, h: 66 },
      { kind: 'parking', x: 1030, y: 1098, w: 170, h: 66 },
      { kind: 'parking', x: 1030, y: 1180, w: 170, h: 66 },
      { kind: 'parking', x: 768, y: 858, w: 62, h: 160 },
      { kind: 'parking', x: 695, y: 1175, w: 170, h: 70 },
      { kind: 'zone', label: "VEHICLE DRIVEWAY", x: 700, y: 625, w: 700, h: 100 },
      { kind: 'stair', label: "RAMP UP", x: 1275, y: 750, w: 170, h: 490 },
      { kind: 'label', label: "LIFT LOBBY", x: 625, y: 935, w: 150, h: 28 },
      { kind: 'lift', label: "LIFT", x: 590, y: 1025, w: 72, h: 100 },
      { kind: 'lift', label: "LIFT", x: 672, y: 1025, w: 72, h: 100 },
      { kind: 'stair', label: "STAIR", x: 460, y: 1010, w: 115, h: 200 },
    ],
  },
  'JM Semi Basement': { // 16 car bays, generator rooms
    ref: { w: 2000, h: 1414 },
    hull: [[463, 205], [1555, 205], [1555, 430], [1478, 880], [1465, 1020], [1430, 1170], [1320, 1262], [685, 1262], [685, 1125], [605, 1125], [605, 1210], [472, 1210], [472, 865], [463, 800]],
    marks: [
      { kind: 'service', label: "GENERATOR ROOM 01", x: 470, y: 215, w: 370, h: 165 },
      { kind: 'service', label: "GENERATOR ROOM 02", x: 1040, y: 215, w: 375, h: 175 },
      { kind: 'lift', label: "LIFT", x: 880, y: 222, w: 70, h: 115 },
      { kind: 'lift', label: "LIFT", x: 960, y: 222, w: 70, h: 115 },
      { kind: 'stair', label: "STAIR", x: 1425, y: 220, w: 125, h: 205 },
      { kind: 'zone', label: "LIFT LOBBY", x: 855, y: 395, w: 150, h: 170 },
      { kind: 'parking', x: 500, y: 400, w: 162, h: 62 },
      { kind: 'parking', x: 500, y: 482, w: 162, h: 62 },
      { kind: 'parking', x: 500, y: 588, w: 162, h: 62 },
      { kind: 'parking', x: 500, y: 690, w: 162, h: 62 },
      { kind: 'parking', x: 500, y: 790, w: 162, h: 62 },
      { kind: 'parking', x: 1025, y: 415, w: 72, h: 160 },
      { kind: 'parking', x: 1105, y: 415, w: 72, h: 160 },
      { kind: 'parking', x: 1185, y: 415, w: 72, h: 160 },
      { kind: 'parking', x: 1283, y: 415, w: 72, h: 160 },
      { kind: 'parking', x: 1373, y: 415, w: 72, h: 160 },
      { kind: 'parking', x: 1040, y: 765, w: 170, h: 66 },
      { kind: 'parking', x: 1040, y: 850, w: 170, h: 66 },
      { kind: 'parking', x: 1040, y: 933, w: 170, h: 66 },
      { kind: 'parking', x: 1040, y: 1015, w: 170, h: 66 },
      { kind: 'parking', x: 778, y: 858, w: 62, h: 160 },
      { kind: 'parking', x: 715, y: 1165, w: 165, h: 72 },
      { kind: 'zone', label: "VEHICLE DRIVEWAY", x: 700, y: 625, w: 700, h: 100 },
      { kind: 'stair', label: "DOWN FROM GF", x: 1280, y: 740, w: 170, h: 300 },
      { kind: 'stair', label: "RAMP", x: 880, y: 1090, w: 560, h: 170 },
      { kind: 'label', label: "LIFT LOBBY", x: 620, y: 935, w: 140, h: 28 },
      { kind: 'lift', label: "LIFT", x: 608, y: 1020, w: 70, h: 100 },
      { kind: 'lift', label: "LIFT", x: 690, y: 1020, w: 70, h: 100 },
      { kind: 'stair', label: "STAIR", x: 480, y: 1010, w: 115, h: 195 },
    ],
  },
  'JM Ground': { // showrooms 01 to 06 and shops 07 to 15 round the atrium
    ref: { w: 2000, h: 1414 },
    hull: [[612, 215], [1418, 235], [1338, 705], [1324, 990], [1432, 1030], [1432, 1150], [575, 1150], [575, 1035], [652, 990], [640, 720]],
    marks: [
      { kind: 'service', label: "ELECTRO-MECH. ROOM", x: 632, y: 240, w: 203, h: 108 },
      { kind: 'lift', label: "LIFT", x: 935, y: 278, w: 45, h: 72 },
      { kind: 'lift', label: "LIFT", x: 985, y: 278, w: 45, h: 72 },
      { kind: 'stair', label: "STAIR", x: 1268, y: 300, w: 145, h: 105 },
      { kind: 'void', label: "VOID", x: 985, y: 412, w: 35, h: 245 },
      { kind: 'esclane', x: 1022, y: 412, w: 42, h: 245 },
      { kind: 'esclane', x: 1066, y: 412, w: 40, h: 245 },
      { kind: 'label', label: "8' CORRIDOR", x: 790, y: 372, w: 250, h: 26 },
      { kind: 'label', label: "8' CORRIDOR", x: 1090, y: 372, w: 250, h: 26 },
      { kind: 'label', label: "8' CORRIDOR", x: 790, y: 626, w: 240, h: 24 },
      { kind: 'label', label: "LIFT LOBBY", x: 765, y: 745, w: 120, h: 24 },
      { kind: 'label', label: "ENTRY LOBBY", x: 900, y: 728, w: 260, h: 26 },
      { kind: 'lift', label: "LIFT", x: 768, y: 785, w: 45, h: 58 },
      { kind: 'lift', label: "LIFT", x: 818, y: 785, w: 45, h: 58 },
      { kind: 'stair', label: "STAIR", x: 662, y: 742, w: 100, h: 155 },
      { kind: 'stair', label: "UP", x: 928, y: 790, w: 205, h: 62 },
      { kind: 'stair', label: "RAMP", x: 1185, y: 692, w: 112, h: 190 },
      { kind: 'zone', label: "VEHICLE DRIVEWAY", x: 765, y: 860, w: 560, h: 130 },
      { kind: 'zone', label: "45' WIDE LAL DIGHI PAR ROAD", x: 575, y: 1045, w: 860, h: 105 },
    ],
  },
  'JM Upper': { // 1st to 4th floor share one drawing: shops 01 to 20 on each
    ref: { w: 2000, h: 1414 },
    hull: [[468, 180], [682, 180], [682, 290], [1540, 290], [1540, 495], [1520, 505], [1448, 1000], [1450, 1268], [800, 1268], [800, 1240], [655, 1240], [655, 1295], [530, 1295], [530, 1000], [500, 935]],
    marks: [
      { kind: 'wc', label: "TOILETS", x: 470, y: 185, w: 205, h: 225 },
      { kind: 'lift', label: "LIFT", x: 908, y: 300, w: 68, h: 108 },
      { kind: 'lift', label: "LIFT", x: 982, y: 300, w: 68, h: 108 },
      { kind: 'stair', label: "STAIR", x: 1418, y: 295, w: 120, h: 205 },
      { kind: 'void', label: "VOID", x: 990, y: 520, w: 56, h: 330 },
      { kind: 'esclane', x: 1048, y: 512, w: 56, h: 345 },
      { kind: 'esclane', x: 1112, y: 512, w: 56, h: 345 },
      { kind: 'label', label: "8' WIDE CORRIDOR", x: 700, y: 438, w: 330, h: 28 },
      { kind: 'label', label: "8' WIDE CORRIDOR", x: 1100, y: 438, w: 330, h: 28 },
      { kind: 'label', label: "15' WIDE CORRIDOR", x: 880, y: 928, w: 400, h: 28 },
      { kind: 'label', label: "LIFT LOBBY", x: 655, y: 962, w: 170, h: 28 },
      { kind: 'lift', label: "LIFT", x: 660, y: 1050, w: 72, h: 98 },
      { kind: 'lift', label: "LIFT", x: 738, y: 1050, w: 72, h: 98 },
      { kind: 'stair', label: "STAIR", x: 533, y: 1005, w: 120, h: 285 },
    ],
  },
  'JM 5th': { // shops 501 to 514 round a food court
    ref: { w: 2000, h: 1414 },
    hull: [[445, 180], [670, 180], [670, 285], [1555, 285], [1555, 495], [1530, 505], [1450, 1000], [1450, 1285], [780, 1285], [780, 1255], [650, 1255], [650, 1300], [520, 1310], [515, 1000], [490, 930], [445, 505]],
    marks: [
      { kind: 'wc', label: "TOILETS", x: 447, y: 185, w: 225, h: 215 },
      { kind: 'lift', label: "LIFT", x: 895, y: 300, w: 65, h: 100 },
      { kind: 'lift', label: "LIFT", x: 985, y: 300, w: 65, h: 100 },
      { kind: 'stair', label: "STAIR", x: 1428, y: 295, w: 125, h: 205 },
      { kind: 'void', label: "VOID", x: 990, y: 512, w: 55, h: 330 },
      { kind: 'esclane', x: 1048, y: 500, w: 55, h: 345 },
      { kind: 'esclane', x: 1112, y: 500, w: 55, h: 345 },
      { kind: 'seating', label: "FOOD COURT", x: 765, y: 480, w: 150, h: 430 },
      { kind: 'seating', x: 955, y: 490, w: 45, h: 345 },
      { kind: 'seating', x: 1180, y: 490, w: 45, h: 345 },
      { kind: 'seating', x: 1075, y: 300, w: 165, h: 130 },
      { kind: 'seating', x: 975, y: 965, w: 220, h: 270 },
      { kind: 'label', label: "LIFT LOBBY", x: 650, y: 985, w: 150, h: 28 },
      { kind: 'lift', label: "LIFT", x: 648, y: 1060, w: 65, h: 95 },
      { kind: 'lift', label: "LIFT", x: 725, y: 1060, w: 65, h: 95 },
      { kind: 'stair', label: "STAIR", x: 515, y: 1015, w: 125, h: 260 },
    ],
  },
  'JM Office': { // 8th and 9th floor share one drawing: 11 offices each
    ref: { w: 2000, h: 1414 },
    hull: [[390, 124], [636, 124], [636, 240], [1600, 240], [1600, 470], [1564, 476], [1480, 940], [1490, 1280], [770, 1280], [770, 1184], [610, 1184], [610, 1336], [464, 1336], [464, 1024], [410, 930], [390, 470]],
    marks: [
      { kind: 'wc', label: "TOILETS", x: 394, y: 130, w: 240, h: 270 },
      { kind: 'zone', label: "SMOKING ZONE", x: 410, y: 400, w: 116, h: 64 },
      { kind: 'lift', label: "LIFT", x: 866, y: 254, w: 100, h: 124 },
      { kind: 'lift', label: "LIFT", x: 970, y: 254, w: 100, h: 124 },
      { kind: 'stair', label: "STAIR", x: 1450, y: 250, w: 156, h: 220 },
      { kind: 'void', label: "VOID", x: 976, y: 496, w: 200, h: 350 },
      { kind: 'label', label: "8' WIDE CORRIDOR", x: 540, y: 410, w: 340, h: 48 },
      { kind: 'label', label: "10' WIDE CORRIDOR", x: 940, y: 410, w: 340, h: 48 },
      { kind: 'label', label: "15' WIDE CORRIDOR", x: 920, y: 930, w: 460, h: 48 },
      { kind: 'label', label: "LIFT LOBBY", x: 600, y: 976, w: 200, h: 48 },
      { kind: 'lift', label: "LIFT", x: 612, y: 1080, w: 76, h: 110 },
      { kind: 'lift', label: "LIFT", x: 694, y: 1080, w: 76, h: 110 },
      { kind: 'stair', label: "STAIR", x: 470, y: 1030, w: 130, h: 300 },
    ],
  },
  'JM Mid': { // 6th and 7th floor (option 1): shops 01 to 06, the two big ones are 1,678 and 1,344 sft
    ref: { w: 2000, h: 1414 },
    hull: [[376, 116], [596, 116], [596, 224], [1540, 224], [1540, 456], [1504, 460], [1432, 990], [1428, 1280], [730, 1280], [730, 1220], [580, 1220], [580, 1264], [452, 1264], [424, 990], [406, 936], [376, 456]],
    marks: [
      { kind: 'wc', label: "TOILETS", x: 376, y: 120, w: 216, h: 244 },
      { kind: 'zone', label: "BREASTFEEDING", x: 380, y: 364, w: 136, h: 80 },
      { kind: 'lift', label: "LIFT", x: 838, y: 236, w: 86, h: 124 },
      { kind: 'lift', label: "LIFT", x: 924, y: 236, w: 90, h: 124 },
      { kind: 'stair', label: "STAIR", x: 1396, y: 230, w: 144, h: 220 },
      { kind: 'void', label: "VOID", x: 936, y: 464, w: 56, h: 344 },
      { kind: 'esclane', x: 994, y: 460, w: 76, h: 350 },
      { kind: 'esclane', x: 1074, y: 460, w: 76, h: 350 },
      { kind: 'label', label: "8' WIDE CORRIDOR", x: 640, y: 376, w: 320, h: 44 },
      { kind: 'label', label: "10' WIDE CORRIDOR", x: 940, y: 388, w: 340, h: 44 },
      { kind: 'label', label: "15' WIDE CORRIDOR", x: 960, y: 892, w: 340, h: 44 },
      { kind: 'label', label: "LIFT LOBBY", x: 600, y: 952, w: 200, h: 44 },
      { kind: 'lift', label: "LIFT", x: 576, y: 1044, w: 76, h: 110 },
      { kind: 'lift', label: "LIFT", x: 660, y: 1044, w: 76, h: 110 },
      { kind: 'stair', label: "STAIR", x: 450, y: 1000, w: 120, h: 260 },
    ],
  },
  'JM Roof': { // open roof, 8,416 sft, no units
    ref: { w: 2000, h: 1414 },
    hull: [[400, 144], [640, 144], [640, 256], [1600, 256], [1600, 500], [1514, 940], [1504, 1336], [790, 1336], [790, 1210], [606, 1210], [606, 1364], [476, 1364], [476, 1080], [444, 940]],
    marks: [
      { kind: 'lift', label: "MRL LIFT CORE", x: 886, y: 260, w: 190, h: 160 },
      { kind: 'stair', label: "STAIR", x: 1436, y: 270, w: 170, h: 230 },
      { kind: 'void', label: "SKYLIGHT", x: 990, y: 510, w: 210, h: 350 },
      { kind: 'stair', label: "STAIR", x: 464, y: 956, w: 140, h: 380 },
      { kind: 'lift', label: "MRL LIFT CORE", x: 606, y: 1086, w: 170, h: 120 },
      { kind: 'label', label: "ROOF FLOOR AREA · 8,416 SFT", x: 800, y: 940, w: 600, h: 60 },
    ],
  },
  'Shafiq Roof': { // Shafiq Sapphire roof top: open terrace, community space, gym, lawn
    ref: { w: 1350, h: 1800 },
    hull: [[338, 372], [398, 372], [398, 312], [505, 312], [505, 342], [568, 342], [568, 372], [688, 372], [688, 325], [850, 325], [850, 308], [972, 308], [972, 368], [1002, 368], [1002, 556], [1025, 556], [1025, 1275], [1002, 1275], [1002, 1538], [338, 1538]],
    marks: [
      { kind: 'zone', label: "OPEN TO SKY", x: 345, y: 380, w: 307, h: 880 },
      { kind: 'zone', label: "OPEN TO SKY", x: 685, y: 330, w: 315, h: 220 },
      { kind: 'stair', label: "DN", x: 872, y: 448, w: 96, h: 104 },
      { kind: 'zone', label: "COMMUNITY SPACE", x: 695, y: 565, w: 213, h: 235 },
      { kind: 'wc', label: "TOILET", x: 915, y: 565, w: 80, h: 135 },
      { kind: 'zone', label: "LIFT LOBBY", x: 695, y: 820, w: 145, h: 280 },
      { kind: 'lift', label: "LIFT", x: 860, y: 828, w: 110, h: 90 },
      { kind: 'stair', label: "STAIR", x: 822, y: 935, w: 198, h: 155 },
      { kind: 'zone', label: "GYM", x: 782, y: 1105, w: 213, h: 157 },
      { kind: 'zone', label: "GREEN", x: 345, y: 1275, w: 655, h: 260 },
    ],
  },
  'Shafiq Typical': { // Shafiq Sapphire, floors 1 to 8: Unit B above, Unit A (its mirror) below, the core between
    ref: { w: 1350, h: 1800 },
    hull: [[328, 358], [572, 358], [572, 335], [990, 335], [990, 1555], [572, 1555], [572, 1530], [328, 1530]],
    marks: SHAFIQ_TYPICAL,
  },
  'Shafiq Ground': { // Shafiq Sapphire: parking and plant rooms, no units
    ref: { w: 1350, h: 1800 },
    hull: [[308, 295], [990, 298], [993, 1510], [308, 1510]],
    marks: [
      { kind: 'zone', label: 'DRIVEWAY', x: 566, y: 306, w: 166, h: 722 },
      { kind: 'stair', label: 'RAMP', x: 566, y: 1040, w: 166, h: 360 },
      { kind: 'label', label: 'ENTRY / EXIT', x: 566, y: 1470, w: 166, h: 34 },
      { kind: 'wc', label: 'WC', x: 322, y: 308, w: 50, h: 106 },
      { kind: 'service', label: 'GENERATOR ROOM', x: 376, y: 306, w: 182, h: 106 },
      { kind: 'service', label: "DRIVER'S WAITING", x: 322, y: 420, w: 226, h: 58 },
      { kind: 'service', label: 'ST METER', x: 738, y: 308, w: 102, h: 118 },
      { kind: 'service', label: 'TRANSFORMER', x: 848, y: 308, w: 110, h: 122 },
      { kind: 'service', label: 'ELECTRICAL PANEL', x: 752, y: 435, w: 158, h: 103 },
      { kind: 'service', label: 'PDB METER', x: 915, y: 435, w: 60, h: 110 },
      { kind: 'lift', label: 'LIFT', x: 806, y: 792, w: 92, h: 88 },
      { kind: 'stair', label: 'STAIR', x: 735, y: 896, w: 210, h: 124 },
      { kind: 'parking', x: 328, y: 514, w: 218, h: 94 },
      { kind: 'parking', x: 328, y: 620, w: 218, h: 94 },
      { kind: 'parking', x: 328, y: 778, w: 218, h: 94 },
      { kind: 'parking', x: 328, y: 893, w: 218, h: 94 },
      { kind: 'parking', x: 328, y: 1096, w: 218, h: 94 },
      { kind: 'parking', x: 328, y: 1210, w: 218, h: 94 },
      { kind: 'parking', x: 738, y: 566, w: 218, h: 94 },
      { kind: 'parking', x: 738, y: 676, w: 218, h: 94 },
      { kind: 'parking', x: 748, y: 1044, w: 218, h: 94 },
      { kind: 'parking', x: 748, y: 1160, w: 218, h: 94 },
      { kind: 'parking', x: 748, y: 1276, w: 218, h: 94 },
      { kind: 'parking', label: 'BIKE', x: 372, y: 985, w: 152, h: 52 },
      { kind: 'parking', label: 'BIKE', x: 356, y: 1316, w: 150, h: 52 },
      { kind: 'service', label: 'LPG', x: 322, y: 1392, w: 46, h: 58 },
      { kind: 'service', label: 'GUARD', x: 384, y: 1392, w: 90, h: 58 },
      { kind: 'stair', label: 'UP', x: 478, y: 1404, w: 80, h: 104 },
      { kind: 'zone', label: 'GARDEN', x: 324, y: 1462, w: 152, h: 42 },
      { kind: 'zone', label: 'GARDEN', x: 752, y: 1410, w: 206, h: 44 },
      { kind: 'zone', label: 'GARDEN', x: 752, y: 1462, w: 206, h: 42 },
      { kind: 'label', label: "25' WIDE FRONT ROAD", x: 300, y: 1534, w: 700, h: 44 },
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
  const L = LAYOUTS[layoutKey(plan)];
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
const WIDEN = { 'Ground Floor': 1.45, 'Shafiq Ground': 2, 'Shafiq Typical': 1.5, 'Shafiq Roof': 1.8, 'JM Ground': 1.5, 'JM Office': 1.35, 'JM Mid': 1.35, 'JM Roof': 1.3, 'JM Upper': 1.35, 'JM 5th': 1.35, 'JM Basement': 1.2, 'JM Semi Basement': 1.2 };
const MIN_ASPECT = 0.9; // a floor with no layout of its own is never drawn narrower than this

// A box's outline as [x, y] fractions of the box (an apartment is not a rectangle). Outlines made by the
// plan editor (Citizen Avenue) are fractions of the whole image, not of the box, and cut the text of a
// shop tile, so only box-relative outlines (one that starts at the box's top-left) are used.
function boxShape(b) {
  const s = b?.shape;
  if (!Array.isArray(s) || s.length < 3) return null;
  const xs = s.map(p => p[0]), ys = s.map(p => p[1]);
  const rel = Math.min(...xs) > -0.01 && Math.max(...xs) < 1.01 && Math.min(...ys) > -0.01 && Math.max(...ys) < 1.01 && Math.min(...xs) < 0.02 && Math.min(...ys) < 0.02;
  return rel ? s : null;
}

// → { aspect, shops: [shop], counts: { available, hold, sold, total } }
// aspect = the frame's width / height, so the CSS plan keeps the drawing's shape.
// shop = { code, status, look, size, price, rate, type, category, ownership,
//          x, y, w, h }  (x/y/w/h: 0–1 of the frame)
// A box whose unit no longer exists is skipped.
export function textFloor(project, plan) {
  const img = plan?.image || {};
  const { view: v } = frame(plan);
  const pxAspect = img.width > 0 && img.height > 0 ? img.width / img.height : 1;
  let aspect = pxAspect * v.w / v.h * (WIDEN[layoutKey(plan) || plan?.name] || 1);
  if (!layoutKey(plan)) aspect = Math.max(aspect, MIN_ASPECT);
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
      beds: variant.beds > 0 ? variant.beds : 0, baths: variant.baths > 0 ? variant.baths : 0,
      category: unit.sheet?.category || '',
      ownership: unit.sheet?.ownership || '',
      x: (b.x - v.x) / v.w, y: (b.y - v.y) / v.h, w: b.w / v.w, h: b.h / v.h,
      shape: boxShape(b), // optional outline, [x, y] fractions of the box (an apartment is not a rectangle)
    });
    counts[status] = (counts[status] || 0) + 1;
    counts.total++;
  });
  return { aspect, shops, counts };
}
