import { useState, useEffect, useRef } from 'react';
import { useApp } from './context/AppContext.jsx';
import { getDB, getSession, setSession, tryLogin, saveDB, genSeedNotifs } from './lib/db.js';
import { sbLoad } from './lib/supabase.js';
import { TEAMS } from './lib/data.js';
import { avc, ini, rlabel } from './lib/helpers.js';
import { ROLES } from './lib/constants.js';

import Mi from './components/Mi.jsx';
import Sidebar from './components/Sidebar.jsx';
import NotifBell from './components/NotifBell.jsx';
import LeadPanel from './components/LeadPanel.jsx';
import Toast from './components/Toast.jsx';
import DateRangePicker from './components/DateRangePicker.jsx';

import InitialAgentDash from './components/dashboards/InitialAgentDash.jsx';
import MeetingAgentDash from './components/dashboards/MeetingAgentDash.jsx';
import TeamLeadDash from './components/dashboards/TeamLeadDash.jsx';
import ManagementDash from './components/dashboards/ManagementDash.jsx';

import LeadsView from './components/views/LeadsView.jsx';
import TeamView from './components/views/TeamView.jsx';
import UsersView from './components/views/UsersView.jsx';

import AddLeadModal from './components/modals/AddLeadModal.jsx';
import ForwardModal from './components/modals/ForwardModal.jsx';
import SchedModal from './components/modals/SchedModal.jsx';
import DealModal from './components/modals/DealModal.jsx';
import NoteModal from './components/modals/NoteModal.jsx';
import CreateUserModal from './components/modals/CreateUserModal.jsx';
import ImportModal from './components/modals/ImportModal.jsx';
import TargetModal from './components/modals/TargetModal.jsx';
import DeleteUserModal from './components/modals/DeleteUserModal.jsx';
import CredsModal from './components/modals/CredsModal.jsx';

// ── Loading screen ──────────────────────────────────────────────────────────
function LoadingScreen({ visible }) {
  return (
    <div id="ld" className={visible ? '' : 'out'} style={visible ? {} : { pointerEvents: 'none' }}>
      <div className="ld-brand">
        <span className="wlogo wlogo-white">WECON</span>
        <div className="ld-sub">Real Estate CRM</div>
      </div>
      <div className="ld-spin" />
    </div>
  );
}

// ── Login page ─────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const db = getDB();

  const order = { MANAGEMENT: 0, TEAM_LEAD: 1, MEETING_AGENT: 2, INITIAL_AGENT: 3 };
  const users = [...db.users].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));

  const doLogin = () => {
    if (!email || !pw) { setErr('Enter email and password.'); return; }
    setLoading(true);
    setErr('');
    setTimeout(() => {
      const u = tryLogin(email, pw);
      setLoading(false);
      if (!u) { setErr('Incorrect credentials. Use a demo account below.'); return; }
      setSession(u);
      onLogin(u);
    }, 500);
  };

  const handleKey = (e) => { if (e.key === 'Enter') doLogin(); };

  return (
    <div id="login">
      <div className="ln-left">
        <div className="ln-brand">
          <span className="wlogo wlogo-white">WECON</span>
        </div>
        <div className="ln-hero-center">
          <div className="ln-hero-label">Real Estate</div>
          <div className="ln-hero-title">Sales engine</div>
        </div>
      </div>
      <div className="ln-right">
        <div className="ln-card">
          <div className="lnc-h">Sign in</div>
          <div className="lnc-s">Welcome back to WECON PropCRM</div>
          <div className="fl">
            <label>Email address</label>
            <div className="finp-wrap">
              <Mi>mail_outline</Mi>
              <input className="finp finp-ico" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKey} autoComplete="email" />
            </div>
          </div>
          <div className="fl">
            <label>Password</label>
            <div className="pw-w finp-wrap">
              <Mi>lock_outline</Mi>
              <input className="finp finp-ico" type={showPw ? 'text' : 'password'} placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={handleKey} autoComplete="current-password" />
              <button className="pw-e" onClick={() => setShowPw(v => !v)}><Mi>{showPw ? 'visibility_off' : 'visibility'}</Mi></button>
            </div>
          </div>
          {err && <div className="err-msg">{err}</div>}
          <button className="btn-ln" onClick={doLogin} disabled={loading}>
            {loading ? 'Signing in…' : 'Continue'}
          </button>
          <button className="demo-toggle" onClick={() => setDemoOpen(v => !v)}>
            <Mi>people_alt</Mi>
            Demo accounts
            <Mi style={{ marginLeft: 'auto', transition: 'transform .2s', transform: demoOpen ? 'rotate(180deg)' : 'none' }}>expand_more</Mi>
          </button>
          {demoOpen && (
            <div className="demo-grid">
              {users.map(u => (
                <button key={u.id} className="dg-btn" onClick={() => { setEmail(u.email); setPw('1234'); setErr(''); setDemoOpen(false); }}>
                  <div className="dg-av" style={{ background: `hsl(${u.name.charCodeAt(0) * 13 % 360},55%,45%)` }}>{u.name[0]}</div>
                  <div>
                    <div className="dg-name">{u.name}</div>
                    <div className="dg-role">{rlabel(u.role)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page header ─────────────────────────────────────────────────────────────
function PageHeader() {
  const { user, view, agentFilter, setSidebarOpen, openModal, setCreateUserRoles, dbVersion } = useApp();
  const db = getDB();

  const agentName = agentFilter ? db.users.find(u => u.id === agentFilter)?.name : '';
  const titles = { dashboard: 'Dashboard', leads: 'Leads', team: 'My Team', users: 'Users' };
  const title = agentFilter && agentName ? agentName + "'s Leads" : titles[view] || '';

  let actions = [];
  if (user && [ROLES.IA, ROLES.TL].includes(user.role) && (view === 'dashboard' || view === 'leads')) {
    actions.push(
      <button key="add-lead" className="btn btn-p btn-sm" onClick={() => openModal('add-lead')}>
        <Mi>person_add</Mi>Add Lead
      </button>
    );
    actions.push(
      <button key="import" className="btn btn-g btn-sm" onClick={() => openModal('import')}>
        <Mi>upload_file</Mi>Import CSV
      </button>
    );
  }
  if (view === 'team' && user?.role === ROLES.TL) {
    actions.push(
      <button key="add-agent" className="btn btn-p btn-sm" onClick={() => { setCreateUserRoles([ROLES.IA, ROLES.MA]); openModal('create-user'); }}>
        <Mi>person_add</Mi>Add Agent
      </button>
    );
  }
  if (view === 'users' && user?.role === ROLES.MGMT) {
    actions.push(
      <button key="add-tl" className="btn btn-p btn-sm" onClick={() => { setCreateUserRoles([ROLES.TL]); openModal('create-user'); }}>
        <Mi>person_add</Mi>Add Team Lead
      </button>
    );
  }

  return (
    <header className="pg-head">
      <button className="ham" onClick={() => setSidebarOpen(true)}><Mi>menu</Mi></button>
      <div className="pg-title">{title}</div>
      <div className="pg-acts">{actions}</div>
      <DateRangePicker />
      <NotifBell />
    </header>
  );
}

// ── Main page body ──────────────────────────────────────────────────────────
function PageBody() {
  const { user, view, dbVersion } = useApp();
  if (!user) return null;

  if (view === 'dashboard') {
    if (user.role === ROLES.IA) return <InitialAgentDash />;
    if (user.role === ROLES.MA) return <MeetingAgentDash />;
    if (user.role === ROLES.TL) return <TeamLeadDash />;
    return <ManagementDash />;
  }
  if (view === 'leads') return <LeadsView />;
  if (view === 'team') return <TeamView />;
  if (view === 'users') return <UsersView />;
  return null;
}

// ── App shell ───────────────────────────────────────────────────────────────
function AppShell() {
  return (
    <div id="app">
      <Sidebar />
      <div className="page">
        <PageHeader />
        <main className="pg-body"><PageBody /></main>
      </div>
    </div>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { user, setUser, refreshDB, searchRef, panLead, setPanLead, closeModal, modal, setSearch } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadVisible, setLoadVisible] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !inInput) {
        e.preventDefault();
        searchRef?.current?.focus();
      }
      if (e.key === 'Escape') {
        if (modal) { closeModal(); return; }
        if (panLead) { setPanLead(null); return; }
        if (searchRef?.current === document.activeElement) { setSearch(''); searchRef.current.blur(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, panLead, searchRef]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      // Try to load from Supabase
      const sbData = await sbLoad();
      if (sbData) {
        let loadedDB = sbData;
        if (!loadedDB.teams) loadedDB.teams = TEAMS;
        if (!loadedDB.notifications) {
          loadedDB.notifications = genSeedNotifs(loadedDB);
        }
        saveDB(loadedDB);
      } else {
        // Use localStorage / default seed
        const db = getDB();
        saveDB(db);
      }
      refreshDB();

      // Fade out loading screen
      setLoading(false);
      setTimeout(() => setLoadVisible(false), 400);

      // Try to restore session
      const u = getSession();
      if (u) setUser(u);
    })();
  }, []);

  return (
    <>
      {loadVisible && <LoadingScreen visible={loading} />}
      {!user && !loading && <LoginPage onLogin={(u) => { setUser(u); refreshDB(); }} />}
      {user && <AppShell />}
      <LeadPanel />
      {/* Modals */}
      <AddLeadModal />
      <ForwardModal />
      <SchedModal />
      <DealModal />
      <NoteModal />
      <CreateUserModal />
      <ImportModal />
      <TargetModal />
      <DeleteUserModal />
      <CredsModal />
      <Toast />
    </>
  );
}
