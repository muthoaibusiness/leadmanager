import { useState, useEffect, useRef } from 'react';
import { useApp } from './context/AppContext.jsx';
import { getDB, getSession, setSession, tryLogin, saveDB, checkFollowUpReminders, getLeads, getProperties, expireHolds } from './lib/db.js';
import { seedDB, SEED_PROPERTIES, DEMO_PROPERTIES } from './lib/seed.js';
import { sbLoad, sbSubscribeNotifs } from './lib/supabase.js';
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
import ProfileView from './components/views/ProfileView.jsx';
import PropertiesView from './components/views/PropertiesView.jsx';
import BookingsView from './components/views/BookingsView.jsx';
import PipelineView from './components/views/PipelineView.jsx';
import ClientsView from './components/views/ClientsView.jsx';
import ReportsView from './components/views/ReportsView.jsx';

import AddLeadModal from './components/modals/AddLeadModal.jsx';
import ForwardModal from './components/modals/ForwardModal.jsx';
import SchedModal from './components/modals/SchedModal.jsx';
import DealModal from './components/modals/DealModal.jsx';
import NoteModal from './components/modals/NoteModal.jsx';
import CreateUserModal from './components/modals/CreateUserModal.jsx';
import EditAgentModal from './components/modals/EditAgentModal.jsx';
import ImportModal from './components/modals/ImportModal.jsx';
import TargetModal from './components/modals/TargetModal.jsx';
import DeleteUserModal from './components/modals/DeleteUserModal.jsx';
import CredsModal from './components/modals/CredsModal.jsx';
import FollowUpModal from './components/modals/FollowUpModal.jsx';
import LostModal from './components/modals/LostModal.jsx';
import PropertyViewModal from './components/modals/PropertyViewModal.jsx';
import PropertyFormModal from './components/modals/PropertyFormModal.jsx';
import UnitBookingModal from './components/modals/UnitBookingModal.jsx';
import BookingModal from './components/modals/BookingModal.jsx';

// ── Loading screen ──────────────────────────────────────────────────────────
function LoadingScreen({ visible }) {
  return (
    <div id="ld" className={visible ? '' : 'out'} style={visible ? {} : { pointerEvents: 'none' }}>
      <div className="ld-brand">
        <span className="wlogo wlogo-white">WEPRO<span className="wlogo-accent"> CRM</span></span>
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
  const users = [...db.users]
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));

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
          <span className="wlogo wlogo-white">WEPRO<span className="wlogo-accent"> CRM</span></span>
        </div>
        <div className="ln-hero-center">
          <div className="ln-hero-label">Real Estate</div>
          <div className="ln-hero-title">Sales engine</div>
        </div>
      </div>
      <div className="ln-right">
        <div className="ln-card">
          <div className="lnc-h">Sign in</div>
          <div className="lnc-s">Welcome back</div>
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
          <div className="demo-wrap">
            <button className="demo-toggle" onClick={() => setDemoOpen(v => !v)}>
              <Mi>people_alt</Mi>
              Demo accounts
              <Mi style={{ marginLeft: 'auto', transition: 'transform .2s', transform: demoOpen ? 'rotate(180deg)' : 'none' }}>expand_more</Mi>
            </button>
            {demoOpen && (
              <div className="demo-popup">
                <div className="demo-popup-hd">Quick access</div>
                <div className="demo-popup-list">
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Thin chrome bar ─────────────────────────────────────────────────────────
function PageHeader() {
  const { setSidebarOpen } = useApp();
  return (
    <header className="pg-head">
      <button className="ham" onClick={() => setSidebarOpen(true)}><Mi>menu</Mi></button>
      <div style={{ flex: 1 }} />
      <DateRangePicker />
      <NotifBell />
    </header>
  );
}

// ── In-body hero header (eyebrow + big title + subtitle + actions) ───────────
function PageHero() {
  const { user, view, agentFilter, teamFilter, setAgentFilter, setTeamFilter, setTab, setStatusFilter, setSearch, openModal, setCreateUserRoles, setPropEdit, dbVersion } = useApp();
  if (!user) return null;
  const db = getDB();

  const agentName = agentFilter ? db.users.find(u => u.id === agentFilter)?.name : '';
  const tlUser = teamFilter ? db.users.find(u => u.role === 'TEAM_LEAD' && u.teamId === teamFilter) : null;
  const drilled = !!(agentFilter || teamFilter);
  const clearDrill = () => { setAgentFilter(null); setTeamFilter(null); setTab(0); setStatusFilter('ALL'); setSearch(''); };

  // eyebrow / title / subtitle per view
  const myLeads = getLeads(user);
  const activeLeads = myLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).length;
  const props = getProperties();
  const propAvail = props.filter(p => p.status !== 'SOLD_OUT').length;
  const teamAgents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === user.teamId).length;
  const roleTag = { INITIAL_AGENT: 'My Today', MEETING_AGENT: 'My Today', TEAM_LEAD: 'Team Overview', MANAGEMENT: 'Company Overview' }[user.role];

  const META = {
    dashboard: { eyebrow: rlabel(user.role), title: 'Dashboard', sub: roleTag + ' · real-estate sales engine' },
    leads: { eyebrow: 'Pipeline', title: 'Customers', sub: `${myLeads.length} customers · ${activeLeads} active` },
    pipeline: { eyebrow: 'Sales', title: 'Pipeline', sub: 'Drag deals across stages' },
    clients: { eyebrow: 'Relationships', title: 'Contacts', sub: '360° customer view' },
    properties: { eyebrow: 'Catalog', title: 'Projects', sub: `${props.length} projects · ${propAvail} available` },
    reports: { eyebrow: 'Insights', title: 'Reports', sub: 'Live sales analytics' },
    bookings: { eyebrow: 'Sales', title: 'Sales Activity', sub: 'Payments, instalments & dues' },
    team: { eyebrow: 'Team', title: 'My Team', sub: `${teamAgents} agents` },
    users: { eyebrow: 'Administration', title: 'Users', sub: `${db.users.length} accounts` },
    profile: { eyebrow: 'Account', title: 'My Profile', sub: 'Manage your details & avatar' },
  };
  let { eyebrow, title, sub } = META[view] || { eyebrow: '', title: view, sub: '' };
  if (drilled) {
    title = agentFilter && agentName ? agentName : (tlUser?.name || 'Team') + "'s Team";
    sub = 'Filtered customers';
  }

  // actions
  let actions = [];
  if ([ROLES.IA, ROLES.TL].includes(user.role) && (view === 'dashboard' || view === 'leads')) {
    actions.push(<button key="add-lead" className="btn btn-p" onClick={() => openModal('add-lead')}><Mi>add</Mi>Add Customer</button>);
    actions.push(<button key="import" className="btn btn-g" onClick={() => openModal('import')}><Mi>upload</Mi>Import</button>);
  }
  if (view === 'team' && user.role === ROLES.TL) actions.push(<button key="add-agent" className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.IA, ROLES.MA]); openModal('create-user'); }}><Mi>person_add</Mi>Add Agent</button>);
  if (view === 'users' && user.role === ROLES.MGMT) actions.push(<button key="add-tl" className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.TL]); openModal('create-user'); }}><Mi>person_add</Mi>Add Team Lead</button>);
  if (view === 'properties' && user.role === ROLES.MGMT) actions.push(<button key="add-prop" className="btn btn-p" onClick={() => { setPropEdit({}); openModal('property-form'); }}><Mi>add</Mi>Add Property</button>);

  return (
    <div className="hero">
      <div className="hero-main">
        {drilled
          ? <button className="hero-back" onClick={clearDrill}><Mi>arrow_back</Mi>All Customers</button>
          : <div className="hero-eyebrow">{eyebrow}</div>}
        <h1 className="hero-title">{title}</h1>
        {sub && <div className="hero-sub">{sub}</div>}
      </div>
      {actions.length > 0 && <div className="hero-acts">{actions}</div>}
    </div>
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
  if (view === 'pipeline') return <PipelineView />;
  if (view === 'clients') return <ClientsView />;
  if (view === 'properties') return <PropertiesView />;
  if (view === 'bookings') return <BookingsView />;
  if (view === 'reports') return <ReportsView />;
  if (view === 'team') return <TeamView />;
  if (view === 'users') return <UsersView />;
  if (view === 'profile') return <ProfileView />;
  return null;
}

// ── App shell ───────────────────────────────────────────────────────────────
function AppShell() {
  const { view } = useApp();
  const wide = view === 'pipeline'; // kanban needs the full canvas
  return (
    <div id="app">
      <Sidebar />
      <div className="page">
        <PageHeader />
        <main className="pg-body"><div className={`pg-inner${wide ? ' pg-wide' : ''}`}><PageHero /><PageBody /></div></main>
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

  // Real-time notification subscription
  useEffect(() => {
    if (!user) return;
    const unsub = sbSubscribeNotifs(user.id, (newNotif) => {
      const db = getDB();
      if (!db.notifications) db.notifications = {};
      if (!db.notifications[user.id]) db.notifications[user.id] = [];
      // avoid duplicates
      if (!db.notifications[user.id].find(n => n.id === newNotif.id)) {
        db.notifications[user.id].unshift(newNotif);
        refreshDB();
      }
    });
    return unsub;
  }, [user?.id]);

  // Auto-release expired unit holds every minute
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { if (expireHolds()) refreshDB(); }, 60000);
    return () => clearInterval(t);
  }, [user?.id]);

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
      // Load from Supabase. If it has no users (empty / unreachable), fall back to
      // existing local data; if that's also empty, seed the default accounts so login works.
      const sbData = await sbLoad();
      let freshDB = sbData;
      if (!freshDB || !freshDB.users || !freshDB.users.length) {
        const local = getDB();
        freshDB = (local.users && local.users.length) ? local : seedDB();
      }
      if (!freshDB.notifications) freshDB.notifications = {};
      // Seed the WECON project catalog ONCE (never resurrect deleted projects)
      if (!freshDB.properties) freshDB.properties = [];
      if (!freshDB.properties.length && !localStorage.getItem('wecon_props_seeded')) {
        freshDB.properties = SEED_PROPERTIES.map(p => ({ ...p }));
      }
      localStorage.setItem('wecon_props_seeded', '1');
      // Safety net: an empty catalog always gets the 6 demo projects so the view is never blank
      if (!freshDB.properties.length) {
        freshDB.properties = DEMO_PROPERTIES.map(p => ({ ...p, units: p.units.map(u => ({ ...u })) }));
      }
      checkFollowUpReminders(freshDB);
      saveDB(freshDB);
      expireHolds(); // auto-release expired holds (saves internally if any)
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
      <EditAgentModal />
      <ImportModal />
      <TargetModal />
      <DeleteUserModal />
      <CredsModal />
      <FollowUpModal />
      <LostModal />
      <PropertyViewModal />
      <PropertyFormModal />
      <UnitBookingModal />
      <BookingModal />
      <Toast />
    </>
  );
}
