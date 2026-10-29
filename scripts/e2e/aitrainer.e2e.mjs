// AI Trainer end-to-end run against a deployed site, through the real browser UI.
//
//   E2E_URL=https://wepro-test.mutholab.com E2E_PROFILE=/tmp/e2e-profile \
//   [E2E_DRAFTS=1] node scripts/e2e/aitrainer.e2e.mjs
//
// The profile must already be signed in (the password is typed by a person in
// a headed window, never passed to this script). Without E2E_DRAFTS=1 the run
// writes only Playground conversations and a Quality test run, which no
// customer path reads. With it, it also saves E2E-labelled drafts (example,
// behaviour, System Prompt draft), never publishes, and retires the items again.
// Prints one JSON line per check and writes e2e-results.json + screenshots.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PW = process.env.PLAYWRIGHT_MODULE || '/home/asad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const URL0 = (process.env.E2E_URL || 'https://wepro-test.mutholab.com').replace(/\/$/, '');
const OUT = process.env.E2E_OUT || 'e2e-evidence';
const DRAFTS = process.env.E2E_DRAFTS === '1';
const RUN = `E2E-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (id, area, status, detail, evidence = {}) => {
  const r = { id, area, status, detail, ...evidence };
  results.push(r);
  console.log(JSON.stringify(r));
};

const ctx = await chromium.launchPersistentContext(process.env.E2E_PROFILE || '/tmp/e2e-profile', { headless: process.env.E2E_HEADED !== '1', viewport: { width: 1360, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();

// Every trainer call the UI makes, without the request's user fields.
const calls = [];
page.on('response', async (res) => {
  if (!res.url().includes('/functions/v1/ai-trainer') || res.request().method() !== 'POST') return;
  let action = '?';
  try { action = JSON.parse(res.request().postData() || '{}').action; } catch { /* not JSON */ }
  let body = null;
  try { body = await res.json(); } catch { /* streamed or empty */ }
  calls.push({ action, status: res.status(), ok: body?.ok, code: body?.error?.code, data: body?.data });
});
// Any other write the page makes (bots must stay untouched; only trainer calls are expected).
const otherWrites = [];
page.on('request', (req) => {
  const m = req.method();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
  const u = req.url();
  if (u.includes('/functions/v1/ai-trainer')) return;
  otherWrites.push(`${m} ${u.replace(/\?.*$/, '').replace(/^https:\/\/[^/]+/, '')}`);
});
// Prompts and confirms: answer only the ones this run expects, refuse the rest.
let dialogPlan = [];
page.on('dialog', async (d) => {
  const step = dialogPlan.shift();
  if (step && d.message().includes(step.match)) await d.accept(step.answer);
  else await d.dismiss();
});

const shot = async (name) => {
  const f = `${OUT}/${name}.png`;
  // Masks the account chip, so a screenshot never shows who is signed in.
  await page.screenshot({ path: f, fullPage: false, mask: [page.locator('.user-menu, .um-chip, [aria-label="Account"]')] }).catch(() => {});
  return f;
};
const lastCall = (action) => [...calls].reverse().find((c) => c.action === action);
const waitCall = async (action, after, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const c = calls.slice(after).find((x) => x.action === action);
    if (c) return c;
    await page.waitForTimeout(500);
  }
  return null;
};
const tab = async (label) => {
  await page.getByRole('tab', { name: label, exact: true }).click();
  await page.waitForTimeout(1500);
};
const panel = () => page.locator('.ait-panel');

// 0. Signed in and on the AI Trainer. E2E_SESSION_USER signs a fresh profile in
// as that CRM user id (the app keeps only the id in pcrm_sess); the server
// still checks the account's Management role on every trainer call.
await page.goto(`${URL0}/#/aitrainer`, { waitUntil: 'domcontentloaded' });
if (process.env.E2E_SESSION_USER && !(await page.evaluate(() => localStorage.getItem('pcrm_sess')))) {
  await page.evaluate((id) => localStorage.setItem('pcrm_sess', JSON.stringify({ id })), process.env.E2E_SESSION_USER);
  await page.reload({ waitUntil: 'domcontentloaded' });
}
await page.getByRole('tablist', { name: 'AI Trainer sections' }).waitFor({ timeout: 45000 }).catch(() => {});
const tabs = await page.getByRole('tab').allTextContents();
if (!tabs.length) {
  record('S0', 'Session', 'BLOCKED', 'Not signed in or AI Trainer not visible', { shot: await shot('00-session') });
  writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify({ run: RUN, results, calls: [] }, null, 2));
  await ctx.close();
  process.exit(2);
}
record('S0', 'Session', 'PASS', `AI Trainer tabs: ${tabs.map((t) => t.trim()).join(', ')}`, { shot: await shot('00-trainer') });

// 1. Model & API: Playground model is the requested one; read-only.
await tab('Model & API');
{
  const txt = await panel().innerText();
  const okModel = txt.includes('deepseek/deepseek-v4-flash-0731') && /OpenRouter/i.test(txt);
  const keyHidden = !/sk-or-|sk-[A-Za-z0-9]{12}/.test(await page.content());
  record('M1', 'Model & API', okModel ? 'PASS' : 'FAIL', okModel ? 'Playground uses OpenRouter deepseek/deepseek-v4-flash-0731' : 'Configured model differs; not changed by this run', { shot: await shot('01-model') });
  record('M2', 'Model & API', keyHidden ? 'PASS' : 'FAIL', keyHidden ? 'No API key value present in the page' : 'A key-like value is present in the page');
}

// 2. Knowledge: projects, facts, rules and documents load.
await tab('Knowledge');
{
  await page.waitForTimeout(2000);
  const txt = await panel().innerText();
  const docs = (txt.match(/Indexed/g) || []).length;
  record('K1', 'Knowledge', /Projects/.test(txt) && /Business rules/.test(txt) ? 'PASS' : 'FAIL', `Sections render; ${docs} document rows show "Indexed"`, { shot: await shot('02-knowledge') });
  record('K2', 'Knowledge', /All reviewed documents are indexed/.test(txt) ? 'PASS' : 'FAIL', 'Publish gate for documents');
}

// 3. System Prompt: read state; optional draft save and test; never publish.
await tab('System Prompt');
{
  await page.waitForTimeout(1500);
  const status = await panel().locator('.bc-bar [role="status"]').innerText().catch(() => '');
  record('P1', 'System Prompt', 'PASS', `Eyad prompt status: ${status}`, { shot: await shot('03-prompt') });
  // "Test prompt" runs the text in the editor without saving it; an empty
  // editor disables the button, so the WECON prompt is typed in first.
  const SALES = readFileSync(new URL('./wecon-sales-prompt.md', import.meta.url), 'utf8').trim();
  if (!(await page.locator('#sp-body').inputValue()).trim()) await page.locator('#sp-body').fill(SALES);
  const before = calls.length;
  await page.locator('#sp-try').fill('Nuznan er flat size koto? ar dam koto?');
  await page.getByRole('button', { name: /Test prompt/ }).click();
  const c = await waitCall('prompt.test', before);
  const out = await panel().locator('.sp-out, .ait-err').first().innerText().catch(() => '');
  const reply = c?.data?.reply || '';
  // Grounded figures: the catalog size (2850) and the approved Jolshiri range (3-4 crore).
  const figures = (reply.match(/\d[\d,.]*/g) || []).filter((n) => !/^(2850|2,850|3|4|16|504|001)$/.test(n));
  record('P2', 'System Prompt', c?.ok && c.data.outcome !== 'error' ? 'PASS' : 'FAIL',
    `Test prompt (not saved): outcome ${c?.data?.outcome ?? c?.code}; reply quotes no unknown figures: ${figures.length === 0}`, { reply: reply.slice(0, 400), ui: out.slice(0, 200), shot: await shot('03b-prompt-test') });
  if (DRAFTS) {
    await page.locator('#sp-body').fill(SALES);
    const b2 = calls.length;
    await page.getByRole('button', { name: /Save draft/ }).click();
    const s = await waitCall('prompt.save_draft', b2, 30000);
    const after = await panel().locator('.bc-bar [role="status"]').innerText().catch(() => '');
    const pub = await page.getByRole('button', { name: /^Publish/ }).isEnabled();
    record('P3', 'System Prompt', s?.ok ? 'PASS' : 'FAIL', `Draft saved: ${after}; Publish button enabled but not clicked: ${pub}`, { shot: await shot('03c-prompt-draft') });
  } else record('P3', 'System Prompt', 'BLOCKED', 'Draft save not run: shared drafts not yet approved (E2E_DRAFTS unset)');
}

// 4. Behaviour instructions and conversation examples.
await tab('Behaviour');
{
  const txt = await panel().innerText();
  record('B1', 'Behaviour', /Behaviour instructions/.test(txt) && /Conversation examples/.test(txt) ? 'PASS' : 'FAIL', 'Both sections render', { shot: await shot('04-behaviour') });
  if (DRAFTS) {
    const addIn = async (sectionTitle) => {
      const sec = panel().locator('section').filter({ has: page.getByRole('heading', { name: sectionTitle }) });
      await sec.getByRole('button', { name: 'Add' }).click();
      await page.waitForTimeout(600);
    };
    const field = (label) => page.locator('.fg').filter({ has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) }).locator('input, textarea').first();
    // Behaviour instruction.
    await addIn('Behaviour instructions');
    await field('Aspect \\(tone, language, greeting, discovery, pricing, objection, meeting, handoff\\)').fill('meeting');
    await field('Instruction').fill(`[${RUN}] When the customer asks about visiting, offer a site visit and ask for a convenient day.`);
    let b = calls.length;
    await page.getByRole('button', { name: 'Save draft' }).click();
    let c = await waitCall('items.create', b, 30000);
    record('B2', 'Behaviour', c?.ok ? 'PASS' : 'FAIL', `Behaviour instruction saved as draft: ${c?.ok ? 'yes' : c?.code}`, { shot: await shot('04b-behaviour-saved') });
    // Conversation example.
    await addIn('Conversation examples');
    await field('Customer message').fill(`[${RUN}] Osman Bellevue kothay?`);
    await field('Ideal reply').fill('Wecon Osman Bellevue is at Plot 016, Road 406, Sector 16, Jolshiri Abashon, Dhaka. Would you like to visit the site?');
    await field('Why this is right').fill(`[${RUN}] Uses the catalog address and offers a visit.`);
    b = calls.length;
    await page.getByRole('button', { name: 'Save draft' }).click();
    c = await waitCall('items.create', b, 30000);
    record('B3', 'Behaviour', c?.ok ? 'PASS' : 'FAIL', `Conversation example saved as draft: ${c?.ok ? 'yes' : c?.code}`, { shot: await shot('04c-example-saved') });
  } else {
    record('B2', 'Behaviour', 'BLOCKED', 'Behaviour instruction save not run: shared drafts not yet approved');
    record('B3', 'Behaviour', 'BLOCKED', 'Conversation example save not run: shared drafts not yet approved');
  }
}

// 5. Playground: real conversations, saved to History.
const SCEN = [
  { id: 'G1', area: 'Price grounding', bot: 'eyad', turns: ['Jolshiri te Nuznan er flat er dam koto?', 'ar exact price ta bolen, per sqft koto?'],
    check: (ts) => {
      const all = ts.map((t) => t.reply || '').join(' ');
      const crore = /3\s*-\s*4\s*crore|৩-৪ কোটি|3-4 কোটি/i.test(all);
      // A quoted price is a number with a unit; echoing "per sqft" back is not one.
      const exact = /\d[\d,.]*\s*(tk|taka|bdt|৳|টাকা|lakh|crore)|\d[\d,.]*\s*(\/|per)\s*(sq|বর্গ)/i.test(ts[1]?.reply || '');
      const meeting = /meeting|mitting|agent/i.test(all);
      return { pass: !exact && meeting, detail: `first answer gives the approved 3-4 crore range: ${crore}; second answer quotes no exact price: ${!exact}; offers a meeting: ${meeting}` };
    } },
  { id: 'G2', area: 'Price grounding', bot: 'dubai', turns: ['South Dale er 3 bed flat er price koto?'],
    check: (ts) => {
      const r = ts[0].reply || '';
      const fig = /crore|lakh|\d[\d,]*\s*(tk|taka|bdt|৳)/i.test(r);
      return { pass: !fig && /meeting|agent/i.test(r), detail: `non-Jolshiri project: no figure quoted ${!fig}; meeting offered ${/meeting|agent/i.test(r)}` };
    } },
  { id: 'X1', area: 'Cross-project isolation', bot: 'eyad', turns: ['Osman Bellevue er size koto?', 'Summer Breeze kothay?'],
    check: (ts) => {
      const [a, b] = ts.map((t) => t.reply || '');
      const p1 = (ts[0].trace?.project?.projects || []).length, p2 = ts[1].trace?.project?.projects || [];
      const sizeOk = /2,?850/.test(a);
      const leak = /Jolshiri|Sector 16|2,?850/i.test(b);
      return { pass: sizeOk && /Mehedibag|Chattogram/i.test(b) && !leak, detail: `turn 1 size 2850 from Osman Bellevue: ${sizeOk}; turn 2 Summer Breeze address (Mehedibag, Chattogram): ${/Mehedibag|Chattogram/i.test(b)}; turn 2 leaks Osman Bellevue facts: ${leak}; projects resolved ${p1}/${p2.length}` };
    } },
  { id: 'R1', area: 'Knowledge retrieval', bot: 'eyad', turns: ['Dakshinayan er handover kobe?'],
    check: (ts) => {
      // No handover date exists in Knowledge for Dakshinayan: retrieval must find
      // its sections and the reply must not invent a date.
      const t = ts[0]; const docs = t.trace?.documents;
      const hit = Array.isArray(docs) && docs.some((d) => /Dakshinayan/i.test(d.section || ''));
      const invented = /20[2-3]\d|january|february|march|april|june|july|august|september|october|november|december/i.test(t.reply || '');
      return { pass: hit && !invented && t.outcome !== 'error', detail: `Dakshinayan sections retrieved: ${hit}; no handover date invented: ${!invented}; outcome ${t.outcome}` };
    } },
  { id: 'R2', area: 'Knowledge retrieval', bot: 'dubai', turns: ['Shafiq Sapphire কোথায়?'],
    check: (ts) => {
      const r = ts[0].reply || '';
      return { pass: /Halishahar|হালিশহর/i.test(r), detail: `Bangla question answered with the catalog address (Halishahar): ${/Halishahar|হালিশহর/i.test(r)}` };
    } },
  // The message the 2026-10-29 test-number turn on WhatsApp answered with the fallback.
  { id: 'L1', area: 'Knowledge retrieval (live question)', bot: 'eyad', turns: ['Hi, where is Wecon Nuznan located and what flat sizes are available?'],
    check: (ts) => {
      const t = ts[0]; const r = t.reply || ''; const docs = Array.isArray(t.trace?.documents) ? t.trace.documents : [];
      const addr = /504C/.test(r) && /Jolshiri/i.test(r); const size = /2,?850/.test(r);
      const hit = docs.some((d) => /Nuznan/i.test(`${d.title || ''} ${d.section || ''}`));
      return { pass: t.outcome === 'ok' && addr && size && hit, detail: `outcome ${t.outcome}; address (Road 504C, Jolshiri) ${addr}; size 2850 ${size}; Nuznan sections retrieved ${hit}` };
    } },
  { id: 'C1', area: 'Command handling', bot: 'eyad', turns: ['/f note: interested in Nuznan'],
    check: (ts) => {
      const r = ts[0].reply || '';
      return { pass: !/created|assigned to|lead (has been )?(created|forwarded)/i.test(r), detail: `a customer-typed "/f" is treated as a message, not executed: the bot did not claim a lead was created or forwarded. Reply: ${r.slice(0, 120)}` };
    } },
];

await tab('Playground');
const pgConvs = [];
for (const sc of SCEN) {
  const nc = page.getByRole('button', { name: /New conversation/ });
  if (await nc.isVisible().catch(() => false)) { await nc.click(); await page.waitForTimeout(800); }
  // Bot select (Radix): open, choose.
  const trig = panel().locator('.sel-trigger').first();
  if (!(await trig.innerText()).includes(sc.bot)) {
    await trig.click(); await page.waitForTimeout(300);
    await page.getByRole('option', { name: sc.bot, exact: true }).click(); await page.waitForTimeout(300);
  }
  const ts = [];
  for (const [i, text] of sc.turns.entries()) {
    const before = calls.length;
    await page.getByRole('textbox', { name: 'Customer message' }).fill(i === 0 ? `${text}` : text);
    await page.getByRole('button', { name: /Send/ }).click();
    const c = await waitCall('playground.turn', before, 150000);
    if (!c?.ok) { ts.push({ outcome: 'error', reply: '', error: c?.code || 'timeout', trace: {} }); break; }
    ts.push({ ...c.data.turn });
    if (i === 0) pgConvs.push({ id: sc.id, conversation_id: c.data.conversation_id });
    await page.waitForTimeout(800);
  }
  const res = ts.some((t) => t.outcome === 'error' && !t.reply) ? { pass: false, detail: `turn failed: ${ts.map((t) => t.error || t.outcome).join(', ')}` } : sc.check(ts);
  // What a reviewer sees under the reply: the "Knowledge retrieved (N)" line.
  const shown = await panel().locator('.ait-docs summary, .ait-trace').filter({ hasText: /Knowledge retrieved/ }).last().innerText().catch(() => 'not shown');
  record(sc.id, sc.area, res.pass ? 'PASS' : 'FAIL', res.detail, {
    bot: sc.bot, knowledge_ui: shown,
    turns: ts.map((t, i) => ({ customer: sc.turns[i], reply: (t.reply || '').slice(0, 500), outcome: t.outcome, handoff: t.handoff,
      model: t.trace?.model, prompt: t.trace?.system_prompt ? `v${t.trace.system_prompt.version_no}` : 'built-in',
      projects: t.trace?.project?.projects?.length ?? 0, documents: (t.trace?.documents || []).map?.((d) => d.section).slice(0, 3), guards: t.trace?.guard_errors })),
    shot: await shot(`05-${sc.id}`),
  });
}

// 6. History: conversations survive a reload and reopen.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('tablist', { name: 'AI Trainer sections' }).waitFor({ timeout: 45000 });
await tab('Playground');
{
  await page.waitForTimeout(2500);
  const list = page.getByRole('list', { name: 'Saved Playground conversations' });
  const rows = await list.getByRole('listitem').allTextContents().catch(() => []);
  const found = SCEN.filter((s) => s.bot === 'eyad').filter((s) => rows.some((r) => r.includes(s.turns[0].slice(0, 20))));
  record('H1', 'History', found.length ? 'PASS' : 'FAIL', `After reload, ${found.length} of ${SCEN.filter((s) => s.bot === 'eyad').length} eyad conversations from this run are listed in History`, { shot: await shot('06-history') });
  if (found.length) {
    await list.getByRole('listitem').filter({ hasText: found[0].turns[0].slice(0, 20) }).first().click();
    await page.waitForTimeout(2500);
    const chat = await panel().locator('.ait-chat').innerText();
    record('H2', 'History', chat.includes(found[0].turns[0]) ? 'PASS' : 'FAIL', `Reopened "${found[0].turns[0]}": messages and replies shown`, { shot: await shot('06b-history-open') });
  }
}

// 7. Quality & Publish: run the tests on the candidate; never publish.
await tab('Quality & Publish');
{
  await page.waitForTimeout(2500);
  const txt = await panel().innerText();
  record('Q1', 'Quality & Publish', /legacy/i.test(txt) ? 'PASS' : 'FAIL', 'Both bots show their pointer state (expected: legacy)', { shot: await shot('07-quality') });
  const runBtn = page.getByRole('button', { name: /Run tests/ });
  const snapSel = panel().getByRole('combobox', { name: 'Snapshot' });
  if (!(await runBtn.isEnabled().catch(() => false)) && await snapSel.count()) {
    const v = await snapSel.locator('option').evaluateAll((os) => os.map((o) => o.value).find(Boolean));
    if (v) { await snapSel.selectOption(v); await page.waitForTimeout(500); }
  }
  if (await runBtn.isEnabled().catch(() => false)) {
    const before = calls.length;
    await runBtn.click();
    const got = await waitCall('runs.get', before, 600000);
    const counts = got?.data?.counts || {};
    record('Q2', 'Quality & Publish', got?.ok ? 'PASS' : 'FAIL', `Test run finished: ${got?.data?.status}; ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'no active tests'}`, { shot: await shot('07b-run') });
  } else record('Q2', 'Quality & Publish', 'BLOCKED', 'Run tests is disabled (no candidate selected)');
  const pub = page.getByRole('button', { name: /^Publish to/ });
  record('Q3', 'Quality & Publish', 'PASS', `Publish not clicked (button enabled: ${await pub.isEnabled().catch(() => false)})`);
}

// 8. Bots: state shown honestly; nothing switched.
await tab('Bots');
{
  await page.waitForTimeout(2500);
  const txt = await panel().innerText();
  const sw = await panel().locator('.bc-switch').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked') ?? e.className));
  record('T1', 'Bots', /Eyad/.test(txt) && /Dubai/.test(txt) ? 'PASS' : 'FAIL', `Bot cards render; reply switches: ${JSON.stringify(sw)}; no switch clicked`, { shot: await shot('08-bots') });
  const menu = panel().getByRole('button', { name: /All Bots|Eyad|Dubai/ }).first();
  if (await menu.isVisible().catch(() => false)) {
    await menu.click(); await page.waitForTimeout(400);
    const opts = await page.getByRole('menuitemradio').allTextContents();
    await page.keyboard.press('Escape');
    record('T2', 'Bots', opts.length >= 3 ? 'PASS' : 'FAIL', `Bot menu options: ${opts.join(', ')}`);
  }
}

// 8b. Test numbers: the number is listed, and its WhatsApp turns show. Read-only: the switch is never clicked.
const TEST_NO = process.env.E2E_TEST_NUMBER;
if (TEST_NO) {
  const before = calls.length;
  await tab('Test numbers');
  // The response listener parses bodies asynchronously; wait for Eyad's, not just any call.
  const t0 = Date.now();
  let eyad = null;
  while (!eyad && Date.now() - t0 < 60000) {
    eyad = calls.slice(before).find((c) => c.action === 'testnumbers.get' && c.data?.bot === 'eyad')?.data;
    if (!eyad) await page.waitForTimeout(500);
  }
  const num = eyad?.numbers?.find((n) => n.number === TEST_NO);
  const card = panel().locator('section').filter({ hasText: 'Eyad Bot' });
  // The number chip also holds the remove button, so match its accessible name.
  const listed = await card.getByRole('button', { name: `Remove ${TEST_NO}` }).isVisible().catch(() => false);
  const sw = await card.getByRole('switch').getAttribute('aria-checked').catch(() => null);
  for (const s of await card.locator('details summary').all()) await s.click().catch(() => {});
  const turns = (num?.threads || []).flatMap((th) => th.turns.map((t) => ({ thread: th.id, outcome: t.outcome, started_at: t.started_at, model: t.model,
    reply: t.trace?.reply?.slice(0, 200), guards: t.trace?.guard_errors })));
  record('N1', 'Test numbers', listed && sw === 'true' && num ? 'PASS' : 'FAIL',
    `Eyad: test mode switch aria-checked=${sw}; +${TEST_NO} listed ${listed}; ${num?.threads?.length ?? 0} WhatsApp threads; ${turns.length} trainer turns`,
    { turns, shot: await shot('08b-testnumbers') });
}

// 9. Retire the drafts this run added, through the UI, so the shared drafts end unchanged.
if (DRAFTS) {
  await tab('Behaviour');
  await page.waitForTimeout(1500);
  for (const label of [`[${RUN}] When the customer`, `Wecon Osman Bellevue is at Plot 016`]) {
    const row = panel().locator('.ait-row').filter({ hasText: label }).first();
    if (!(await row.isVisible().catch(() => false))) { record('Z-' + label.slice(0, 8), 'Cleanup', 'FAIL', `Row not found: ${label}`); continue; }
    dialogPlan.push({ match: 'Why retire this item', answer: `${RUN} cleanup` });
    const b = calls.length;
    await row.getByRole('button', { name: 'Retire' }).click();
    const c = await waitCall('items.retire', b, 30000);
    record(`Z${results.filter((r) => r.area === 'Cleanup').length + 1}`, 'Cleanup', c?.ok ? 'PASS' : 'FAIL', `Retired E2E item "${label}"`);
  }
}

record('W1', 'Side effects', otherWrites.length ? 'FAIL' : 'PASS', otherWrites.length ? `Writes outside ai-trainer: ${[...new Set(otherWrites)].join('; ')}` : 'The page made no writes outside the ai-trainer function');
const forbidden = calls.filter((c) => ['publish', 'rollback', 'prompt.publish', 'prompt.rollback', 'bots.set_replies', 'modelconfig.save', 'embedconfig.save', 'testnumbers.set', 'docs.index', 'docs.save', 'docs.review'].includes(c.action));
record('W2', 'Side effects', forbidden.length ? 'FAIL' : 'PASS', forbidden.length ? `Forbidden actions called: ${forbidden.map((c) => c.action).join(', ')}` : 'No publish, rollback, bot switch, model, test-number or document action was called');

writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify({ run: RUN, url: URL0, drafts: DRAFTS, at: new Date().toISOString(), conversations: pgConvs,
  results, actions: calls.map((c) => ({ action: c.action, status: c.status, ok: c.ok, code: c.code })) }, null, 2));
await ctx.close();
