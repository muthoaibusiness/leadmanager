// Browser history for the app's page state. There is no router: the page on
// screen is `view` (plus a few sub-page fields) in AppContext. useNavHistory
// mirrors that state into window.history so Back/Forward, a reload and a
// pasted #/view URL all land where they should. This file holds the pure parts.
import { ROLES, canSee, FEATURE_KEYS } from './constants.js';
import { getSession } from './db.js';

// One title per page — the hero heading and the label of a Back link to it.
export const VIEW_TITLES = {
  dashboard: 'Dashboard',
  leads: 'Prospects',
  conversations: 'Conversations',
  calendar: 'Calendar',
  pipeline: 'Pipeline',
  clients: 'Contacts',
  properties: 'Projects',
  reports: 'Reports',
  agentperf: 'Performance',
  bookings: 'Sales Activity',
  team: 'My Team',
  accounts: 'Users',
  relay: 'WhatsApp Relay',
  requests: 'Hold Requests',
  inventory: 'Inventory',
  profile: 'My Profile',
  companies: 'Companies',
};

// The navigation fields of AppContext a history entry restores. view, projTab
// and the drill-down decide which PAGE is on screen (a change pushes an entry);
// the rest are that page's tabs and filters (a change only updates the entry).
export const DEFAULT_SNAP = {
  view: 'dashboard', projTab: 'list', agentFilter: null, teamFilter: null,
  tab: 0, statusFilter: 'ALL', sortBy: 'updated', search: '',
};

const drilled = (s) => !!(s.agentFilter || s.teamFilter);

// Two snapshots on the same key are the same page.
export const pageKey = (s) => `${s.view}|${s.view === 'properties' ? s.projTab : ''}|${drilled(s) ? 'drill' : ''}`;

// #/leads, #/properties/units. Filters stay out of the URL: a reload restores
// them from history.state, and a pasted link opens the page with its defaults.
export const toHash = (s) => `#/${s.view}${s.view === 'properties' && s.projTab === 'units' ? '/units' : ''}`;

export function parseHash(hash) {
  const m = /^#\/([a-z]+)(?:\/(units))?$/.exec(hash || '');
  if (!m || !VIEW_TITLES[m[1]]) return null; // the landing page's #anchors land here too
  return { view: m[1], projTab: m[1] === 'properties' && m[2] ? 'units' : 'list' };
}

// Where a signed-in account starts: the same choice the role redirect in App.jsx makes.
export function homeView(user) {
  if (!user) return 'dashboard';
  if (user.role === ROLES.MASTER) return 'companies';
  return FEATURE_KEYS.find(k => k !== 'add_customer' && canSee(user, k)) || 'profile';
}

// What the Back link calls a page.
export function pageLabel(s, db) {
  if (s.agentFilter) return db?.users?.find(u => u.id === s.agentFilter)?.name || 'Prospects';
  if (s.teamFilter) {
    const tl = db?.users?.find(u => u.role === ROLES.TL && u.teamId === s.teamFilter);
    return `${tl?.name || 'Team'}'s Team`;
  }
  if (s.view === 'properties' && s.projTab === 'units') return 'Available Units';
  return VIEW_TITLES[s.view] || 'Back';
}

// The page above this one, for a Back press with nothing earlier in this tab
// (a pasted URL, a fresh sign-in): a drill-down goes up to its unfiltered list,
// Available Units to the project list, any other page to home. Null on home.
export function parentOf(s, user) {
  if (drilled(s)) return { ...s, agentFilter: null, teamFilter: null, tab: 0, statusFilter: 'ALL', search: '' };
  if (s.view === 'properties' && s.projTab === 'units') return { ...s, projTab: 'list' };
  const home = homeView(user);
  if (s.view === home) return null;
  return { ...DEFAULT_SNAP, view: home, sortBy: s.sortBy };
}

// The breadcrumb trail for the page on screen, home first: Dashboard ›
// Projects › Available Units, Dashboard › Prospects › <agent>. Each crumb
// carries the snapshot that opens it.
export function trailOf(s, user, db) {
  const home = homeView(user);
  const base = { ...DEFAULT_SNAP, sortBy: s.sortBy };
  const items = [{ id: home, label: VIEW_TITLES[home], snap: { ...base, view: home } }];
  // The master account's every page but its profile is the company overview.
  if (user?.role === ROLES.MASTER && s.view !== 'profile') return items;
  if (s.view !== home) items.push({ id: s.view, label: VIEW_TITLES[s.view] || s.view, snap: { ...base, view: s.view } });
  if (drilled(s)) items.push({ id: 'drill', label: pageLabel(s, db), snap: s });
  else if (s.view === 'properties' && s.projTab === 'units') items.push({ id: 'units', label: pageLabel(s, db), snap: s });
  return items;
}

export const HISTORY_MARK = 'wepro';

export function readHistoryState() {
  try { return window.history.state; } catch { return null; }
}

// Seeds AppContext before the first paint. A reload of this tab (the entry is
// ours and belongs to the cached account) restores the page with its filters,
// local view state and scroll; otherwise a #/view URL picks the page, and with
// neither the account starts at home.
export function readBoot() {
  const sess = getSession();
  const st = readHistoryState();
  const def = { ...DEFAULT_SNAP, view: sess?.role === ROLES.MASTER ? 'companies' : 'dashboard' };
  if (st?.[HISTORY_MARK] && sess && st.uid === sess.id && st.snap && VIEW_TITLES[st.snap.view]) {
    const snap = { ...def, ...st.snap };
    // guard: reloaded with an overlay open — the entry is the guard above its page.
    return { snap, entry: { id: st.id, idx: st.idx || 0, snap, local: st.local || {}, scroll: st.scroll || 0, prev: st.prev || null }, reload: true, guard: !!st.overlay };
  }
  const h = parseHash(window.location.hash);
  // The master account only ever has the company overview and its profile.
  const snap = h && (sess?.role !== ROLES.MASTER || h.view === 'profile') ? { ...def, ...h } : def;
  return { snap, entry: { id: null, idx: 0, snap, local: {}, scroll: 0, prev: null }, reload: false };
}
