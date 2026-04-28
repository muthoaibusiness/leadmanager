import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { clearSession } from '../lib/db.js';
import { avc, ini, rlabel } from '../lib/helpers.js';
import { ROLES } from '../lib/constants.js';

const NAV = {
  INITIAL_AGENT: [{ v: 'dashboard', ico: 'dashboard', lbl: 'Dashboard' }, { v: 'leads', ico: 'list', lbl: 'My Leads' }],
  MEETING_AGENT: [{ v: 'dashboard', ico: 'dashboard', lbl: 'Dashboard' }, { v: 'leads', ico: 'list', lbl: 'My Leads' }],
  TEAM_LEAD: [{ v: 'dashboard', ico: 'dashboard', lbl: 'Dashboard' }, { v: 'team', ico: 'groups', lbl: 'My Team' }, { v: 'leads', ico: 'list', lbl: 'All Leads' }],
  MANAGEMENT: [{ v: 'dashboard', ico: 'dashboard', lbl: 'Dashboard' }, { v: 'leads', ico: 'list', lbl: 'All Leads' }, { v: 'users', ico: 'manage_accounts', lbl: 'Users' }],
};

export default function Sidebar() {
  const { user, setUser, view, nav, sidebarOpen, setSidebarOpen } = useApp();

  if (!user) return null;
  const items = NAV[user.role] || [];

  const handleLogout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <>
      <div className={`sb-ov${sidebarOpen ? ' on' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sb-brand">
          <span className="wlogo wlogo-sm">WECON</span>
        </div>
        <nav className="sb-nav">
          {items.map(it => (
            <div
              key={it.v}
              className={`sb-it${view === it.v ? ' on' : ''}`}
              onClick={() => nav(it.v)}
            >
              <Mi>{it.ico}</Mi>{it.lbl}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">
            <div className="sb-av" style={{ background: avc(user.name) }}>{ini(user.name)}</div>
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
