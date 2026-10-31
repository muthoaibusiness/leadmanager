import { useEffect, useLayoutEffect, useRef } from 'react';
import { HISTORY_MARK, DEFAULT_SNAP, pageKey, toHash, parseHash, pageLabel, parentOf, trailOf } from '../lib/navHistory.js';

// Mirrors AppContext's page state into window.history. One history entry per
// PAGE (view, the Projects sub-page, a drill-down): moving to another page
// pushes an entry, while tabs, filters, search and the state views keep with
// useNavState only update the current one. Back/Forward restore an entry's
// page with all of that. An open overlay (modal, lead panel, notifications, the
// phone drawer) gets a guard entry above its page, so Back closes it the way
// Esc does — through each form's own discard check — instead of leaving the page.
//
// One app, one history: the state lives in this module. It is read during
// render (which entry this render belongs to) and written by the effects and
// listeners below, never by React state, so it never costs a render.

const FLUSH_MS = 300; // filter edits batch into one replaceState (Safari rate-limits them)
let seq = 0;
const newId = () => `${Date.now().toString(36)}.${(seq++).toString(36)}`;

const nav = {
  entry: null,        // the page on screen: { id, idx, key, snap, local, scroll, prev, pending, from }
  replaceNext: false, // the next page change replaces this entry instead of pushing one
  guard: false,       // the browser sits on the overlay guard entry above the page
  expectPop: 0,       // popstates our own history.back() is about to fire
  expectAt: 0,
  timer: 0,
  sig: '',            // the snapshot last written, to spot filter changes
  uid: null,          // the account the entries are being written for
  scrollTo: null,     // scroll position to put back once a restored page renders
  live: null,         // the latest committed render's inputs, for listeners and timers
};

function write(method, e, guard = false) {
  const uid = nav.live?.uid;
  if (!uid || !e) return;
  try {
    window.history[method](
      { [HISTORY_MARK]: 1, uid, id: e.id, idx: e.idx, snap: e.snap, local: e.local, scroll: e.scroll, prev: e.prev, overlay: guard },
      '', toHash(e.snap));
  } catch { /* rate-limited or an uncloneable value: the page on screen is unaffected */ }
}

function flush() {
  clearTimeout(nav.timer);
  nav.timer = 0;
  write('replaceState', nav.entry, nav.guard);
}

function flushSoon() {
  clearTimeout(nav.timer);
  nav.timer = setTimeout(flush, FLUSH_MS);
}

// Render phase: the entry this snapshot belongs to. A new page key starts a new
// entry here (the effect pushes it after commit) so the page's components,
// mounting in this same render, read their saved state from the right entry.
// Idempotent: StrictMode's second render finds the key already matching.
function pageEntry(snap, db, boot) {
  if (!nav.entry) {
    nav.entry = { ...boot.entry, id: boot.entry.id || newId(), key: pageKey(snap), pending: 'init' };
    nav.guard = !!boot.guard;
    if (boot.reload) nav.scrollTo = boot.entry.scroll;
  }
  const cur = nav.entry;
  const key = pageKey(snap);
  if (key !== cur.key) {
    const fresh = { id: newId(), key, snap, local: {}, scroll: 0 };
    // An entry not yet written to the browser is simply superseded.
    if (cur.pending) nav.entry = { ...cur, ...fresh };
    else if (nav.replaceNext) nav.entry = { ...fresh, idx: cur.idx, prev: cur.prev, pending: 'replace' };
    else nav.entry = { ...fresh, idx: cur.idx + 1, prev: { label: pageLabel(cur.snap, db) }, pending: 'push', from: cur };
    nav.replaceNext = false;
  }
  nav.entry.snap = snap;
  return nav.entry;
}

// Overlays a page keeps in its own state (Inventory's statement view and
// statement editor) register here through usePageOverlay. They share the one
// guard entry with the app's overlays, and Back closes the top one through its
// own close function: a form with unsaved input asks first, and when the user
// stays, reconcile puts the guard back. The last one registered is on top.
const pageOverlays = [];
const anyOverlayOpen = () => !!nav.live?.overlayOpen || pageOverlays.length > 0;

// Bring the browser's entries in line with the overlay state: a guard above the
// page while anything is open, none once everything is closed.
function reconcile() {
  if (!nav.live?.uid) return;
  const open = anyOverlayOpen();
  if (open && !nav.guard) {
    flush();
    write('pushState', nav.entry, true);
    nav.guard = true;
  } else if (!open && nav.guard) {
    nav.guard = false;
    nav.expectPop++;
    nav.expectAt = Date.now();
    window.history.back();
  }
}
const reconcileSoon = () => setTimeout(reconcile, 0);

// Back with an overlay up closes the top one exactly as Esc would: modals,
// the lead panel and the drawer through App.jsx's Esc handler and each form's
// discard guard (a dirty form asks first and stays open), notifications directly,
// a page's own overlay through its registered close.
function closeTop() {
  const o = nav.live.overlays;
  if (o.modal || o.panLead || o.sidebarOpen) {
    const t = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  } else if (o.notifOpen) nav.live.closeNotif();
  else if (pageOverlays.length) pageOverlays[pageOverlays.length - 1].close();
}

// Registers a page's own overlay while `open`. `close` is what Back calls:
// the same path as its ✕ (a form passes its discard-guarded close).
export function usePageOverlay(open, close) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!open) return undefined;
    const o = { close: () => closeRef.current() };
    pageOverlays.push(o);
    reconcileSoon();
    return () => {
      const i = pageOverlays.indexOf(o);
      if (i >= 0) pageOverlays.splice(i, 1);
      reconcileSoon();
    };
  }, [open]);
}

function restore(st) {
  // Another account's entry (an admin's pages from before "view as"): its page, not its filters.
  const mine = st.uid === nav.live.uid;
  const snap = mine
    ? { ...DEFAULT_SNAP, ...st.snap }
    : { ...DEFAULT_SNAP, view: st.snap?.view || DEFAULT_SNAP.view, projTab: st.snap?.projTab || 'list' };
  nav.entry = {
    id: st.id, idx: st.idx || 0, key: pageKey(snap), snap,
    local: mine ? st.local || {} : {}, scroll: mine ? st.scroll || 0 : 0, prev: st.prev || null, pending: null,
  };
  nav.sig = JSON.stringify(snap);
  nav.scrollTo = nav.entry.scroll;
  nav.live.apply(snap);
}

function onPop(ev) {
  if (!nav.live?.uid) return;
  if (nav.expectPop > 0) {
    nav.expectPop--;
    if (Date.now() - nav.expectAt < 2000) { reconcileSoon(); return; }
  }
  // A pending flush belongs to the entry just left; the browser has moved on.
  clearTimeout(nav.timer);
  const st = ev.state;
  if (!st?.[HISTORY_MARK]) {
    nav.guard = false;
    const h = parseHash(window.location.hash);
    if (h) {
      // A #/view typed into the address bar: the browser made a new entry for
      // it, so it is a forward move to that page.
      const cur = nav.entry;
      const snap = { ...DEFAULT_SNAP, ...h, sortBy: cur.snap.sortBy };
      nav.entry = { id: newId(), idx: cur.idx + 1, key: pageKey(snap), snap, local: {}, scroll: 0, prev: { label: pageLabel(cur.snap, nav.live.db) }, pending: null };
      nav.sig = JSON.stringify(snap);
      write('replaceState', nav.entry);
      if (anyOverlayOpen()) nav.live.closeAll();
      nav.live.apply(snap);
    } else write('replaceState', nav.entry); // an entry from before sign-in (the landing page's #anchors) shows this page
    return;
  }
  if (st.overlay) {
    // Forward onto the guard of an overlay that has since closed: step off it.
    nav.guard = true;
    if (st.id !== nav.entry.id) restore(st);
    reconcileSoon();
    return;
  }
  nav.guard = false;
  if (anyOverlayOpen() && st.id === nav.entry.id) { closeTop(); reconcileSoon(); return; }
  if (anyOverlayOpen()) nav.live.closeAll(); // jumped several entries at once
  if (st.id !== nav.entry.id) restore(st);
  reconcileSoon();
}

// A restored page's content can arrive over a few frames (lazy chunk, fetch):
// keep re-applying the scroll until it holds, or until the user scrolls.
function restoreScroll(y) {
  let frames = 0;
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(t => window.removeEventListener(t, stop, true));
  };
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(t => window.addEventListener(t, stop, true));
  const step = () => {
    const el = document.querySelector('.pg-body');
    if (el) el.scrollTop = y;
    if ((el && Math.abs(el.scrollTop - y) < 2) || ++frames > 90) { stop(); return; }
    raf = requestAnimationFrame(step);
  };
  step();
}

function sync() {
  const { uid } = nav.live;
  if (!uid) {
    if (nav.uid) {
      // Signed out: the next sign-in starts a history of its own.
      nav.uid = null;
      clearTimeout(nav.timer);
      nav.entry = { ...nav.entry, id: newId(), idx: 0, local: {}, scroll: 0, prev: null, pending: 'init' };
      nav.guard = false;
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* ignore */ }
    }
    return;
  }
  nav.uid = uid;
  const e = nav.entry;
  let pushed = false;
  if (e.pending) {
    const { pending, from } = e;
    e.pending = null;
    e.from = null;
    clearTimeout(nav.timer);
    if (pending === 'push' && !nav.guard) {
      write('replaceState', from); // the page being left keeps its last filters and scroll
      write('pushState', e);
    } else {
      // init: adopt the entry the page loaded on (still a guard after a reload
      // with an overlay open; reconcile steps off it). replace: swap this entry.
      // A push while the overlay guard is up takes the guard's slot.
      write('replaceState', e, pending === 'init' && nav.guard);
      if (pending !== 'init') nav.guard = false;
    }
    pushed = pending === 'push';
    nav.sig = JSON.stringify(e.snap);
  } else {
    const sig = JSON.stringify(e.snap);
    if (sig !== nav.sig) { nav.sig = sig; flushSoon(); }
  }
  if (nav.scrollTo != null) {
    const y = nav.scrollTo;
    nav.scrollTo = null;
    restoreScroll(y);
  } else if (pushed) {
    const el = document.querySelector('.pg-body');
    if (el) el.scrollTop = 0; // a new page opens at its top
  }
  reconcile();
}

// The next page change replaces the current entry instead of adding one: a
// redirect away from a page the account may not see, or Up from a direct entry.
export function replaceNextPage() { nav.replaceNext = true; }

// Per-entry storage for useNavState.
export const navLocal = {
  has: (k) => !!nav.entry && Object.prototype.hasOwnProperty.call(nav.entry.local, k),
  get: (k) => nav.entry?.local[k],
  set: (k, v) => {
    if (!nav.entry || Object.is(nav.entry.local[k], v)) return;
    nav.entry.local[k] = v;
    flushSoon();
  },
};

export default function useNavHistory({ boot, user, snap, apply, overlays, closeAll, closeNotif, db }) {
  const entry = pageEntry(snap, db, boot);
  const overlayOpen = !!(overlays.modal || overlays.panLead || overlays.notifOpen || overlays.sidebarOpen);
  const live = { uid: user?.id || null, apply, closeAll, closeNotif, overlays, overlayOpen, db };

  // Layout effect: the history entry and the scroll position change before the
  // new page paints.
  useLayoutEffect(() => {
    nav.live = live;
    sync();
  });

  useEffect(() => {
    const onScroll = (e) => {
      if (nav.entry && e.target instanceof Element && e.target.classList.contains('pg-body')) nav.entry.scroll = e.target.scrollTop;
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', flush); // a reload restores the latest filters and scroll
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);

  // The page header's Back: the previous entry when this tab has one, else the
  // page above this one. None on the account's home page.
  let back = null;
  if (user) {
    if (entry.idx > 0 && entry.prev) back = { label: entry.prev.label, go: () => window.history.back() };
    else {
      const up = parentOf(snap, user);
      if (up) back = { label: pageLabel(up, db), go: () => { replaceNextPage(); apply(up); } };
    }
  }

  // The header's breadcrumb. An ancestor crumb opens that page as a new entry.
  const trail = user ? trailOf(snap, user, db).map(t => ({ ...t, go: () => apply(t.snap) })) : [];

  return { pageId: entry.id, back, trail };
}
