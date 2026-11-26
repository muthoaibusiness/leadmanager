// Walks the Pipeline and Calendar screens as a Team Lead against the mock
// server (dev/mock.mjs): stage chips and counts, a move between stages (and
// what it wrote), closing a deal from the board, stage editing, then the
// calendar's week strip, day schedule and upcoming list.
import { signInAs, tap, shot, text } from './mock.mjs';

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) {
    out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]);
    out.failText = out.failText || (await text(page)).slice(0, 500);
    await shot(page, 'fail-' + out.steps.length).catch(() => {});
  } };
  const mock = await signInAs(page, 'TEAM_LEAD');
  const vis = (loc) => loc.locator('visible=true').last();
  const body = (w) => JSON.stringify(w.body || '');

  await step('pipeline opens with stages and counts', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Pipeline');
    await page.getByText('STAGES').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    out.pipeline = (await text(page)).slice(0, 700);
    for (const s of ['Inquiry', 'Site Visit', 'Negotiation', 'Closed Won', 'Deals in progress', 'Pipeline value']) {
      if (!(await page.getByText(s, { exact: true }).locator('visible=true').count())) throw new Error('missing: ' + s);
    }
    await shot(page, 'pipe-1-board');
  });
  await step('choosing a stage lists its leads', async () => {
    await tap(page, 'Site Visit');
    await page.waitForTimeout(600);
    out.visitRows = await page.getByLabel(/^Move /).locator('visible=true').count();
    if (!out.visitRows) throw new Error('no leads listed in Site Visit');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'pipe-2-stage');
  });
  await step('move a lead to Negotiation writes the status and logs it', async () => {
    const before = mock.writes.length;
    await page.getByLabel(/^Move /).locator('visible=true').first().click();
    await vis(page.getByText('Current stage')).waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await shot(page, 'pipe-3-move-sheet');
    await vis(page.getByLabel('Move to Negotiation')).click();
    await page.getByText(/→ Negotiation/).waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    const w = mock.writes.slice(before);
    out.move = {
      leadStatusWritten: w.some((x) => x.table === 'leads' && body(x).includes('NEGOTIATING')),
      statusChangeLogged: w.some((x) => x.table === 'activities' && body(x).includes('STATUS_CHANGE')),
      writes: w.map((x) => x.method + ' ' + x.table),
    };
    await shot(page, 'pipe-4-moved');
    if (!out.move.leadStatusWritten || !out.move.statusChangeLogged) throw new Error('move did not write: ' + JSON.stringify(out.move));
  });
  await step('Closed Won asks first, then records the deal', async () => {
    const before = mock.writes.length;
    await page.getByLabel(/^Move /).locator('visible=true').first().click();
    await vis(page.getByLabel('Move to Closed Won')).click();
    await vis(page.getByText('Close this deal as won?')).waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    await shot(page, 'pipe-5-confirm');
    out.noWriteBeforeConfirm = mock.writes.length === before;
    await tap(page, 'Close as won');
    await page.getByText(/→ Closed Won/).waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    const w = mock.writes.slice(before);
    out.won = {
      leadStatusWritten: w.some((x) => x.table === 'leads' && body(x).includes('DEAL_CLOSED_WON')),
      dealLogged: w.some((x) => x.table === 'activities' && body(x).includes('"DEAL"')),
    };
    if (!out.noWriteBeforeConfirm || !out.won.leadStatusWritten || !out.won.dealLogged) throw new Error('won: ' + JSON.stringify(out.won));
  });
  await step('edit stages: add one', async () => {
    await vis(page.getByLabel('Edit stages')).click();
    await page.getByPlaceholder('New stage name').waitFor({ timeout: 8000 });
    await page.getByPlaceholder('New stage name').fill('Paperwork');
    await page.waitForTimeout(300);
    await shot(page, 'pipe-6-stages');
    await tap(page, 'Add stage');
    await tap(page, 'Done');
    await vis(page.getByText('Paperwork', { exact: true })).waitFor({ timeout: 8000 });
    await tap(page, 'Paperwork');
    await page.getByText('Nothing in Paperwork').waitFor({ timeout: 8000 });
    await shot(page, 'pipe-7-empty-stage');
  });
  await step('a lead opens from the pipeline', async () => {
    await tap(page, 'Inquiry');
    await page.waitForTimeout(500);
    await vis(page.getByText(/^(Rahim Ahmed|Rumana Sultana|Karim Uddin|Jubayer Alam) \d+$/)).click();
    await page.getByText('ACTIONS').waitFor({ timeout: 15000 });
  });

  // A fresh boot for the calendar (the browser's Back does not reliably walk
  // two screens down on the web target).
  await signInAs(page, 'TEAM_LEAD');

  await step('calendar opens with the week strip and upcoming list', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Calendar');
    await vis(page.getByText('Upcoming', { exact: true })).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    out.calendar = (await text(page)).slice(0, 900);
    for (const s of ["Today's schedule", 'Confirmed', 'Pending', 'Next 30 days']) {
      if (!(await page.getByText(s, { exact: true }).locator('visible=true').count())) throw new Error('missing: ' + s);
    }
    out.upcomingMeetings = await page.getByText(/Online meeting · #/).locator('visible=true').count();
    out.upcomingVisits = await page.getByText(/Site visit · #/).locator('visible=true').count();
    if (!out.upcomingMeetings || !out.upcomingVisits) throw new Error('no events listed');
    await shot(page, 'cal-1-today');
  });
  await step('picking the day of a meeting shows it in the schedule', async () => {
    // The mock's meetings are 600 minutes from now.
    const d = new Date(Date.now() + 600 * 60000);
    const month = d.toLocaleString('en-US', { month: 'long' });
    const cell = vis(page.getByLabel(new RegExp(`^${d.getDate()} ${month}, \\d+ appointments?$`)));
    out.meetingDayLabel = await cell.getAttribute('aria-label');
    await cell.click();
    await page.waitForTimeout(600);
    out.dayChip = await vis(page.getByText(/^\d+ appointments?$/)).innerText();
    if (/^0 /.test(out.dayChip)) throw new Error('the meeting day shows no appointments');
    await shot(page, 'cal-2-day');
  });
  await step('paging a week and coming back to today', async () => {
    await vis(page.getByLabel('Previous week')).click();
    await page.waitForTimeout(400);
    await shot(page, 'cal-3-prev-week');
    await vis(page.getByLabel('Next week')).click();
    await vis(page.getByLabel('Next week')).click();
    await page.waitForTimeout(400);
    await shot(page, 'cal-4-next-week');
    await vis(page.getByLabel('Go to today')).click();
    await vis(page.getByText("Today's schedule")).waitFor({ timeout: 8000 });
  });
  await step('an event opens its lead', async () => {
    await vis(page.getByText(/Online meeting · #/)).click();
    await page.getByText('ACTIONS').waitFor({ timeout: 15000 });
    await shot(page, 'cal-5-lead');
  });
  out.writeCount = mock.writes.length;
  return out;
}
