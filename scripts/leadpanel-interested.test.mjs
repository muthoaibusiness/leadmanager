// npm run test:interested — mounts the real LeadPanel.jsx under vite-node with
// the .gate-harness AppContext stub (the same alias the gate harness uses), so
// the Actions card is driven end to end. Fetch is stubbed: nothing here
// reaches a real database, and every changeStatus write stays in memory.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';

const w = new Window({ url: 'https://harness.invalid/' });
for (const k of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver',
  'MutationObserver', 'matchMedia', 'DOMRect', 'HTMLButtonElement', 'HTMLInputElement',
  'HTMLSelectElement', 'HTMLTextAreaElement', 'SVGElement', 'Text', 'DocumentFragment', 'localStorage']) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'window', { value: w, configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.alert = () => {};
globalThis.confirm = () => false;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const db = await import('../src/lib/db.js');
const LeadPanel = (await import('../src/components/LeadPanel.jsx')).default;
const { Ctx } = await import('../.gate-harness/appContextStub.jsx');
// Loaded up front: vite-node stops transforming once this file's top level has
// run, so a module first imported inside a test (the modal and its dropdowns)
// would fail to load.
await import('../src/components/modals/FollowUpModal.jsx');

const AGENT = { id: 'u1', name: 'Agent', role: 'AGENT', companyId: 'c1' };
const d = db.getDB();
const seed = (over = {}) => {
  d.users = [AGENT];
  d.leads = [{ id: 'L1', name: 'Client', status: 'CONTACTED', assignedTo: 'u1', companyId: 'c1', noAnswerCount: 0, callCount: 0, nextFollowup: null, ...over }];
  d.activities = {};
  d.companies = [{ id: 'c1' }];
  d.leads.forEach(l => { delete d.activities[l.id]; });
};

const flush = () => new Promise(r => setTimeout(r, 0));
const calls = [];

// Mount once; each test re-seeds and re-renders through the same root.
let container, root;
const mount = ({ user, modal = null } = {}) => {
  const value = {
    user, panLead: 'L1', setPanLead: () => {},
    openModal: (m) => {}, closeModal: () => {},
    refreshDB: () => {}, showToast: () => {},
    sidebarOpen: false, setChatTarget: () => {}, chatOk: false,
  };
  if (!container) {
    container = w.document.createElement('div');
    w.document.body.appendChild(container);
    root = createRoot(container);
  }
  const el = React.createElement(Ctx.Provider, { value }, React.createElement(LeadPanel));
  return () => act(() => root.render(el));
};

const btn = (label) => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(label));
// The purpose is a radix dropdown (ui/select.jsx): open it, choose Other, and
// return the text box Other opens, so a test can type unsaved text into it.
const pickPurpose = async (root, label) => {
  const trig = root.querySelector('.sel-trigger[aria-label="Purpose"]');
  await act(async () => { trig.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const opt = Array.from(w.document.querySelectorAll('[role="option"]')).find((o) => o.textContent.includes(label));
  await act(async () => { opt.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return root.querySelector('input[placeholder="Write the purpose"]');
};
const allBtns = () => Array.from(container.querySelectorAll('button')).map(b => ({ text: b.textContent.trim(), disabled: b.disabled }));

test('Interested is visible and enabled at NEW, CONTACTED and NOT_INTERESTED', async () => {
  for (const status of ['NEW', 'CONTACTED', 'NOT_INTERESTED']) {
    seed({ status });
    const render = mount({ user: AGENT });
    await render(); await flush();
    const b = btn('Interested');
    assert.ok(b, `Interested renders at ${status}`);
    assert.equal(b.disabled, false, `enabled at ${status}`);
  }
});

test('Interested is disabled at INTERESTED and every later stage', async () => {
  for (const status of ['INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST']) {
    seed({ status });
    const render = mount({ user: AGENT });
    await render(); await flush();
    const b = btn('Interested');
    assert.ok(b, `Interested still visible at ${status}`);
    assert.equal(b.disabled, true, `disabled at ${status}`);
  }
});

test('clicking Interested at CONTACTED runs changeStatus: status + STATUS_CHANGE row, counter reset', async () => {
  seed({ status: 'CONTACTED', noAnswerCount: 3, noAnswerLockUntil: '2026-01-01T00:00:00.000Z' });
  const render = mount({ user: AGENT });
  await render(); await flush();
  await act(async () => { btn('Interested').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush();
  const l = d.leads[0];
  assert.equal(l.status, 'INTERESTED');
  assert.equal(l.noAnswerCount, 0);
  assert.equal(l.noAnswerLockUntil, null);
  const acts = d.activities['L1'];
  assert.equal(acts.length, 1);
  assert.equal(acts[0].type, 'STATUS_CHANGE');
  assert.equal(acts[0].description, 'Status → Interested');
});

test('lock card keeps Interested visible but disabled (safeguard, not bypass)', async () => {
  // noAnswerLock() reads noAnswerLockUntil in the future with status NOT_CONTACTED.
  seed({ status: 'NOT_CONTACTED', noAnswerCount: 7, noAnswerLockUntil: new Date(Date.now() + 3600_000).toISOString() });
  const render = mount({ user: AGENT });
  await render(); await flush();
  const b = btn('Interested');
  assert.ok(b, 'Interested renders inside the lock card');
  assert.equal(b.disabled, true, 'disabled inside the lock');
});

test('supervisors keep their own action sections (no Interested injection)', async () => {
  const TL = { id: 'u2', name: 'Lead', role: 'TEAM_LEAD', companyId: 'c1' };
  seed({});
  d.users = [AGENT, TL];
  const render = mount({ user: TL });
  await render(); await flush();
  const interested = allBtns().filter(b => b.text === 'Interested');
  assert.ok(!interested.length, 'TL section does not render an Interested button');
});

test('FollowUpModal: Save schedules it with one FOLLOW_UP row carrying the purpose, and no NOTE row', async () => {
  seed({ status: 'INTERESTED' });
  d.leads[0].nextFollowup = null;
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const value = {
    user: AGENT, panLead: 'L1', setPanLead: () => {},
    modal: 'follow-up', openModal: () => {}, closeModal: () => {},
    refreshDB: () => {}, showToast: () => {},
    sidebarOpen: false, setChatTarget: () => {}, chatOk: false,
  };
  const render = () => act(() => root.render(React.createElement(Ctx.Provider, { value }, React.createElement(FollowUpModal))));
  await render(); await flush();
  assert.ok(!container.querySelector('textarea'), 'no note box');
  assert.ok(!Array.from(container.querySelectorAll('.fu2-lbl')).some(l => l.textContent.trim() === 'Project'), 'no project field');
  const box = await pickPurpose(container, 'Other');
  assert.ok(box, 'Other opens the purpose box');
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(box, 'Loan papers');
    box.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { btn('Save').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush(); await flush();
  const acts = d.activities['L1'] || [];
  assert.equal(acts.filter(a => a.type === 'NOTE').length, 0, 'no NOTE row');
  const fu = acts.filter(a => a.type === 'FOLLOW_UP');
  assert.equal(fu.length, 1, 'exactly one FOLLOW_UP row');
  assert.match(fu[0].description, /^Follow-up scheduled — Phone call · Loan papers · /);
  assert.ok(d.leads[0].nextFollowup, 'follow-up scheduled');
});

test('agent actions render in the required primary order on a NEW lead', async () => {
  seed({ status: 'NEW' });
  const render = mount({ user: AGENT });
  await render(); await flush();
  const texts = allBtns().map(b => b.text).filter(t => t.length);
  const idx = (s) => texts.findIndex(t => t.includes(s));
  for (const [a, b] of [['Connected','Interested'],['Interested','Not Interested'],['Not Interested','Attempt'],['Attempt','Forward to Agent'],['Forward to Agent','No Longer Responding'],['No Longer Responding','Follow-up'],['Follow-up','Log Call'],['Log Call','Add Note']]) {
    assert.ok(idx(a) >= 0 && idx(b) >= 0, `${a} and ${b} present`);
    assert.ok(idx(a) < idx(b), `${a} before ${b}`);
  }
  for (const absent of ['Set Meeting','Attend Meeting','Reschedule Meeting','Schedule Site Visit','Mark Visit as Done']) {
    assert.ok(!texts.some(t => t.includes(absent)), `${absent} hidden at NEW`);
  }
});

test('at INTERESTED, Set Meeting, Not Interested and Attempt precede Forward to Agent', async () => {
  seed({ status: 'INTERESTED' });
  const render = mount({ user: AGENT });
  await render(); await flush();
  const texts = allBtns().map(b => b.text).filter(t => t.length);
  const idx = (s) => texts.findIndex(t => t.includes(s));
  assert.ok(idx('Set Meeting') >= 0 && idx('Not Interested') >= 0 && idx('Attempt') >= 0 && idx('Forward to Agent') >= 0);
  assert.ok(idx('Set Meeting') < idx('Not Interested'));
  assert.ok(idx('Not Interested') < idx('Attempt'));
  assert.ok(idx('Attempt') < idx('Forward to Agent'));
  assert.ok(texts.some(t => t.includes('Follow-up')), 'Follow-up offered at INTERESTED (every status)');
});

test('Follow-up is offered at every status, to agents and supervisors; hidden only while follow-ups are stopped', async () => {
  const TL = { id: 'u2', name: 'Lead', role: 'TEAM_LEAD', companyId: 'c1' };
  const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'NOT_INTERESTED', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];
  for (const user of [AGENT, TL]) {
    for (const status of STATUSES) {
      seed({ status });
      d.users = [AGENT, TL];
      await mount({ user })(); await flush();
      assert.ok(allBtns().some(b => b.text === 'alarmFollow-up'), `Follow-up at ${status} for ${user.role}`);
    }
  }
  seed({ status: 'CONTACTED', followupSuppressedAt: '2026-11-01T00:00:00.000Z', followupSuppressedReason: 'NO_LONGER_RESPONDING' });
  await mount({ user: AGENT })(); await flush();
  assert.ok(!allBtns().some(b => b.text === 'alarmFollow-up'), 'hidden while follow-ups are stopped');
});

test('meeting/visit actions stay stage-gated (hidden when not applicable)', async () => {
  const cases = [
    ['CONTACTED', [], ['Attend Meeting','Reschedule Meeting','Schedule Site Visit','Mark Visit as Done']],
    ['MEETING_SET', ['Attend Meeting','Reschedule Meeting','Schedule Site Visit'], ['Mark Visit as Done']],
    ['SITE_VISIT_SCHEDULED', ['Mark Visit as Done'], ['Attend Meeting','Reschedule Meeting']],
  ];
  for (const [status, present, absent] of cases) {
    seed({ status });
    const render = mount({ user: AGENT });
    await render(); await flush();
    const texts = allBtns().map(b => b.text);
    for (const p of present) assert.ok(texts.some(t => t.includes(p)), `${p} present at ${status}`);
    for (const a of absent) assert.ok(!texts.some(t => t.includes(a)), `${a} hidden at ${status}`);
  }
});

test('Not Interested remains available through meeting and site-visit stages', async () => {
  for (const status of ['MEETING_SET','SITE_VISIT_SCHEDULED','SITE_VISIT_DONE']) {
    seed({ status });
    const render = mount({ user: AGENT });
    await render(); await flush();
    assert.ok(btn('Not Interested'), `Not Interested present at ${status}`);
  }
});

test('forward is one top-level action: no separate Team Lead or Myself buttons', async () => {
  seed({ status: 'SITE_VISIT_DONE', assignedTo: 'u1' });
  let render = mount({ user: AGENT });
  await render(); await flush();
  assert.ok(btn('Forward to Agent'), 'single forward entry present');
  assert.ok(!btn('Forward to Team Lead'), 'no separate Team Lead button');

  seed({ status: 'INTERESTED', assignedTo: 'u9' });
  render = mount({ user: { ...AGENT, allowedFeatures: ['self_forward'] } });
  await render(); await flush();
  assert.ok(btn('Forward to Agent'), 'single forward entry via self route');
  assert.ok(!btn('Forward to Myself'), 'no separate Myself button');
});

test('a closed lead is not forwardable', async () => {
  for (const status of ['DEAL_CLOSED_WON','DEAL_CLOSED_LOST','NEGOTIATING','NOT_INTERESTED']) {
    seed({ status });
    const render = mount({ user: AGENT });
    await render(); await flush();
    assert.ok(!btn('Forward to Agent'), `no forward at ${status}`);
  }
});

test('ForwardModal offers destinations per eligibility (team member / Team Lead / myself)', async () => {
  const ForwardModal = (await import('../src/components/modals/ForwardModal.jsx')).default;
  const mkValue = (user) => ({
    user, panLead: 'L1', setPanLead: () => {},
    modal: 'forward-agent', openModal: () => {}, closeModal: () => {},
    refreshDB: () => {}, showToast: () => {},
    sidebarOpen: false, setChatTarget: () => {}, chatOk: false,
  });
  const render = (value, key) => act(() => root.render(React.createElement(Ctx.Provider, { value }, React.createElement(ForwardModal, { key }))));

  // Owner at SITE_VISIT_DONE: team-member and Team Lead routes both apply.
  seed({ status: 'SITE_VISIT_DONE', assignedTo: 'u1' });
  await render(mkValue(AGENT), 'a'); await flush();
  let txt = container.textContent;
  assert.ok(txt.includes('Agent / team member'), 'team-member destination offered');
  assert.ok(txt.includes('Team Lead'), 'Team Lead destination offered');

  // Non-owner with the self_forward grant: only the Self Forward route applies.
  seed({ status: 'INTERESTED', assignedTo: 'u9' });
  await render(mkValue({ ...AGENT, allowedFeatures: ['self_forward'] }), 'b'); await flush();
  txt = container.textContent;
  assert.ok(txt.includes('Self Forward'), 'self-forward destination offered');
  assert.ok(!txt.includes('Team Lead'), 'no Team Lead option when not at visit-done');
  assert.ok(!txt.includes('Agent / team member'), 'no team-member option when not the owner');
  // The user's own account shows as the recipient row; clicking it then Forward
  // takes the lead.
  await act(async () => {
    const row = Array.from(container.querySelectorAll('button')).find(x => x.textContent.includes(AGENT.name));
    assert.ok(row, 'own-account row shown');
    row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    const fwd = Array.from(container.querySelectorAll('button')).find(x => x.textContent.includes('Forward') && !x.textContent.includes('Self Forward'));
    assert.ok(fwd, 'Forward action present');
    fwd.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  assert.equal(d.leads[0].assignedTo, 'u1', 'claimed for self on submit');
});

test('FollowUpModal renders separate Date and Time inputs, not one datetime-local', async () => {
  seed({ status: 'INTERESTED' });
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const value = {
    user: AGENT, panLead: 'L1', setPanLead: () => {},
    modal: 'follow-up', openModal: () => {}, closeModal: () => {},
    refreshDB: () => {}, showToast: () => {},
    sidebarOpen: false, setChatTarget: () => {}, chatOk: false,
  };
  const render = () => act(() => root.render(React.createElement(Ctx.Provider, { value }, React.createElement(FollowUpModal))));
  await render(); await flush();
  assert.ok(container.querySelector('input[type="date"]'), 'date input renders');
  assert.ok(container.querySelector('input[type="time"]'), 'time input renders');
  assert.ok(!container.querySelector('input[type="datetime-local"]'), 'no datetime-local input');
  assert.ok(!container.textContent.includes('Today 5 PM'), 'presets removed');
});

test('FollowUpModal stays minimal: type, date, time, reminder, purpose; no notes or project', async () => {
  seed({ status: 'INTERESTED' });
  d.activities['L1'] = [{ id: 'a0', type: 'NOTE', description: 'Shared note', userId: 'u1', userName: 'Agent', companyId: 'c1', timestamp: '2026-10-28T09:00:00.000Z', durationSeconds: 0 }];
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const value = {
    user: AGENT, panLead: 'L1', setPanLead: () => {},
    modal: 'follow-up', openModal: () => {}, closeModal: () => {},
    refreshDB: () => {}, showToast: () => {},
    sidebarOpen: false, setChatTarget: () => {}, chatOk: false,
  };
  await act(() => root.render(React.createElement(Ctx.Provider, { value }, React.createElement(FollowUpModal))));
  await flush();
  const labels = Array.from(container.querySelectorAll('.fu2-lbl')).map(l => l.textContent.trim());
  assert.deepEqual(labels, ['Type', 'Date', 'Time', 'Reminder', 'Purpose'], 'exactly these fields, no time zone in the labels');
  assert.equal(container.querySelectorAll('.sel-trigger').length, 2, 'only Reminder and Purpose dropdowns');
  assert.ok(!container.textContent.includes('Shared note'), 'no shared notes in the form');
  assert.ok(!container.querySelector('textarea'), 'no note box');
});

test('changeStatus to INTERESTED pushes one cloud POST and one PATCH (no duplicates)', async () => {
  seed({ status: 'CONTACTED' });
  const render = mount({ user: AGENT });
  await render(); await flush();
  calls.length = 0;
  await act(async () => { btn('Interested').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush();
  const posts = calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/activities'));
  const patches = calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/leads'));
  assert.equal(posts.length, 1, 'one STATUS_CHANGE activity row');
  assert.equal(patches.length, 1, 'one lead PATCH');
});
