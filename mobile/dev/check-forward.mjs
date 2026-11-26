// Walks the Forward and Transfer screens against the mock server (dev/mock.mjs):
//   1. an agent forwards its own lead to a teammate (plain hand-off)
//   2. an agent forwards a Site Visit Done lead to the Team Lead (offer required)
//   3. Management transfers a lead to a team and agent
// Returns what it saw and what the app wrote, for the caller to read.
import { installMock, tap, shot, text } from './mock.mjs';

// signInAs from mock.mjs, with a longer reload wait: with several checks running
// against one dev server a rebuild can take longer than its 30 s.
async function signInAs(page, role, overrides) {
  const mock = await installMock(page, role, overrides);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('pcrm_auth', JSON.stringify(s)); },
    { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 86400, sub: mock.me.auth_user_id, uid: mock.me.id });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(/Good (morning|afternoon|evening)/).first().waitFor({ timeout: 180000 });
  return mock;
}

// The web fetches forward candidates with role / team filters; the base mock
// answers every `users` query with all four accounts, so answer those here.
// Also: the shared code drops a team with the id 't1' (a legacy seed team, see
// migrateTenancy in src/lib/db.js), so the mock's team is served under another id.
const TEAM = 'team-alpha';
const reteam = (u) => (u.team_id === 't1' ? { ...u, team_id: TEAM } : u);
const users = (url, data, me) => {
  const q = decodeURIComponent(url.search);
  if (/auth_user_id=eq\./.test(q)) return [reteam(me)];
  const id = /[?&]id=eq\.([^&]+)/.exec(q);
  if (id) return data.users.filter((u) => u.id === id[1]).map(reteam);
  let rows = data.users.map(reteam);
  const one = /[?&]role=eq\.([A-Z_]+)/.exec(q);
  const many = /[?&]role=in\.\(([^)]*)\)/.exec(q);
  const team = /[?&]team_id=eq\.([^&]+)/.exec(q);
  if (one) rows = rows.filter((u) => u.role === one[1]);
  if (many) { const set = new Set(many[1].split(',')); rows = rows.filter((u) => set.has(u.role)); }
  if (team) rows = rows.filter((u) => u.team_id === team[1]);
  return rows;
};
const teams = (url, data) => [{ ...data.team, id: TEAM }];
const overrides = { users, teams };

const has = (w, s) => JSON.stringify(w.body || '').includes(s);
// A button's accessible name also carries its icon glyph, so match on its label text.
const button = (page, name) => page.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).locator('visible=true').last();
const disabled = (page, name) => button(page, name).evaluate((el) => el.getAttribute('aria-disabled') === 'true' || el.disabled === true);
const openLead = async (page, name) => {
  await tap(page, 'Leads');
  await tap(page, name);
  await page.getByText('ACTIONS').locator('visible=true').last().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
};

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); } };

  // ── 1. plain hand-off to a teammate ───────────────────────────────────────
  let mock = await signInAs(page, 'AGENT', overrides);
  await step('1 open the forward screen for an own lead', async () => {
    await openLead(page, 'Karim Uddin 2');
    await tap(page, 'Forward to agent');
    await page.getByText('Select teammate').waitFor({ timeout: 15000 });
    await page.getByText('Babul Agent').waitFor({ timeout: 15000 });
    await shot(page, 'fwd-1-agent');
    const body = await text(page);
    out.agent = {
      // CONTACTED lead held by the agent: only the plain hand-off is offered.
      tlDestOffered: await button(page, 'Team Lead').count() > 0,
      selfDestOffered: body.includes('Self Forward'),
      candidates: ['Ayesha Agent', 'Babul Agent', 'Tariq Lead', 'Mina Manager'].filter((n) => body.split('Select teammate')[1]?.includes(n)),
      forwardDisabledBeforePick: await disabled(page, 'Forward'),
    };
  });
  await step('1 search narrows the candidates', async () => {
    await page.getByPlaceholder('Search teammate…').fill('zzz');
    await page.getByText('No match for "zzz"').waitFor({ timeout: 5000 });
    await page.getByPlaceholder('Search teammate…').fill('bab');
    await page.waitForTimeout(300);
    const body = (await text(page)).split('Select teammate')[1] || '';
    out.agent.searchBab = { babul: body.includes('Babul Agent'), tariq: body.includes('Tariq Lead') };
  });
  await step('1 back with input asks before discarding', async () => {
    await tap(page, 'Babul Agent');
    await page.locator('a[aria-label$="back"]').locator('visible=true').last().click();
    await page.getByText('Discard forward?').waitFor({ timeout: 5000 });
    await shot(page, 'fwd-2-discard');
    await tap(page, 'Cancel');
    out.agent.stillOnFormAfterCancel = await page.getByText('Select teammate').locator('visible=true').count() > 0;
  });
  await step('1 forward to the teammate', async () => {
    await shot(page, 'fwd-3-agent-picked');
    await button(page, 'Forward').click();
    await page.getByText('Lead forwarded to Babul Agent').waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    await shot(page, 'fwd-4-agent-done');
    const patch = mock.writes.find((w) => w.table === 'leads' && w.method === 'PATCH' && w.query.includes('L002'));
    out.agent.writes = {
      leadPatch: patch ? patch.body : null,
      forwardedActivity: mock.writes.filter((w) => w.table === 'activities' && has(w, 'FORWARDED')).map((w) => w.body),
      offerActivity: mock.writes.some((w) => w.table === 'activities' && has(w, 'OFFER')),
      notifications: mock.writes.filter((w) => w.table === 'notifications').map((w) => w.body),
      backOnLead: await page.getByText('ACTIONS').locator('visible=true').count() > 0,
      discardAskedAfterSubmit: await page.getByText('Discard forward?').locator('visible=true').count() > 0,
    };
  });

  // ── 2. closing hand-off to the Team Lead ──────────────────────────────────
  mock = await signInAs(page, 'AGENT', overrides);
  await step('2 Team Lead destination shows at Site Visit Done', async () => {
    await openLead(page, 'Imran Hossain 6');
    await tap(page, 'Forward to agent');
    await page.getByText('Select teammate').waitFor({ timeout: 15000 });
    await shot(page, 'fwd-5-svd-dests');
    await button(page, 'Team Lead').click();
    await page.getByText('Select Team Lead').waitFor({ timeout: 8000 });
    await page.getByText('Tariq Lead').locator('visible=true').last().waitFor({ timeout: 8000 });
    const list = ((await text(page)).split('Select Team Lead')[1] || '').split('An offer is required')[0];
    out.tl = { candidates: ['Ayesha Agent', 'Babul Agent', 'Tariq Lead', 'Mina Manager'].filter((n) => list.includes(n)) };
    await tap(page, 'Tariq Lead');
    out.tl.forwardDisabledWithoutOffer = await disabled(page, 'Forward');
    await shot(page, 'fwd-6-tl-empty');
  });
  await step('2 the offer is validated and filled', async () => {
    const our = page.getByPlaceholder('e.g. 10500');
    await our.fill('123456'); // a sixth digit is refused (OFFER_MAX)
    out.tl.sixDigitsRefused = (await our.inputValue()) === '';
    await our.fill('10500');
    await page.getByPlaceholder('e.g. 9500').fill('9500');
    out.tl.forwardDisabledWithoutSft = await disabled(page, 'Forward');
    await page.getByPlaceholder('e.g. 1200').fill('1200');
    await tap(page, 'Lake View Tower · Gulshan');
    await page.getByPlaceholder('Any context for the Team Lead…').fill('Client wants a corner unit.');
    await page.getByText('Pipeline Value').waitFor({ timeout: 5000 });
    const body = await text(page);
    out.tl.pipelineText = (body.split('Pipeline Value')[1] || '').slice(0, 60).replace(/\n/g, ' | ');
    out.tl.projectHint = /\d+ leads? already interested in Lake View Tower/.exec(body)?.[0] || null;
    out.tl.forwardEnabled = !(await disabled(page, 'Forward'));
    await page.getByText('Pipeline Value').scrollIntoViewIfNeeded();
    await shot(page, 'fwd-7-tl-offer');
  });
  await step('2 forward with the offer', async () => {
    await button(page, 'Forward').click();
    await page.getByText('Lead forwarded to Tariq Lead').waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    const patches = mock.writes.filter((w) => w.table === 'leads' && w.method === 'PATCH' && w.query.includes('L006')).map((w) => w.body);
    out.tl.writes = {
      leadPatches: patches,
      offerActivity: mock.writes.filter((w) => w.table === 'activities' && has(w, 'OFFER')).map((w) => w.body),
      forwardedActivity: mock.writes.some((w) => w.table === 'activities' && has(w, 'FORWARDED')),
      notifications: mock.writes.filter((w) => w.table === 'notifications').map((w) => w.body),
    };
    await shot(page, 'fwd-8-tl-done');
  });

  // ── 3. Management transfer ────────────────────────────────────────────────
  mock = await signInAs(page, 'MANAGEMENT', overrides);
  await step('3 open the transfer screen', async () => {
    await openLead(page, 'Rahim Ahmed 1');
    await tap(page, 'Transfer lead');
    await page.getByText('Select Team (Team Lead)').waitFor({ timeout: 15000 });
    out.transfer = { disabledAtStart: await disabled(page, 'Transfer'), firstPrompt: (await text(page)).includes('Select a Team first') };
    await shot(page, 'xfer-1-empty');
    await tap(page, "Tariq Lead's Team");
    const list = (await text(page)).split('Select Agent')[1] || '';
    out.transfer.agents = ['Ayesha Agent', 'Babul Agent', 'Tariq Lead', 'Mina Manager'].filter((n) => list.includes(n));
    out.transfer.disabledWithoutAgent = await disabled(page, 'Transfer');
    await tap(page, 'Ayesha Agent');
    await shot(page, 'xfer-2-picked');
  });
  await step('3 transfer', async () => {
    await button(page, 'Transfer').click();
    await page.getByText('Lead transferred successfully').waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    const patch = mock.writes.find((w) => w.table === 'leads' && w.method === 'PATCH' && w.query.includes('L001'));
    out.transfer.writes = {
      leadPatch: patch ? patch.body : null,
      note: mock.writes.filter((w) => w.table === 'activities' && has(w, 'Lead transferred to')).map((w) => w.body),
    };
    await shot(page, 'xfer-3-done');
  });
  return out;
}
