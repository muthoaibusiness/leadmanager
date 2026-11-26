// Walks the project pages as an agent against the mock server (dev/mock.mjs):
// the catalog and its filters, one project, a unit's hold request (asserted on
// the writes the app sent), and the held unit afterwards.
import { signInAs, tap, shot, text } from './mock.mjs';

// Photos are served by the check itself (see page.route below), so nothing leaves the machine.
const svg = (fill, label) => `https://img.example/${encodeURIComponent(fill)}/${encodeURIComponent(label)}.svg`;
const svgBody = (fill, label) => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="340"><rect width="520" height="340" fill="${fill}"/><text x="24" y="60" font-size="34" fill="#fff" font-family="sans-serif">${label}</text></svg>`);
const iso = (mins) => new Date(Date.now() + mins * 60000).toISOString();
const base = { developer: 'Demo Developers', status: 'AVAILABLE', company_id: 'c1', created_at: iso(-50000), updated_at: iso(-500), units: [], images: [], documents: [] };

const properties = [
  {
    ...base, id: 'p1', name: 'Lake View Tower', type: 'Apartment', purpose: 'Residential', district: 'Dhaka', area: 'Gulshan', address: 'Road 71, Gulshan 2, Dhaka',
    handover: 'Dec 2027', approval: 'RAJUK', listing: 'LV-101', fast_close_pct: 2, fast_close_days: 5,
    media: {
      images: [{ url: svg('#178A3F', 'Front view'), label: 'Front view' }, { url: svg('#1F5FD1', 'Lobby'), label: 'Lobby' }, { url: svg('#6D3FD0', 'Rooftop'), label: 'Rooftop' }],
      docs: [{ label: 'Brochure', url: 'https://files.example/lake-view-brochure.pdf' }],
      links: [{ label: 'Drive folder', url: 'https://drive.example/lake-view' }],
    },
    addons: [{ id: 'ao-park', name: 'Car parking', amount: 800000, icon: 'directions_car' }, { id: 'ao-util', name: 'Utility & connection', amount: 350000, icon: 'bolt' }],
    unit_statuses: [{ id: 'st-res', name: 'Reserved', color: '#B86E00', base: 'hold' }, { id: 'st-landowner', name: 'Landowner', color: '#6D3FD0', base: 'sold' }],
    variants: [
      { id: 'vA', name: 'Type A · 3 bed', beds: 3, baths: 3, size: 1450, listRate: 9500, floorRate: 8800, unitPrefix: 'A-', units: [
        { id: 'A-101', status: 'available' }, { id: 'A-102', status: 'available', size: 1500, price: 15000000 }, { id: 'A-103', status: 'hold', tag: 'st-res', heldBy: 'u4', heldByName: 'Babul Agent', clientName: 'Sadia Islam 5', note: 'Hold requested' },
        { id: 'A-104', status: 'sold', heldByName: 'Tariq Lead', clientName: 'Shakil Khan 8' }, { id: 'A-105', status: 'sold', tag: 'st-landowner' }, { id: 'A-106', status: 'available' }, { id: 'A-107', status: 'available' },
      ] },
      { id: 'vB', name: 'Type B · 2 bed', beds: 2, baths: 2, size: 1100, listRate: 9000, floorRate: 8400, unitPrefix: 'B-', units: [
        { id: 'B-101', status: 'available' }, { id: 'B-102', status: 'hold', heldBy: 'u3', heldByName: 'Mina Manager', clientName: 'Imran Hossain 6', holdUntil: iso(2000), note: 'Booked by management' }, { id: 'B-103', status: 'available' },
      ] },
    ],
  },
  { ...base, id: 'p2', name: 'Green Park Residence', type: 'Apartment', purpose: 'Residential', district: 'Dhaka', area: 'Bashundhara', handover: 'Jun 2028',
    variants: [{ id: 'v1', name: 'Standard', beds: 3, baths: 2, size: 1250, listRate: 7200, floorRate: 6800, unitPrefix: '', units: [{ id: 'G-1', status: 'sold' }, { id: 'G-2', status: 'sold' }, { id: 'G-3', status: 'sold' }, { id: 'G-4', status: 'sold' }, { id: 'G-5', status: 'available' }] }] },
  { ...base, id: 'p3', name: 'City Centre Mall', type: 'Commercial', purpose: 'Commercial', district: 'Chattogram', area: 'Agrabad', handover: 'Mar 2027',
    variants: [{ id: 'v1', name: 'Shop', beds: 0, baths: 0, size: 320, listRate: 22000, floorRate: 20000, unitPrefix: 'S-', units: [{ id: 'S-1', status: 'sold' }, { id: 'S-2', status: 'sold' }] }] },
];

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); } };
  const must = (cond, msg) => { if (!cond) throw new Error(msg); };
  await page.route(/img\.example\//, (route) => {
    const [, fill, label] = new URL(route.request().url()).pathname.split('/').map(decodeURIComponent);
    return route.fulfill({ status: 200, headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' }, body: svgBody(fill, label.replace(/\.svg$/, '')) });
  });
  const mock = await signInAs(page, 'AGENT', { properties });

  await step('menu opens the catalog with counts from the blocks', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Projects');
    await page.getByText('Lake View Tower').locator('visible=true').last().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    out.catalog = (await text(page)).slice(0, 900);
    await shot(page, 'proj-1-catalog');
    must(out.catalog.includes('3 projects · 17 units · 7 available · 2 on hold · 8 sold'), 'totals line is wrong');
    must(out.catalog.includes('6 of 10 available · 2 on hold · 2 sold'), 'Lake View counts are wrong');
    must(out.catalog.includes('Few Left') && out.catalog.includes('Sold Out'), 'status badges missing');
  });
  await step('status filter and search narrow the list', async () => {
    // the chip, not the Sold Out badge on a card
    await page.getByRole('button', { name: 'Sold Out', exact: true }).locator('visible=true').first().click();
    await page.waitForTimeout(500);
    const t1 = await text(page);
    must(t1.includes('1 project ·') && t1.includes('City Centre Mall'), 'Sold Out filter did not narrow to one project');
    await page.getByRole('button', { name: 'All status', exact: true }).locator('visible=true').first().click();
    await page.getByPlaceholder('Search 3 projects').locator('visible=true').last().fill('bashun');
    await page.waitForTimeout(500);
    const t2 = await text(page);
    must(t2.includes('1 project ·') && t2.includes('Green Park Residence'), 'search did not narrow');
    await page.getByPlaceholder('Search 3 projects').locator('visible=true').last().fill('');
  });
  await step('type and city filters (sheet)', async () => {
    await tap(page, 'Filters');
    await tap(page, 'Commercial');
    await shot(page, 'proj-2-filters');
    await tap(page, 'Show projects');
    const t1 = await text(page);
    must(t1.includes('1 project ·') && t1.includes('Filters 1'), 'type filter did not apply');
    await tap(page, 'Filters 1');
    await tap(page, 'Clear filters');
    await tap(page, 'Show projects');
    must((await text(page)).includes('3 projects ·'), 'clearing filters did not restore the list');
  });
  await step('open a project: facts, photos, documents, types, units', async () => {
    await tap(page, 'Lake View Tower');
    await page.getByText('UNIT TYPES').locator('visible=true').last().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    out.detail = (await text(page)).slice(0, 1400);
    await shot(page, 'proj-3-detail');
    must(out.detail.includes('Road 71, Gulshan 2, Dhaka') && out.detail.includes('RAJUK'), 'facts missing');
    must(out.detail.includes('Brochure') && out.detail.includes('Drive folder'), 'documents and links missing');
    must(!out.detail.includes('Project value') && !out.detail.includes('Bottom price'), 'an agent must not see project value or bottom price');
    must(out.detail.includes('Reserved') && out.detail.includes('Landowner'), 'project status tags missing');
    await page.getByText('A-107').locator('visible=true').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'proj-4-units');
  });
  await step('a held unit shows who holds it, with no action for another agent', async () => {
    await tap(page, 'A-103');
    await page.getByText('Awaiting management approval…').locator('visible=true').last().waitFor({ timeout: 8000 });
    const t1 = await text(page);
    await shot(page, 'proj-5-held');
    must(t1.includes('Sadia Islam 5') && t1.includes('Babul Agent'), 'held unit details missing');
    must(!t1.includes('Cancel request') && !t1.includes('Unhold'), 'another agent must not get a release action');
    await page.getByLabel('Close').locator('visible=true').last().click();
    await page.waitForTimeout(500);
  });
  await step('hold request needs a customer', async () => {
    await tap(page, 'A-102');
    await page.getByText('Select an existing customer to continue').locator('visible=true').last().waitFor({ timeout: 8000 });
    const before = mock.writes.length;
    await page.getByTestId('request-hold').locator('visible=true').last().click({ force: true });
    await page.waitForTimeout(500);
    must(mock.writes.length === before, 'a request went out with no customer');
    must((await text(page)).includes('৳1,50,00,000'), 'deal total should be the unit own price (1.5 Cr)');
  });
  await step('hold request: offer, add-on, customer, send', async () => {
    await page.getByPlaceholder('10000').locator('visible=true').last().fill('9800');
    await tap(page, 'Car parking + ৳8.0 L');
    await page.getByPlaceholder('Search customer by name / phone…').locator('visible=true').last().fill('Karim');
    await tap(page, 'Karim Uddin 2');
    await page.waitForTimeout(300);
    await shot(page, 'proj-6-hold-form');
    out.holdForm = (await text(page)).slice(-700);
    must(out.holdForm.includes('৳1,55,00,000'), 'deal total should be 9,800 × 1,500 + 8,00,000');
    await page.getByTestId('request-hold').locator('visible=true').last().click();
    await page.getByText('Hold request sent to management').waitFor({ timeout: 8000 });
    await page.waitForTimeout(800);
    const hr = mock.writes.find((w) => w.table === 'hold_requests' && w.method === 'POST');
    const row = hr ? (Array.isArray(hr.body) ? hr.body[0] : hr.body) : null;
    const prop = mock.writes.find((w) => w.table === 'properties' && w.method !== 'DELETE' && JSON.stringify(w.body).includes('Hold requested') && JSON.stringify(w.body).includes('"A-102"'));
    const unit = prop ? [].concat(prop.body)[0].variants.find((v) => v.id === 'vA').units.find((u) => u.id === 'A-102') : null;
    const notif = mock.writes.find((w) => w.table === 'notifications' && JSON.stringify(w.body).includes('HOLD_REQUEST'));
    out.holdWrite = { request: row, unit, notified: !!notif, notifBody: notif ? JSON.stringify(notif.body).slice(0, 260) : null };
    must(row, 'no hold_requests insert');
    must(row.property_id === 'p1' && row.unit_id === 'A-102' && row.variant_id === 'vA' && row.status === 'pending', 'request row names the wrong unit');
    must(row.agent_id === 'u1' && row.client_name === 'Karim Uddin 2' && !!row.client_phone && row.company_id === 'c1', 'request row lacks agent / client / company');
    must(row.deal_total === 15500000 && row.offer_rate === 9800, `deal numbers wrong: ${row.deal_total} / ${row.offer_rate}`);
    must(unit, 'no properties write putting A-102 on hold');
    must(unit.status === 'hold' && unit.tag === 'st-res' && unit.heldBy === 'u1' && unit.clientName === 'Karim Uddin 2' && unit.size === 1500 && unit.price === 15000000, 'unit was not held with the Reserved tag, holder, client and its own size/price');
    must(!!notif, 'management was not notified');
  });
  await step('the unit now reads Reserved and the requester can cancel', async () => {
    await page.waitForTimeout(2800); // let the toast go
    await shot(page, 'proj-7-after-hold');
    await tap(page, 'A-102');
    await page.waitForTimeout(800);
    await shot(page, 'proj-8-own-hold');
    await page.getByText('Awaiting management approval…').locator('visible=true').last().waitFor({ timeout: 8000 });
    await shot(page, 'proj-8-own-hold');
    const before = mock.writes.length;
    await tap(page, 'Cancel request');
    await page.waitForTimeout(600);
    await shot(page, 'proj-8b-confirm');
    out.confirmText = (await text(page)).slice(-300);
    await page.getByRole('button', { name: 'Cancel request' }).locator('visible=true').last().click();
    await page.getByText('Unit A-102 released').waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    const w = mock.writes.slice(before).find((x) => x.table === 'properties');
    const u = w ? [].concat(w.body)[0].variants.find((v) => v.id === 'vA').units.find((x) => x.id === 'A-102') : null;
    out.release = u;
    must(u && u.status === 'available' && !u.tag && u.size === 1500, 'release did not make the unit available again');
  });
  await step('add lead carries the project name', async () => {
    await page.getByText('Add lead for this project').locator('visible=true').last().scrollIntoViewIfNeeded();
    await tap(page, 'Add lead for this project');
    await page.waitForTimeout(1200);
    await shot(page, 'proj-9-add-lead');
    out.addLead = (await text(page)).slice(0, 500);
  });
  out.writes = mock.writes.map((w) => w.method + ' ' + w.table);
  return out;
}
