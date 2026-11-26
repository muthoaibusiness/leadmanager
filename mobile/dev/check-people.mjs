// Walks the people pages against the mock server (dev/mock.mjs): Team, an
// agent, their leads, Reports and Performance as a Team Lead, then Performance
// as Management. The mock answers rpc/* with "no such function", so every
// number here comes from the in-browser fallback over the lead book.
import { signInAs, tap, shot, text } from './mock.mjs';

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();

// Activities: a lead's own timeline, one person's feed (fetchUserActivity) and
// the recent-activity window (a few connected calls and a follow-up).
const activities = (url, data) => {
  const q = decodeURIComponent(url.search);
  const one = /lead_id=eq\.([^&]+)/.exec(q);
  if (one) return data.activities(one[1].replace(/"/g, ''));
  const who = /user_id=eq\.([^&]+)/.exec(q);
  if (who) {
    const uid = who[1];
    const u = data.users.find((x) => x.id === uid) || { name: 'Someone' };
    const row = (n, type, description, mins, lead, secs = 0) => ({ id: `f${uid}${n}`, type, description, timestamp: iso(-mins), duration_seconds: secs, user_id: uid, user_name: u.name, lead_id: lead.id, leads: { name: lead.name } });
    return [
      row(1, 'STATUS_CHANGE', 'Status → Connected', 25, data.leads[1]),
      row(2, 'CALL', 'Call logged · 4 min (total: 2)', 90, data.leads[4], 240),
      row(3, 'FOLLOW_UP', 'Follow-up set for tomorrow, 11:00', 400, data.leads[7]),
    ];
  }
  const call = (n, uid, lead, secs) => ({ id: 'w' + n, lead_id: lead.id, type: 'CALL', description: 'Call logged', user_id: uid, user_name: '', duration_seconds: secs, timestamp: iso(-n * 300), company_id: 'c1' });
  return [
    call(1, 'u1', data.leads[1], 300), call(2, 'u1', data.leads[2], 420), call(3, 'u4', data.leads[3], 180),
    { id: 'w4', lead_id: data.leads[4].id, type: 'FOLLOW_UP', description: 'Follow-up set', user_id: 'u1', user_name: '', duration_seconds: 0, timestamp: iso(-200), company_id: 'c1' },
  ];
};

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); await shot(page, 'people-fail-' + out.steps.length).catch(() => {}); } };
  const must = (cond, what) => { if (!cond) throw new Error('expected ' + what); };
  const full = (name) => page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/${name}.png`, fullPage: true });

  const mock = await signInAs(page, 'TEAM_LEAD', { activities });

  await step('team lists the agents with their numbers', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Team');
    await page.getByText('AGENTS · 2').waitFor({ timeout: 15000 });
    await page.waitForTimeout(2500);
    out.team = (await text(page)).slice(0, 900);
    must(/AGENTS · 2/.test(out.team), 'two agents');
    must(/\n30\nCustomers/.test(out.team), "Ayesha's 30 customers");
    must(/\n16\nCustomers/.test(out.team), "Babul's 16 customers");
    must(/Status → Connected/.test(await text(page)), 'the team activity feed');
    await shot(page, 'people-1-team');
  });

  await step('set a target from the team card', async () => {
    await tap(page, 'Target');
    await page.getByPlaceholder('e.g. 15').locator('visible=true').last().fill('12');
    await shot(page, 'people-2-target');
    await tap(page, 'Set target');
    await page.getByText('Target updated').waitFor({ timeout: 8000 });
    const w = mock.writes.find((x) => x.table === 'targets');
    out.targetWrite = w ? JSON.stringify(w.body).slice(0, 200) : null;
    must(w && JSON.stringify(w.body).includes('12'), 'a targets write of 12');
    must(/\/ 12/.test(await text(page)), 'the card to show / 12');
  });

  await step('open an agent', async () => {
    // The first match is the card; the last is the activity feed's chip.
    await page.getByText('Ayesha Agent', { exact: true }).locator('visible=true').first().click();
    await page.getByText("Open Ayesha Agent's leads").waitFor({ timeout: 15000 });
    await page.getByText('Leads Sourced').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    out.agent = (await text(page)).slice(0, 1400);
    must(/Funnel/.test(out.agent) && /Contact %/.test(out.agent), 'the performance breakdown');
    must(/Call logged · 4 min/.test(await text(page)), 'recent activity');
    await shot(page, 'people-3-agent');
    await full('people-3-agent-full');
  });

  await step('period chip recomputes the agent row', async () => {
    await tap(page, 'All time');
    await page.waitForTimeout(600);
    out.agentAllTime = /Leads Sourced\n(\d+)/.exec(await text(page))?.[1];
    must(out.agentAllTime === '30', 'all-time sourced 30, got ' + out.agentAllTime);
  });

  await step("the button opens that agent's leads", async () => {
    await tap(page, "Open Ayesha Agent's leads");
    await page.getByText(/^\d+ customers?$/).locator('visible=true').last().waitFor({ timeout: 15000 });
    must(/Ayesha Agent's leads/.test(await text(page)), 'the list title');
    await shot(page, 'people-4-agent-leads');
    await page.goBack();
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(500);
  });

  await step('reports', async () => {
    await tap(page, 'Reports');
    await page.getByText('CONVERSION FUNNEL').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    out.reports = (await text(page)).slice(0, 1400);
    must(/46\s*\n?leads/.test(out.reports), '46 leads in the source card');
    must(/Meta/i.test(out.reports) || /META_ADS/.test(out.reports), 'a source row');
    must(/Meeting Set/.test(out.reports), 'the funnel');
    await shot(page, 'people-5-reports');
    await full('people-5-reports-full');
    await tap(page, 'Past 7 days');
    await page.waitForTimeout(600);
    out.reports7d = (/(\d+)\s*\n?leads/.exec(await text(page)) || [])[1];
    await page.goBack();
    await page.waitForTimeout(500);
  });

  await step('performance as a team lead', async () => {
    await tap(page, 'Performance');
    await page.getByText('Leads Sourced').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    out.perfTL = (await text(page)).slice(0, 1200);
    must(/Ayesha Agent/.test(out.perfTL) && /Babul Agent/.test(out.perfTL), 'both agents ranked');
    must(!/All teams/.test(out.perfTL), 'no team picker for a Team Lead');
    await shot(page, 'people-6-perf-tl');
  });

  let mgmt = { writes: [] };
  try {
    // Back on the app's own page first: a failed step above can leave the history short.
    if (!page.url().startsWith('http://localhost')) await page.goto('http://localhost:8099/', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    mgmt = await signInAs(page, 'MANAGEMENT', { activities });
  } catch (e) { out.steps.push('FAIL management sign-in: ' + String(e.message || e).split('\n')[0]); return out; }
  await step('performance as management', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Performance');
    await page.getByText('Leads Sourced').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    out.perfMgmt = (await text(page)).slice(0, 1200);
    must(/All teams/.test(out.perfMgmt) && /Team Alpha/.test(out.perfMgmt), 'the team picker');
    must(/Ayesha Agent/.test(out.perfMgmt), 'agents ranked');
    await shot(page, 'people-7-perf-mgmt');
    await tap(page, 'All time');
    await page.waitForTimeout(600);
    out.perfMgmtAll = (await text(page)).slice(0, 700);
    await tap(page, 'Best conversion');
    await page.waitForTimeout(400);
    must(/Most sourced/.test(await text(page)), 'the sort to cycle');
    await shot(page, 'people-8-perf-mgmt-all');
  });
  await step('performance row opens the agent', async () => {
    await tap(page, 'Babul Agent');
    await page.getByText("Open Babul Agent's leads").waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);
    out.mgmtSeesTarget = (await page.getByText('Set target').locator('visible=true').count()) > 0;
    await shot(page, 'people-9-agent-mgmt');
  });
  out.writeCount = mock.writes.length + mgmt.writes.length;
  return out;
}
