// Checks src/screens/home/SupervisorHome.js against the mock server (dev/mock.mjs).
//
//  1. Signs in as Management and confirms the app's own bundle still loads
//     (the Home greeting appears).
//  2. Renders ManagementHome and TeamLeadHome through a second Metro entry,
//     dev/supervisor-preview.js, because HomeScreen does not import them yet.
//     The preview page is served on the app's own origin, so it boots from the
//     same stored session and the same mocked project.
//     Team Lead runs twice: without the rollup functions (the mock's default,
//     so the lead-book fallback) and with them answered.
import { installMock, signInAs, tap, text } from './mock.mjs';

const ORIGIN = 'http://localhost:8099';
const BUNDLE = '/dev/supervisor-preview.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable';
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{height:100%}body{overflow:hidden;margin:0}#root{display:flex;height:100%;flex:1}</style></head>
<body><div id="root"></div><script src="${BUNDLE}" defer></script></body></html>`;

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();
const upd = (id, lead, user, mins, type = 'STATUS_CHANGE') => ({ id, lead_id: lead, type, description: 'Status → Contacted', user_id: user, user_name: user, duration_seconds: 0, timestamp: iso(mins), company_id: 'c1' });

// activities, three ways: the contact tracker's own load (type=in.(…)), one
// lead's timeline, and everything else (the activity window): offers on the
// leads in the closing statuses, so the Team Lead list has rows.
const activities = (url, data) => {
  const q = decodeURIComponent(url.search);
  if (/type=in\./.test(q)) {
    return [
      upd('x1', 'L002', 'u1', -30), upd('x2', 'L002', 'u1', -90, 'FOLLOW_UP'), upd('x3', 'L012', 'u1', -200),
      upd('x4', 'L003', 'u4', -300),
      upd('x5', 'L001', 'u1', -40), // L001 is in New now: left out
      upd('x6', 'L002', 'system', -50), // the system's: left out
      upd('x7', 'L002', 'u1', -1500), upd('x8', 'L003', 'u1', -1600), // the 24 hours before
    ];
  }
  const one = /lead_id=eq\.([^&]+)/.exec(q);
  if (one) return data.activities(one[1].replace(/"/g, ''));
  return data.leads.filter((l) => l.status === 'NEGOTIATING' || l.status === 'SITE_VISIT_DONE').map((l, i) => ({
    id: 'of' + l.id, lead_id: l.id, type: 'OFFER', description: JSON.stringify({ pipelineValue: 5000000 + i * 250000 }),
    user_id: 'u2', user_name: 'Tariq Lead', duration_seconds: 0, timestamp: iso(-500 - i * 60), company_id: 'c1',
  }));
};

const ROLLUPS = {
  dashboard_rollup: { revenue: 13500000, closing_value: 21000000, closing_count: 4, won: 3, lost: 1, site_visits: 6, total: 17, source_counts: { META_ADS: 9, WEBSITE: 8 } },
  agent_lead_stats: [
    { user_id: 'u1', leads: 30, calls: 12, won: 2, closed: 3, revenue: 9000000, converted: 2, meetings_set: 5, visits_done: 4 },
    { user_id: 'u4', leads: 16, calls: 4, won: 1, closed: 1, revenue: 4500000, converted: 1, meetings_set: 2, visits_done: 2 },
    { user_id: 'u2', leads: 0, calls: 0, won: 0, closed: 0, revenue: 0, converted: 0, meetings_set: 0, visits_done: 0 },
  ],
  activity_rollup: { talk_secs: 5400, offers: 7 },
};

export default async function run(page) {
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); } };
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).split('\n')[0]));
  await page.route(`${ORIGIN}/__supervisor`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: HTML }));

  // The preview boots from a stored session on the app's origin, like signInAs,
  // but never loads the app's own page: a break in another screen cannot hide
  // what these two components do.
  await page.route(`${ORIGIN}/__blank`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  const preview = async (role, name, { rollups = false } = {}) => {
    const mock = await installMock(page, role, { activities });
    await page.goto(ORIGIN + '/__blank', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('pcrm_auth', JSON.stringify(s)); },
      { access_token: 'mock-access', refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 86400, sub: mock.me.auth_user_id, uid: mock.me.id });
    if (rollups) {
      await page.route(/\.supabase\.co\/rest\/v1\/rpc\//, (route) => {
        const fn = new URL(route.request().url()).pathname.split('/').pop();
        if (route.request().method() === 'OPTIONS' || !ROLLUPS[fn]) return route.fallback();
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(ROLLUPS[fn]) });
      });
    }
    await page.setViewportSize({ width: 390, height: 3400 }); // tall: the whole Home in one picture
    await page.goto(ORIGIN + '/__supervisor', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByText(`Preview: ${role}`).waitFor({ timeout: 240000 });
    await page.waitForTimeout(4000); // counts, the lead book and the period loads
    out[name] = await text(page);
    await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/supervisor-${name}.png` });
    return mock;
  };
  const went = () => page.getByTestId('went').innerText();

  await step('the app bundle still loads (Management greeting)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await signInAs(page, 'MANAGEMENT');
    out.appHome = (await text(page)).slice(0, 200);
  });

  await step('ManagementHome renders its five sections', async () => {
    await preview('MANAGEMENT', 'management');
    for (const s of ['OVERVIEW', 'PERFORMANCE OVERVIEW', 'Prospects contacted', 'CONVERSION FUNNEL', 'Lead sources', 'AGENTS']) {
      if (!out.management.includes(s)) throw new Error('missing section: ' + s);
    }
  });
  await step('Prospects contacted counts 4 (New lead and system rows left out), per person 3 and 1', async () => {
    const m = /Lead updates by your team\s+(\d+)\s+([^\n]+)\s+vs previous 24 hours\s+Ayesha Agent\s+(\d+)\s+Babul Agent\s+(\d+)/.exec(out.management);
    out.contacted = m ? { total: m[1], change: m[2], ayesha: m[3], babul: m[4] } : null;
    if (!m || m[1] !== '4' || m[3] !== '3' || m[4] !== '1' || m[2] !== '+100.0%') throw new Error('got ' + JSON.stringify(out.contacted));
  });
  await step('an agent row opens AgentDetail with its userId', async () => {
    await tap(page, 'Ayesha Agent');
    out.navAgent = await went();
    if (!/^NAV AgentDetail \{"userId":"u1"\}$/.test(out.navAgent)) throw new Error(out.navAgent);
  });
  await step('period chips change the overview and the performance period', async () => {
    await tap(page, '7 days', { settle: 2500 }); // first match on screen is the last visible: the performance chips
    await tap(page, 'Month', { settle: 1500 });
    out.managementAfterChips = await text(page);
    await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/supervisor-management-chips.png` });
    if (!/vs previous 7 days/.test(out.managementAfterChips)) throw new Error('performance period did not change');
    if (!/Leads received this month/.test(out.managementAfterChips)) throw new Error('overview period did not change');
  });

  await step('TeamLeadHome renders from the lead book (no rollup functions)', async () => {
    await preview('TEAM_LEAD', 'teamLeadFallback');
    for (const s of ['TEAM NUMBERS', 'DEALS TO CLOSE', 'TEAM MEMBERS', 'MONTHLY TARGET', 'Month revenue']) {
      if (!out.teamLeadFallback.includes(s)) throw new Error('missing: ' + s);
    }
  });
  await step('TeamLeadHome renders from the rollup functions', async () => {
    await preview('TEAM_LEAD', 'teamLeadRollup', { rollups: true });
    for (const s of ['BDT 1.35Cr', 'BDT 2.10Cr', '3/4', '75%', '17', '90 min', '2 won · BDT 90.0L', '30 leads · 5 meetings · 4 visits']) {
      if (!out.teamLeadRollup.includes(s)) throw new Error('missing: ' + s);
    }
  });

  await step('a Team Lead card opens the lead list it counted', async () => {
    await page.getByText('Site visits done', { exact: true }).locator('visible=true').first().click(); // the card, not the target's line
    await page.waitForTimeout(500);
    out.navVisits = await went();
    const p = JSON.parse(out.navVisits.replace(/^NAV LeadList /, '')).preset;
    if (p.title !== 'Site Visits Done' || p.dateField !== 'site_visit_done_date' || !p.start || !p.end || p.extra[0] !== 'site_visit_done_date.not.is.null' || p.involved !== true) throw new Error(out.navVisits);
    await tap(page, 'Pipeline value');
    out.navPipeline = await went();
    if (!/offer_sent_at\.not\.is\.null/.test(out.navPipeline)) throw new Error(out.navPipeline);
  });
  await step('a deal row opens the lead; a member row opens AgentDetail', async () => {
    await tap(page, 'Farhana Akter 7');
    out.navDeal = await went();
    if (!/^NAV LeadDetail \{"leadId":"L\d+"\}$/.test(out.navDeal)) throw new Error(out.navDeal);
    await tap(page, 'Babul Agent');
    out.navMember = await went();
    if (!/^NAV AgentDetail \{"userId":"u4"\}$/.test(out.navMember)) throw new Error(out.navMember);
  });

  out.pageErrors = errors;
  return out;
}
