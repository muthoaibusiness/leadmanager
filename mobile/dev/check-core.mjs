// Walks the core flow as an agent against the mock server (dev/mock.mjs):
// home, lead list, a lead, a status change, a note, a follow-up, alerts, menu.
// Returns what it saw and what the app wrote, for the caller to read.
import { signInAs, tap, shot, text } from './mock.mjs';

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); } };
  const mock = await signInAs(page, 'AGENT');

  await step('home shows greeting, follow-ups and counts', async () => {
    await page.getByText('My leads').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    out.home = (await text(page)).slice(0, 600);
    await shot(page, 'core-1-home');
  });
  await step('lead list pages through the server', async () => {
    await tap(page, 'Leads');
    await page.getByText('46 customers').waitFor({ timeout: 15000 });
    await shot(page, 'core-2-leads');
  });
  await step('status filter narrows the list', async () => {
    await tap(page, 'Interested');
    await page.waitForTimeout(1200);
    out.interestedCount = await page.getByText(/^\d+ customers?$/).locator('visible=true').last().innerText();
    await tap(page, 'All');
  });
  await step('open a lead', async () => {
    await tap(page, 'Rahim Ahmed 1');
    await page.getByText('ACTIONS').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await shot(page, 'core-3-lead');
    out.lead = (await text(page)).slice(0, 900);
  });
  await step('Connected changes the status and logs it', async () => {
    await tap(page, 'Connected');
    await page.getByText('Status updated').waitFor({ timeout: 8000 });
    const patch = mock.writes.find((w) => w.table === 'leads' && w.method === 'PATCH');
    const act = mock.writes.find((w) => w.table === 'activities' && JSON.stringify(w.body).includes('STATUS_CHANGE'));
    out.statusWrite = { leadPatched: !!patch && JSON.stringify(patch.body).includes('CONTACTED'), statusChangeLogged: !!act };
  });
  await step('add a note', async () => {
    await tap(page, 'Add note');
    await page.getByPlaceholder(/What happened/).fill('Asked for the brochure.');
    await tap(page, 'Save note');
    await page.getByText('Note added').waitFor({ timeout: 8000 });
    out.noteLogged = mock.writes.some((w) => w.table === 'activities' && JSON.stringify(w.body).includes('Asked for the brochure.'));
  });
  await step('set a follow-up', async () => {
    await tap(page, 'Follow-up');
    await page.waitForTimeout(600);
    await tap(page, 'Tomorrow');
    await tap(page, '11 AM');
    await shot(page, 'core-4-followup');
    await page.getByRole('button', { name: 'Set follow-up' }).locator('visible=true').last().click();
    await page.getByText(/Follow-up set for/).waitFor({ timeout: 8000 });
    out.followupWrites = mock.writes.filter((w) => w.table === 'lead_followups' || JSON.stringify(w.body || '').includes('next_followup')).map((w) => w.method + ' ' + w.table);
  });
  await step('alerts list', async () => {
    await page.goBack();
    await tap(page, 'Alerts');
    await page.getByText(/New lead assigned/).waitFor({ timeout: 8000 });
    await shot(page, 'core-5-alerts');
  });
  await step('menu', async () => {
    await tap(page, 'Menu');
    await page.getByText('Sign out').waitFor({ timeout: 8000 });
    await shot(page, 'core-6-menu');
    out.menu = (await text(page)).slice(0, 400);
  });
  out.writeCount = mock.writes.length;
  return out;
}
