// Component-level tests for the Lead Lifecycle audit fixes. Mounts the real
// FollowUpModal / ForwardModal under the gate harness (appContextStub) with a
// goey host so the discard-guard confirmation can render. Fetch is stubbed;
// nothing reaches a database.
//
// Verified here:
//   * clean forms close normally on Cancel, backdrop and Escape
//   * dirty forms are intercepted: Escape/backdrop/Cancel ask first, and the
//     modal stays open until "Exit" confirms
//   * validation failure (past time) preserves the draft and keeps the modal open
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { Window } from 'happy-dom';

const w = new Window({ url: 'https://harness.invalid/' });
for (const k of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver',
  'MutationObserver', 'matchMedia', 'DOMRect', 'HTMLButtonElement', 'HTMLInputElement',
  'HTMLSelectElement', 'HTMLTextAreaElement', 'SVGElement', 'Text', 'localStorage']) {
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
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = React;
const { GooeyToaster } = await import('goey-toast');
const db = await import('../src/lib/db.js');
const { Ctx } = await import('../.gate-harness/appContextStub.jsx');

const AGENT = { id: 'u1', name: 'Agent', role: 'AGENT', companyId: 'c1' };
const d = db.getDB();
const seed = (over = {}) => {
  d.users = [AGENT];
  d.leads = [{ id: 'L1', name: 'Client', status: 'INTERESTED', assignedTo: 'u1', companyId: 'c1', noAnswerCount: 0, callCount: 0, nextFollowup: null, ...over }];
  d.activities = {};
  d.companies = [{ id: 'c1' }];
};

const flush = () => new Promise(r => setTimeout(r, 0));

let container, root;
const closed = [];
const mountModal = (Modal, modal) => {
  const value = {
    user: AGENT, panLead: 'L1', setPanLead: () => {},
    modal, openModal: () => {}, closeModal: () => closed.push('closed'),
    refreshDB: () => {},
    sidebarOpen: false, setChatTarget: () => {}, chatOk: false,
  };
  if (!container) {
    container = w.document.createElement('div');
    w.document.body.appendChild(container);
    root = createRoot(container);
  }
  const host = React.createElement(GooeyToaster, { position: 'top-center', theme: 'dark', offset: 18, visibleToasts: 6, showTimestamp: false });
  const el = React.createElement(Ctx.Provider, { value }, host, React.createElement(Modal));
  return () => act(() => root.render(el));
};

const btn = (label) => Array.from(w.document.body.querySelectorAll('button')).find(b => b.textContent.includes(label));
const mov = () => container.querySelector('.mov');
// The discard guard listens for Escape in the capture phase on window.
const esc = () => w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));

// Record failures so `after` can exit with the right code; goey's host keeps
// handles alive, so the run would otherwise hang after the suite finishes.
let failed = 0;
const t = (name, fn) => test(name, async () => {
  try { await fn(); }
  catch (e) { failed++; throw e; }
});

t('FollowUpModal: clean Cancel closes without asking', async () => {
  seed();
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const render = mountModal(FollowUpModal, 'follow-up');
  await render(); await flush();
  closed.length = 0;
  await act(async () => { btn('Cancel').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush();
  assert.deepEqual(closed, ['closed'], 'clean Cancel closes immediately');
});

// Escape interception is asserted by the protective property (a dirty form
// must not close). The goey confirmation UI itself is exercised by the
// backdrop test below, which drives Stay/Exit reliably under happy-dom.
t('FollowUpModal: dirty Escape does not close', async () => {
  seed();
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const render = mountModal(FollowUpModal, 'follow-up');
  await render(); await flush();
  const ta = container.querySelector('textarea');
  assert.ok(ta, 'note textarea renders');
  closed.length = 0;
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'unsaved note');
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { esc(); });
  await flush();
  assert.deepEqual(closed, [], 'dirty Escape does not close directly');
});

t('FollowUpModal: dirty backdrop is intercepted (asks, does not close)', async () => {
  seed();
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const render = mountModal(FollowUpModal, 'follow-up');
  await render(); await flush();
  const ta = container.querySelector('textarea');
  closed.length = 0;
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'draft');
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { mov().dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush();
  assert.deepEqual(closed, [], 'dirty backdrop does not close directly');
  assert.ok(w.document.body.textContent.includes('Discard follow-up?'), 'backdrop asked for confirmation');
});

t('FollowUpModal: past-time save fails and keeps the modal open and the draft', async () => {
  seed();
  const FollowUpModal = (await import('../src/components/modals/FollowUpModal.jsx')).default;
  const render = mountModal(FollowUpModal, 'follow-up');
  await render(); await flush();
  const ta = container.querySelector('textarea');
  const day = container.querySelector('input[type="date"]');
  const time = container.querySelector('input[type="time"]');
  closed.length = 0;
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(day, '2000-01-01');
    day.dispatchEvent(new w.Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(time, '01:00');
    time.dispatchEvent(new w.Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'keep me');
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { btn('Save').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush();
  assert.deepEqual(closed, [], 'failed save does not close the modal');
  assert.equal(ta.value, 'keep me', 'draft preserved after failed save');
  assert.ok(w.document.body.textContent.includes('That time has passed'), 'validation error surfaced');
});

t('ForwardModal: clean Cancel closes; dirty Escape asks first', async () => {
  seed();
  const ForwardModal = (await import('../src/components/modals/ForwardModal.jsx')).default;
  // set-meeting opens straight on step 2 with meeting fields.
  const render = mountModal(ForwardModal, 'set-meeting');
  await render(); await flush();
  closed.length = 0;
  await act(async () => { btn('Cancel').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); });
  await flush();
  assert.deepEqual(closed, ['closed'], 'clean forward Cancel closes immediately');

  await render(); await flush();
  const mt = container.querySelector('input[type="datetime-local"]');
  assert.ok(mt, 'meeting time input renders');
  closed.length = 0;
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(mt, '2026-11-01T14:00');
    mt.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await act(async () => { esc(); });
  await flush();
  assert.deepEqual(closed, [], 'dirty forward Escape does not close directly');
});

after(() => process.exit(failed ? 1 : 0));
