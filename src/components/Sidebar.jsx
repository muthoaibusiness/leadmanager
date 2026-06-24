import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { clearSession, getHoldRequests, getDB } from '../lib/db.js';
import { avc, ini, rlabel } from '../lib/helpers.js';
import { canSee, ROLES } from '../lib/constants.js';

// Grouped, role-scoped navigation (Muthoclo admin pattern).
// Sections render a label + their visible items; items may expand children
// when active. Visibility is driven by canSee(role, key).
const SECTIONS = [
  { label: null, keys: ['dashboard', 'companies', 'reports', 'agentperf', 'requests'] },
  { label: 'Sales Team', keys: ['leads', 'properties'] },
  { label: 'Admin', keys: ['team', 'users', 'accounts'] },
];

// Nested sub-views: Pipeline is a view of Leads, so it lives indented under it.
const CHILDREN = {
  leads: [{ key: 'pipeline', lbl: 'Pipeline' }],
};

export default function Sidebar() {
  const { user, view, nav, sidebarOpen, setSidebarOpen } = useApp();

  if (!user) return null;
  const role = user.role;

  const META = {
    dashboard: { ico: 'home', lbl: 'Home' },
    leads: { ico: 'person_search', lbl: 'Leads' },
    pipeline: { ico: 'view_kanban', lbl: 'Pipeline' },
    clients: { ico: 'account_circle', lbl: 'Contacts' },
    bookings: { ico: 'event_note', lbl: 'Sales Activity' },
    reports: { ico: 'bar_chart', lbl: 'Reports' },
    agentperf: { ico: 'leaderboard', lbl: 'Agent Performance' },
    requests: { ico: 'inbox', lbl: 'Requests' },
    properties: { ico: 'folder', lbl: 'Projects' },
    team: { ico: 'groups', lbl: 'Team' },
    users: { ico: 'manage_accounts', lbl: 'Users' },
    accounts: { ico: 'group_add', lbl: 'Accounts' },
    companies: { ico: 'corporate_fare', lbl: 'Companies' },
    profile: { ico: 'account_circle', lbl: 'Profile' },
  };

  const pendingHolds = role === 'MANAGEMENT' ? getHoldRequests().filter(r => r.status === 'pending').length : 0;

  const NavItem = ({ k }) => {
    const m = META[k];
    const kids = CHILDREN[k];
    // Parent stays highlighted while on itself OR any of its nested sub-views.
    const active = view === k || (kids && kids.some(c => c.key === view));
    const badge = k === 'requests' && pendingHolds > 0 ? pendingHolds : 0;
    return (
      <div>
        <div className={`sb-it${active ? ' on' : ''}`} onClick={() => nav(k)}>
          <Mi>{m.ico}</Mi>{m.lbl}
          {badge > 0 && <span className="sb-badge">{badge}</span>}
        </div>
        {active && kids && (
          <div className="sb-sub">
            {kids.map((c) => (
              <div
                key={c.key}
                className={`sb-subit${view === c.key ? ' on' : ''}`}
                onClick={(e) => { e.stopPropagation(); nav(c.key); }}
              >
                {c.lbl}
              </div>
            ))}
          </div>
        )}
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
            const keys = sec.keys.filter(k => canSee(role, k));
            if (!keys.length) return null;
            return (
              <div className="sb-sec" key={si}>
                {sec.label && <div className="sb-sec-lbl">{sec.label}</div>}
                {keys.map(k => <NavItem key={k} k={k} />)}
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
  const filtered = ql ? accounts.filter(u => (u.name || '').toLowerCase().includes(ql) || rlabel(u.role).toLowerCase().includes(ql)) : accounts;

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
          {canSee(user.role, 'profile') && (
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
