import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { clearSession, getHoldRequests, getDB } from '../lib/db.js';
import { avc, ini, rlabel } from '../lib/helpers.js';
import { canSee, ROLES } from '../lib/constants.js';

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

export default function Sidebar() {
  const { user, view, nav, sidebarOpen, setSidebarOpen, chatOk, waUnread } = useApp();
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
      return (
        <div key={k}>
          <div className={`sb-it sb-grp${childOn ? ' has-on' : ''}`} aria-expanded={open}
            onClick={() => setClosed(c => ({ ...c, [k]: !c[k] }))}>
            <Mi>{g.ico}</Mi>{g.lbl}
            <Mi className="sb-chev">expand_more</Mi>
          </div>
          {open && (
            <div className="sb-sub">
              {kids.map(c => (
                <div key={c.key} className={`sb-subit${view === c.key ? ' on' : ''}`} onClick={() => nav(c.key)}>
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
        <div className={`sb-it${view === k ? ' on' : ''}`} onClick={() => nav(k)}>
          <Mi>{m.ico}</Mi>{m.lbl}
          {badge > 0 && <span className="sb-badge">{badge}</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={`sb-ov${sidebarOpen ? ' on' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sb-brand">
          <span className="wlogo wlogo-sm">WEPRO<span className="wlogo-accent"> CRM</span></span>
          <button className="sb-close" onClick={() => setSidebarOpen(false)} title="Close">
            <Mi>close</Mi>
          </button>
        </div>

        <nav className="sb-nav">
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

        <div className="sb-foot">
          <UserMenu />
        </div>
      </aside>
    </>
  );
}

// Small initials/photo avatar used in the user menu.
function UAvatar({ u, cls = '' }) {
  return u.avatar
    ? <img src={u.avatar} alt="" className={`sb-av sb-av-img ${cls}`} />
    : <div className={`sb-av ${cls}`} style={{ background: avc(u.name) }}>{ini(u.name)}</div>;
}

// Footer identity control: the current-user row is the trigger; clicking opens an
// upward menu with a searchable account switcher (admins) + Profile + Sign out.
// Replaces the old top-of-sidebar AccountSwitcher pill.
function UserMenu() {
  const { user, setUser, impersonator, impersonate, stopImpersonate, nav } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const admin = impersonator || user;
  const isAdmin = admin.role === ROLES.MGMT || admin.role === ROLES.MASTER;
  const db = getDB();
  const accounts = isAdmin
    ? db.users
        .filter(u => (admin.role === ROLES.MASTER ? true : (u.companyId === admin.companyId && u.role !== ROLES.MASTER)))
        .filter(u => u.id !== user.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];
  const ql = q.trim().toLowerCase();
  const filtered = ql ? accounts.filter(u => (u.name || '').toLowerCase().includes(ql) || String(rlabel(u.role) || '').toLowerCase().includes(ql)) : accounts;

  const logout = () => { clearSession(); setUser(null); };

  return (
    <div className="sb-umwrap" ref={ref}>
      {open && (
        <div className="umenu">
          {impersonator && (
            <button className="umenu-item umenu-return" onClick={() => { stopImpersonate(); setOpen(false); }}>
              <Mi>undo</Mi><span>Back to {impersonator.name}</span>
            </button>
          )}
          {isAdmin && (
            <>
              <div className="umenu-sec">Switch account</div>
              <div className="umenu-search">
                <Mi>search</Mi>
                <input autoFocus placeholder="Search account" value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <div className="umenu-list">
                {filtered.map(u => (
                  <button key={u.id} className="umenu-item" onClick={() => { impersonate(u); setOpen(false); setQ(''); }}>
                    <UAvatar u={u} cls="umenu-av" />
                    <span className="umenu-itx"><span className="umenu-in">{u.name}</span><span className="umenu-ir">{rlabel(u.role)}</span></span>
                  </button>
                ))}
                {!filtered.length && <div className="umenu-empty">No match</div>}
              </div>
              <div className="umenu-div" />
            </>
          )}
          {canSee(user, 'profile') && (
            <button className="umenu-item" onClick={() => { nav('profile'); setOpen(false); }}>
              <Mi>person</Mi><span>Profile</span>
            </button>
          )}
          <button className="umenu-item umenu-danger" onClick={logout}>
            <Mi>logout</Mi><span>Sign out</span>
          </button>
        </div>
      )}

      <button className={`sb-user${open ? ' open' : ''}${impersonator ? ' imp' : ''}`} onClick={() => setOpen(o => !o)}>
        <UAvatar u={user} />
        <div className="sb-uinfo">
          <div className="sb-un">{user.name}</div>
          <div className="sb-ur">{impersonator ? 'Viewing · ' + rlabel(user.role) : rlabel(user.role)}</div>
        </div>
        <Mi>unfold_more</Mi>
      </button>
    </div>
  );
}
