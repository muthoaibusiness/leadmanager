import { ROLES } from './constants.js';

// Default accounts — seeded only when Supabase returns no users (first run / empty DB).
// All passwords: 1234
export const SEED_TEAMS = [
  { id: 't1', name: "Masud's Team", leadId: 'u5' },
];

export const SEED_USERS = [
  { id: 'u1', name: 'Rahim Ahmed',  email: 'rahim@crm.com',  password: '1234', role: ROLES.IA,   teamId: 't1',  phone: '+880 1711 100001', isActive: true },
  { id: 'u2', name: 'Nusrat Jahan', email: 'nusrat@crm.com', password: '1234', role: ROLES.IA,   teamId: 't1',  phone: '+880 1711 100002', isActive: true },
  { id: 'u3', name: 'Fatima Begum', email: 'fatima@crm.com', password: '1234', role: ROLES.MA,   teamId: 't1',  phone: '+880 1711 100003', isActive: true },
  { id: 'u4', name: 'Tariq Islam',  email: 'tariq@crm.com',  password: '1234', role: ROLES.MA,   teamId: 't1',  phone: '+880 1711 100004', isActive: true },
  { id: 'u5', name: 'Masud Rahman', email: 'masud@crm.com',  password: '1234', role: ROLES.TL,   teamId: 't1',  phone: '+880 1711 100005', isActive: true },
  { id: 'u6', name: 'Admin',        email: 'admin@crm.com',  password: '1234', role: ROLES.MGMT, teamId: null,  phone: '+880 1711 100006', isActive: true },
];

// Real WECON inventory (from project sheet). Cols:
// [name, district, area, type, size, psf, handover, totalUnits, unsold, landArea, storeys, facing, totalSft, unsoldSft, saleableUnits, drive]
const D = 'https://p2pfamily-my.sharepoint.com/:f:/p/brand/';
const RAW = [
  ['Wecon Momtaz Manor', 'Chattogram', 'O R Nizam', 'Apartment', '3879 sft', 12500, 'December 2029', 12, 5, '7.55 Katha', 'SB+Gr+Mezzanine+12 Floor+Roof', 'South', 37200, 18300, '', D + 'EkuQWA38N0ZDpOOj8GD9a9EBfMnvAx3LSWjS4SZxW5m5qQ?e=2PReb1'],
  ['Wecon E K Manor', 'Chattogram', 'O R Nizam', 'Apartment', '2360 sft', 12500, 'December 2029', 12, 0, '4.84 Katha', 'SB+G+1st+12+R', 'South-East', 27600, 11500, '', D + 'EhVeucx-nPROtEQ4wATA3asBmPwF9N3ROPeEnpQszlAZhA?e=KnMwxZ'],
  ['Wecon Skyridge', 'Chattogram', 'Golpahar Circle', 'Apartment', '4025 sft', 0, '', 0, 0, '7 Katha', 'SB+B+G+9 Floors+R', 'South', 0, 0, '', ''],
  ['Wecon Zafar Manor', 'Chattogram', 'O R Nizam', 'Apartment', '3690 sft', 12500, 'December 2029', 12, 6, '7.2 Katha', 'SB+G+1st+12F+R', 'North', 40800, 20400, 'A-2, A-4, A-7, A-8, A-11, A-12', D + 'Elr2d08M6ZFKtFv3YHsAjuwBIvbrQSdHMfFAJTol9Edzwg?e=G5criT'],
  ['Wecon Shukrana', 'Chattogram', 'Panchlaish', 'Apartment', '2624 / 2606 / 2018 sft', 0, 'June 2026', 30, 0, '13.5 Katha', 'Basement 1&2 + G Mezzanine + 10 Floors', 'South-West-North', 0, 0, '', D + 'EorRAC1ZAL5Hlxxa6dfuk-wBLa1-pkSWmyXAwVmRgTuoZA?e=qbPYo3'],
  ['Wecon Chairman Palace', 'Chattogram', 'Panchlaish', 'Apartment', '2700 sft', 14000, 'December 2028', 48, 6, '19.80 Katha', 'SB+G+1+12+Roof Top', 'South-West', 126900, 54000, 'B-2, C-2, D-2, D-7, D-11, D-12', D + 'EgNh6CStSxBItdAXpNXJYsYB5gub2NRyrwMEX7Lq54NetA?e=oP66th'],
  ['Wecon Canopy', 'Chattogram', 'Katalgonj', 'Apartment', '2151 sft', 11000, 'December 2026', 24, 1, '9.5 Katha', 'B+G+1st+12+Roof Top', 'South', 51348, 2121, 'B-13', D + 'En-XIodeLYtBvEpOm7KNnCwBuvtHSfzqTTqGT5Vtm_ndZw?e=buALYd'],
  ['Wecon Musa-Noor Rainforest', 'Chattogram', 'Chatteshwari', 'Apartment', '1993–2717 sft', 12000, 'July 2028', 70, 0, '25.05 Katha', 'B+SB+G+14', 'South', 176862, 29922, '', D + 'EhsIahgTbnhCoO7gzN572g8BVui7kOetr9nUCjiEtDatKA?e=oIUKB9'],
  ['Wecon S M Summer Breeze', 'Chattogram', 'Mehedibag', 'Apartment', '1900 sft', 11000, 'March 2029', 20, 9, '7.46 Katha', 'B+G+1st+10+Roof Top', 'East', 38000, 17100, 'A-1, A-3, A-5, A-7, B-1, B-3, B-5, B-7, B-9', D + 'EhdXAzkZVuRCvENEoB1J4A8BEn8kjCmrZehHJwc17LncaA?e=Y2NJYL'],
  ['Wecon JM South Lawn', 'Chattogram', 'Amirbag', 'Apartment', '2410–2430 sft', 0, 'June 2026', 20, 0, '9.6 Katha', 'B+G+1st+10+R', 'South-West', 0, 0, '', D + 'EgdD40CPkBRIp37r5AirezsBLYgpX_zigXWgGQBEmZ-TpA?e=ZDXwUb'],
  ['Wecon Noohs Cave', 'Chattogram', 'South Khulshi', 'Apartment', '2370 sft', 0, 'Handed Over', 8, 0, '4.45 Katha', 'G+8', 'West', 0, 0, '', D + 'EqN-ZNTCfz1Ivq_PmQncd1wBuTbfcd2S_AnxJDdjS5eyVA?e=usNxT0'],
  ['Wecon Southdale', 'Chattogram', 'South Khulshi', 'Apartment', '2585–2630 sft', 11500, 'March 2027', 9, 2, '5 Katha', 'G+9+R', 'North', 22089, 4008, 'A-2, A-6', D + 'ErYuM7au55VHoKdBHL0s47EBEwaqBQM-5bhCDf3MZ1nu7g?e=aH16lt'],
  ['Wecon Mayberry', 'Chattogram', 'VIP R/A South Khulshi', 'Apartment', '2557 sft', 0, 'Handed Over', 8, 0, '4.97 Katha', 'G+8', 'South-West', 0, 0, '', D + 'Et0hhNJFbJlHtRpPUOjr07cBvJBT_q-ini59qo20lPOPww?e=Ibp0CY'],
  ['Wecon Ahmed Northdale', 'Chattogram', 'North Khulshi', 'Apartment', '2866–2930 sft', 13500, 'March 2027', 16, 3, '5.1 Katha', 'G+8+Roof Top', 'South', 23120, 8662, 'A-1, A-4, A-5', D + 'EptVYawuoJFKqObn8DgrflgBL7yFRBvBKVtnJD71ioM1Dg?e=msH0z1'],
  ['Wecon Iqbal Orchid', 'Chattogram', 'South Khulshi', 'Apartment', '3210 sft', 12500, 'June 2028', 10, 5, '7 Katha', 'G+1st+10+R', 'North', 0, 0, 'A-2, A-4, A-5, A-8, A-9', D + 'EqRrIajSpeVAsMHjlZKZoDYBnnOMEBmhWMhBHKnz0JgPqw?e=PcfhNX'],
  ['Wecon Zakir Eutopia', 'Chattogram', 'Halishahar', 'Apartment', '', 0, 'December 2028', 0, 5, '5 Katha', 'G+8+R', 'North West', 0, 0, '', D + 'EnV0i8ckOM5Duwzo-Z0fYtEBcflHGW1fxSPOitxYvGXnuA?e=bmtNGo'],
  ['P2P Health Care', 'Chattogram', 'Halishahar', 'Commercial', '1755 & 3100 sft', 0, '', 0, 0, '6 Katha', 'Gr.+8 Floors+Roof Top', 'East', 0, 0, '', ''],
  ['Wecon JM Heritage Mall', 'Chattogram', 'Laldighi', 'Commercial', 'Showroom 130–1690 sft', 0, 'December 2029', 0, 0, '17 Katha', 'B+SB+G+9+R', 'North West', 0, 0, '', D + 'EqL-9f7zQ89Mgxg6_Z_ZfpsB74w8zr_4kQsnGCOoapKN5g?e=rpREld'],
  ['Wecon Hathazari Oasis', 'Chattogram', 'Hathazari', 'Commercial', '', 0, '', 0, 0, '7.48 Katha', 'G+9+R', 'North East', 0, 0, '', ''],
  ['Wecon Ikra', 'Chattogram', 'Rahman Nagar', 'Apartment', '1530–1560 sft', 0, '', 16, 1, '5.8 Katha', 'G+8', 'North West', 0, 0, 'A-8', D + 'Enr8kMAnjOpHmmzrg10FDQMBgXUuxo3FLMpFH9Y57rGoEg?e=eXa9DP'],
  ['Wecon Shahanara Signature', 'Chattogram', 'Nasirabad', 'Apartment', '2700 sft', 0, 'December 2028', 18, 0, '10 Katha', 'SB+G+M+9+R', 'North East', 0, 0, '', ''],
  ['Wecon Citizen Avenue Mall', 'Chattogram', 'Amirbad Lohagara', 'Commercial', 'Showroom 100–1200 sft', 0, '', 0, 0, '39.6 Katha', 'B+Ground+09 Floors', 'North East', 0, 0, '', ''],
  ['Wecon Panchlaish', 'Chattogram', 'Panchlaish', 'Apartment', '2700 sft', 0, '', 60, 0, '21.6 Katha', 'B+SB+M+12 Floors+R', 'South-East-West', 0, 0, '', ''],
  ['Wecon Dakshinayan', 'Dhaka', 'Jolshiri', 'Apartment', '2800 sft', 13500, 'December 2027', 8, 8, '5 Katha', 'G+M+8+R', 'South West', 0, 0, '', ''],
  ['Wecon Osman', 'Dhaka', 'Jolshiri', 'Apartment', '2850 sft', 0, 'March 2028', 8, 8, '5 Katha', 'G+M+8+R', 'South', 0, 0, '', ''],
  ['Wecon Nuznan', 'Dhaka', 'Jolshiri', 'Apartment', '2850 sft', 0, 'March 2028', 8, 8, '5 Katha', 'G+M+8+R', 'South West', 0, 0, '', ''],
  ['Wecon Mahbub Monowar', 'Dhaka', 'Jolshiri', 'Apartment', '2850 sft', 0, 'June 2028', 8, 8, '5 Katha', 'G+M+8+R', 'West', 0, 0, '', ''],
  ['Wecon Venus', 'Dhaka', 'Jolshiri', 'Apartment', '2850 sft', 0, 'June 2028', 8, 8, '5 Katha', 'G+M+8+R', 'West', 0, 0, '', ''],
  ['Wecon Bashundhara', 'Dhaka', 'Bashundhara R/A', 'Apartment', '1550–1600 sft', 0, '', 6, 6, '3 Katha', 'G+6 Floors+R', 'North', 0, 0, '', ''],
  ['Wecon Uttara', 'Dhaka', 'Uttara', 'Apartment', '2100–2200 sft', 0, '', 8, 8, '5 Katha', 'G+8 Floors+R', 'North', 0, 0, '', ''],
  ['Wecon Chowdhury Arcade', 'Cumilla', 'Kandirpar', 'Commercial', 'Showroom 65–860 sft', 50000, 'December 2028', 240, 92, '20 Katha', 'B+SB+G+13+Roof Top', 'North West', 48606, 26197, '', D + 'Eu4lGXFhL-9HqMq3y3HbZBUBKsNYMrfv5yz-iHF-jTtjZg?e=r5aoWy'],
];

const pslug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
function mkProp([name, district, area, type, size, psf, ho, tot, uns, land, st, face, tsft, usft, sale, drive]) {
  const firstSize = parseInt(String(size).replace(/[, ]/g, '')) || 0;
  const asking = psf && firstSize ? psf * firstSize : 0;
  let status;
  if (/handed over/i.test(ho)) status = uns > 0 ? 'AVAILABLE' : 'SOLD_OUT';
  else if (tot && uns === 0) status = 'SOLD_OUT';
  else if (uns > 0 && uns <= tot * 0.35) status = 'FEW_LEFT';
  else if (uns > 0) status = 'AVAILABLE';
  else status = 'UPCOMING';
  const yr = (String(ho).match(/20\d\d/) || [])[0];
  const construction = /handed over/i.test(ho) ? 100 : yr === '2026' ? 80 : yr === '2027' ? 60 : yr === '2028' ? 40 : yr === '2029' ? 20 : 10;
  const slug = pslug(name);
  return {
    id: 'p-' + slug, name, developer: 'WECON Properties', type, district, area,
    address: [area, district].filter(Boolean).join(', '), status,
    unitsAvailable: uns || 0, totalUnits: tot || 0,
    askingPrice: asking, pricePerSqft: psf || 0, sizeText: size, sizeMin: firstSize, sizeMax: 0,
    images: [`https://picsum.photos/seed/${slug}1/900/600`, `https://picsum.photos/seed/${slug}2/900/600`],
    construction, handover: ho, landArea: land, storeys: st, facing: face,
    totalSft: tsft || 0, unsoldSft: usft || 0, saleableUnits: sale, driveLink: drive, purpose: 'Sale',
    documents: drive ? [{ type: 'other', name: 'Drive — floor plans & docs', url: drive }] : [],
    units: [], amenities: [], details: '',
    createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z',
  };
}

export const SEED_PROPERTIES = RAW.map(mkProp);

// ── Demo inventory — 6 projects with pre-filled units (varied statuses) so the
// seat-style booking view, bookings list, and inventory stats look alive on a fresh demo.
// [name, district, area, type, psf, sizeSft, handover, totalUnits, soldCount, lockedCount, facing, storeys]
const DEMO_RAW = [
  ['Wecon Demo Heights',     'Chattogram', 'Nasirabad',   'Apartment', 12000, 2100, 'December 2027', 12, 3, 1, 'South',      'G+M+12+R'],
  ['Wecon Demo Bay View',    'Chattogram', 'South Khulshi','Apartment', 13500, 2600, 'March 2028',    9,  6, 1, 'South-West', 'G+9+R'],
  ['Wecon Demo Galleria',    'Chattogram', 'GEC Circle',  'Commercial',18000, 950,  'June 2028',     20, 4, 2, 'North-East', 'B+G+8+R'],
  ['Wecon Demo Riverside',   'Dhaka',      'Jolshiri',    'Apartment', 13500, 2800, 'June 2029',     8,  0, 0, 'South-East', 'G+M+8+R'],
  ['Wecon Demo Park Place',  'Chattogram', 'Panchlaish',  'Apartment', 14000, 2700, 'December 2028', 16, 11,2, 'East',       'SB+G+M+12+R'],
  ['Wecon Demo Crown',       'Chattogram', 'Agrabad',     'Apartment', 11500, 1850, 'March 2027',    10, 2, 0, 'North',      'G+10+R'],
];

const DEMO_AMENITIES = ['Rooftop garden', 'Two basement parking', 'Standby generator', 'Lift (2)', 'Gymnasium', 'CCTV & intercom'];

function mkDemoUnits(total, sold, locked, asking) {
  const arr = [];
  for (let i = 1; i <= total; i++) {
    const no = 'U-' + String(i).padStart(2, '0');
    let status = 'available';
    if (i <= sold) status = 'sold';
    else if (i <= sold + locked) status = 'locked';
    const u = { no, status, heldBy: null, heldByName: '', heldAt: null, clientId: null, clientName: '', holdUntil: null, offerPrice: 0, estValue: 0, holdDays: 0 };
    if (status !== 'available') { u.offerPrice = asking; u.estValue = asking; }
    arr.push(u);
  }
  return arr;
}

function mkDemo([name, district, area, type, psf, sft, ho, tot, sold, locked, face, st]) {
  const slug = pslug(name);
  const asking = psf * sft;
  const soldTotal = sold + locked;
  const uns = Math.max(0, tot - soldTotal);
  let status;
  if (uns === 0) status = 'SOLD_OUT';
  else if (uns <= tot * 0.35) status = 'FEW_LEFT';
  else status = 'AVAILABLE';
  const yr = (String(ho).match(/20\d\d/) || [])[0];
  const construction = yr === '2026' ? 80 : yr === '2027' ? 60 : yr === '2028' ? 40 : yr === '2029' ? 20 : 10;
  return {
    id: 'p-' + slug, name, developer: 'WECON Properties', type, district, area,
    address: [area, district].filter(Boolean).join(', '), status,
    unitsAvailable: uns, totalUnits: tot,
    askingPrice: asking, pricePerSqft: psf, sizeText: sft + ' sft', sizeMin: sft, sizeMax: 0,
    images: [`https://picsum.photos/seed/${slug}1/900/600`, `https://picsum.photos/seed/${slug}2/900/600`],
    construction, handover: ho, landArea: '5 Katha', storeys: st, facing: face,
    totalSft: tot * sft, unsoldSft: uns * sft, saleableUnits: '', driveLink: '', purpose: 'Sale',
    documents: [], units: mkDemoUnits(tot, sold, locked, asking),
    amenities: DEMO_AMENITIES, details: `${type} project at ${area}, ${district}. ${tot} units, ${face} facing, handover ${ho}.`,
    createdAt: '2026-05-15T10:00:00.000Z', updatedAt: '2026-05-15T10:00:00.000Z',
  };
}

export const DEMO_PROPERTIES = DEMO_RAW.map(mkDemo);

export function seedDB() {
  return {
    users: SEED_USERS.map(u => ({ ...u })),
    teams: SEED_TEAMS.map(t => ({ ...t })),
    leads: [],
    targets: [],
    activities: {},
    notifications: {},
    properties: SEED_PROPERTIES.map(p => ({ ...p })),
  };
}
