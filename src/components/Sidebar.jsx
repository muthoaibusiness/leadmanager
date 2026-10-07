import { useState } from 'react';
import Mi from './Mi.jsx';
import SidebarGlyph from './SidebarGlyph.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getHoldRequests } from '../lib/db.js';
import { kbd } from '../lib/helpers.js';
import { canSee } from '../lib/constants.js';

// Grouped, role-scoped navigation (Muthoclo admin pattern).
// Sections render a label + their visible items; a group renders a header that
// opens/closes its child pages. Visibility is driven by canSee(user, key).
const SECTIONS = [
  { label: null, keys: ['dashboard', 'companies', 'reports', 'agentperf', 'requests'] },
  { label: 'Sales Team', keys: ['leadsGroup', 'conversations', 'calendar', 'properties'] },
  { label: 'Admin', keys: ['team', 'users', 'accounts', 'carpool'] },
];

// Collapsible groups. The header only opens/closes; each child is a page, and
// only the child whose key is the current view is active. The group id is not
// a view key, so the header itself can never be the active page.
const GROUPS = {
  leadsGroup: {
    ico: 'person_search', lbl: 'Leads',
    kids: [{ key: 'leads', lbl: 'Customers' }, { key: 'pipeline', lbl: 'Pipeline' }],
  },
};

// Rows are clickable divs (the codebase's pattern), so Enter/Space are wired to
// do what a click does.
const onActivate = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

// `hideBtnRef`: the brand-row hide button, which the shell moves focus onto.
export default function Sidebar({ hideBtnRef }) {
  const { user, view, nav, sidebarOpen, setSidebarOpen, setSidebarShown, chatOk, waUnread } = useApp();
  // Groups start open; this holds the ones the user has closed.
  const [closed, setClosed] = useState({});

  if (!user) return null;
  const role = user.role;

  // Conversations is gated by the chat allow-list rather than NAV_SCOPES; a
  // group shows when the user may see at least one of its pages.
  const visible = (k) => (GROUPS[k] ? GROUPS[k].kids.some(c => canSee(user, c.key))
    : k === 'conversations' ? chatOk : canSee(user, k));

  const META = {
    dashboard: { ico: 'home', lbl: 'Home' },
    conversations: { ico: 'forum', lbl: 'Conversations' },
    calendar: { ico: 'calendar_month', lbl: 'Calendar' },
    pipeline: { ico: 'view_kanban', lbl: 'Pipeline' },
    clients: { ico: 'account_circle', lbl: 'Contacts' },
    bookings: { ico: 'event_note', lbl: 'Sales Activity' },
    reports: { ico: 'bar_chart', lbl: 'Reports' },
    agentperf: { ico: 'leaderboard', lbl: 'Performance' },
    requests: { ico: 'inbox', lbl: 'Requests' },
    properties: { ico: 'folder', lbl: 'Projects' },
    team: { ico: 'groups', lbl: 'Team' },
    users: { ico: 'manage_accounts', lbl: 'Users' },
    accounts: { ico: 'group_add', lbl: 'Accounts' },
    carpool: { ico: 'directions_car', lbl: 'Carpool Request' },
    companies: { ico: 'corporate_fare', lbl: 'Companies' },
    profile: { ico: 'account_circle', lbl: 'Profile' },
  };

  const pendingHolds = role === 'MANAGEMENT' ? getHoldRequests().filter(r => r.status === 'pending').length : 0;

  // A plain function, not a component declared in here: a component type made
  // anew on every render remounts every row whenever the app context changes,
  // so the rows (and an open group) would not stay stable.
  const renderItem = (k) => {
    const g = GROUPS[k];
    if (g) {
      const kids = g.kids.filter(c => canSee(user, c.key));
      const open = !closed[k];
      // Subtle "holds the current page" state; the strong one is the child's.
      const childOn = kids.some(c => c.key === view);
      const toggle = () => setClosed(c => ({ ...c, [k]: !c[k] }));
      const subId = `sb-sub-${k}`;
      return (
        <div key={k}>
          <div className={`sb-it sb-grp${childOn ? ' has-on' : ''}`} role="button" tabIndex={0}
            aria-expanded={open} aria-controls={subId} onClick={toggle} onKeyDown={onActivate(toggle)}>
            <Mi aria-hidden="true">{g.ico}</Mi>{g.lbl}
            <Mi className="sb-chev" aria-hidden="true">expand_more</Mi>
          </div>
          {open && (
            <div className="sb-sub" id={subId}>
              {kids.map(c => (
                <div key={c.key} className={`sb-subit${view === c.key ? ' on' : ''}`} role="button" tabIndex={0}
                  aria-current={view === c.key ? 'page' : undefined}
                  onClick={() => nav(c.key)} onKeyDown={onActivate(() => nav(c.key))}>
                  {c.lbl}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    const m = META[k];
    let badge = 0;
    if (k === 'requests' && pendingHolds > 0) badge = pendingHolds;
    if (k === 'conversations' && waUnread > 0) badge = waUnread;
    return (
      <div key={k}>
        <div className={`sb-it${view === k ? ' on' : ''}`} role="button" tabIndex={0}
          aria-current={view === k ? 'page' : undefined}
          onClick={() => nav(k)} onKeyDown={onActivate(() => nav(k))}>
          <Mi aria-hidden="true">{m.ico}</Mi>{m.lbl}
          {badge > 0 && <span className="sb-badge">{badge}</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={`sb-ov${sidebarOpen ? ' on' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside id="app-sidebar" className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sb-brand">
          <span className="wlogo wlogo-sm">WEPRO<span className="wlogo-accent"> CRM</span></span>
          {/* macOS-style sidebar button: collapses the docked sidebar on
              desktop, closes the drawer below 1024px. */}
          <button ref={hideBtnRef} className="sb-tog" onClick={() => setSidebarShown(false)}
            aria-label="Hide sidebar" aria-controls="app-sidebar" aria-expanded="true"
            title={`Hide sidebar (${kbd('\\')})`}>
            <SidebarGlyph />
          </button>
        </div>

        <nav className="sb-nav" aria-label="Main">
          {SECTIONS.map((sec, si) => {
            const keys = sec.keys.filter(visible);
            if (!keys.length) return null;
            return (
              <div className="sb-sec" key={si}>
                {sec.label && <div className="sb-sec-lbl">{sec.label}</div>}
                {keys.map(k => renderItem(k))}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
