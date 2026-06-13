import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { clearSession } from '../lib/db.js';
import { avc, ini, rlabel } from '../lib/helpers.js';
import { canSee } from '../lib/constants.js';

// Grouped, role-scoped navigation (Muthoclo admin pattern).
// Sections render a label + their visible items; items may expand children
// when active. Visibility is driven by canSee(role, key).
const SECTIONS = [
  { label: null, keys: ['dashboard', 'companies', 'reports'] },
  { label: 'Sales Team', keys: ['leads', 'clients', 'pipeline', 'properties', 'bookings'] },
  { label: 'Admin', keys: ['team', 'users', 'accounts'] },
];

export default function Sidebar() {
  const { user, setUser, view, nav, sidebarOpen, setSidebarOpen } = useApp();

  if (!user) return null;
  const role = user.role;

  const META = {
    dashboard: { ico: 'home', lbl: 'Home' },
    leads: { ico: 'person_search', lbl: 'Leads' },
    pipeline: { ico: 'view_kanban', lbl: 'Pipeline' },
    clients: { ico: 'account_circle', lbl: 'Contacts' },
    bookings: { ico: 'event_note', lbl: 'Sales Activity' },
    reports: { ico: 'bar_chart', lbl: 'Reports' },
    properties: { ico: 'folder', lbl: 'Projects' },
    team: { ico: 'groups', lbl: 'Team' },
    users: { ico: 'manage_accounts', lbl: 'Users' },
    accounts: { ico: 'group_add', lbl: 'Accounts' },
    companies: { ico: 'corporate_fare', lbl: 'Companies' },
    profile: { ico: 'account_circle', lbl: 'Profile' },
  };

  const handleLogout = () => { clearSession(); setUser(null); };

  const NavItem = ({ k }) => {
    const m = META[k];
    const active = view === k;
    return (
      <div>
        <div className={`sb-it${active ? ' on' : ''}`} onClick={() => nav(k)}>
          <Mi>{m.ico}</Mi>{m.lbl}
        </div>
        {active && m.children && (
          <div className="sb-sub">
            {m.children.map((c, i) => (
              <div
                key={i}
                className={`sb-subit${c.on ? ' on' : ''}`}
                onClick={(e) => { e.stopPropagation(); c.onClick(); }}
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
          {canSee(role, 'profile') && (
            <div className={`sb-it${view === 'profile' ? ' on' : ''}`} onClick={() => nav('profile')}>
              <Mi>person</Mi>Profile
            </div>
          )}
          <div className="sb-user">
            {user.avatar
              ? <img src={user.avatar} alt={user.name} className="sb-av sb-av-img" />
              : <div className="sb-av" style={{ background: avc(user.name) }}>{ini(user.name)}</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sb-un">{user.name}</div>
              <div className="sb-ur">{rlabel(user.role)}</div>
            </div>
            <button className="sb-logout" onClick={handleLogout} title="Sign out">
              <Mi>logout</Mi>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
