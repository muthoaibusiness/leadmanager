import { useState, useEffect, useRef } from 'react';
import { useApp } from './context/AppContext.jsx';
import { getDB, getSession, setSession, tryLogin, saveDB, checkFollowUpReminders, getLeads, getProperties, expireHolds, migrateTenancy, mergeDB, findDuplicateLeads, purgeDemoSeed, dedupeLeads, reconcileDeletions } from './lib/db.js';
import { seedDB, SEED_PROPERTIES, DEMO_PROPERTIES } from './lib/seed.js';
import { sbLoad, sbSubscribeNotifs } from './lib/supabase.js';
import { pushNotify, requestNotifyPermission } from './lib/pushNotify.js';
import { avc, ini, rlabel } from './lib/helpers.js';
import { ROLES } from './lib/constants.js';

import Mi from './components/Mi.jsx';
import { SignIn1 } from './components/ui/modern-stunning-sign-in.jsx';
import { ProgressCircle } from './components/ui/progress.jsx';
import LandingPage from './components/LandingPage.jsx';
import Sidebar from './components/Sidebar.jsx';
import NotifBell from './components/NotifBell.jsx';
import LeadPanel from './components/LeadPanel.jsx';
import Toast from './components/Toast.jsx';
import DateRangePicker from './components/DateRangePicker.jsx';

import InitialAgentDash from './components/dashboards/InitialAgentDash.jsx';
import MeetingAgentDash from './components/dashboards/MeetingAgentDash.jsx';
import TeamLeadDash from './components/dashboards/TeamLeadDash.jsx';
import ManagementDash from './components/dashboards/ManagementDash.jsx';
import MasterDash from './components/dashboards/MasterDash.jsx';

import LeadsView from './components/views/LeadsView.jsx';
import TeamView from './components/views/TeamView.jsx';
import UsersView from './components/views/UsersView.jsx';
import AccountsView from './components/views/AccountsView.jsx';
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
import DuplicateModal from './components/modals/DuplicateModal.jsx';
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

// ── Post-login loader (shadcn ProgressCircle spinner, adapted) ───────────────
function PostLoginLoader() {
  return (
    <div className="pl-overlay">
      <span className="wlogo wlogo-white">WEPRO<span className="wlogo-accent"> CRM</span></span>
      <ProgressCircle value={25} size={40} strokeWidth={4} className="prog-spin" indicatorClassName="prog-volt" />
      <div className="pl-text">Loading your workspace…</div>
    </div>
  );
}

// ── Login page ─────────────────────────────────────────────────────────────
function LoginPage({ onLogin, onBack }) {
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
      <svg className="login-bg-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <polyline points="400,0 200,450 0,450" fill="none" stroke="#5EC564" strokeWidth="1.5" opacity="0.6" />
        <polygon points="1440,700 1300,900 1440,900" fill="#142B1B" opacity="0.8" />
      </svg>
      <div className="ln-left">
        <div className="ln-brand">
          <span className="brand-green">WEPRO</span><span className="brand-white">CRM</span>
        </div>
        {onBack && <button className="ln-back" onClick={onBack}><Mi>arrow_back</Mi>Back to home</button>}
        <div className="ln-tagline">
          <div className="ln-tagline-sub">REAL ESTATE</div>
          <div className="ln-tagline-main">SALES ENGINE</div>
        </div>
      </div>
      <div className="ln-right">
        <SignIn1
          email={email} setEmail={setEmail}
          password={pw} setPassword={setPw}
          error={err} loading={loading}
          onSignIn={doLogin} onKeyDown={handleKey} onBack={onBack}
          footer={
            <div className="demo-wrap">
              <button className="demo-toggle" onClick={() => setDemoOpen(v => !v)}>
                <Mi className="mi-left">person</Mi>
                Demo Account
                <Mi className="mi-right" style={{ transform: demoOpen ? 'rotate(180deg)' : 'none' }}>expand_more</Mi>
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
          }
        />
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
  // Every dashboard now has its own greeting header — skip the generic hero.
  if (view === 'dashboard') return null;
  if (user.role === ROLES.MASTER && view === 'companies') return null;
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

  const META = {
    dashboard: { eyebrow: rlabel(user.role), title: 'Dashboard', sub: '' },
    leads: { eyebrow: 'Pipeline', title: 'Customers', sub: `${myLeads.length} customers · ${activeLeads} active` },
    pipeline: { eyebrow: 'Sales', title: 'Pipeline', sub: 'Drag deals across stages' },
    clients: { eyebrow: 'Relationships', title: 'Contacts', sub: '360° customer view' },
    properties: { eyebrow: 'Catalog', title: 'Projects', sub: `${props.length} projects · ${propAvail} available` },
    reports: { eyebrow: 'Insights', title: 'Reports', sub: 'Live sales analytics' },
    bookings: { eyebrow: 'Sales', title: 'Sales Activity', sub: 'Payments, instalments & dues' },
    team: { eyebrow: 'Team', title: 'My Team', sub: `${teamAgents} agents` },
    users: { eyebrow: 'Administration', title: 'Users', sub: `${db.users.length} accounts` },
    accounts: { eyebrow: 'Administration', title: 'Account Management', sub: 'Create & manage multiple accounts' },
    profile: { eyebrow: 'Account', title: 'My Profile', sub: 'Manage your details & avatar' },
    companies: { eyebrow: 'Master Admin', title: 'Companies', sub: 'Company-wise overview' },
  };
  let { eyebrow, title, sub } = META[view] || { eyebrow: '', title: view, sub: '' };
  if (user.role === ROLES.MASTER) ({ eyebrow, title, sub } = META.companies); // master only ever sees the company overview
  if (drilled) {
    title = agentFilter && agentName ? agentName : (tlUser?.name || 'Team') + "'s Team";
    sub = 'Filtered customers';
  }

  // actions
  let actions = [];
  if ([ROLES.IA, ROLES.TL].includes(user.role) && view === 'leads') {
    actions.push(<button key="add-lead" className="btn btn-p" onClick={() => openModal('add-lead')}><Mi>add</Mi>Add Customer</button>);
    actions.push(<button key="import" className="btn btn-g" onClick={() => openModal('import')}><Mi>upload</Mi>Import</button>);
  }
  if (view === 'leads' && [ROLES.IA, ROLES.MA, ROLES.TL, ROLES.MGMT].includes(user.role)) {
    const dupes = findDuplicateLeads(user);
    const dn = dupes.reduce((s, g) => s + (g.leads.length - 1), 0);
    actions.push(
      <button key="dupes" className="btn btn-g" onClick={() => openModal('duplicates')}>
        <Mi>content_copy</Mi>Duplicates{dn > 0 && <span className="dup-count">{dn}</span>}
      </button>
    );
  }
  if (view === 'team' && user.role === ROLES.TL) actions.push(<button key="add-agent" className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.IA, ROLES.MA]); openModal('create-user'); }}><Mi>person_add</Mi>Add Agent</button>);
  if (view === 'users' && user.role === ROLES.MGMT) actions.push(<button key="add-tl" className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.TL]); openModal('create-user'); }}><Mi>person_add</Mi>Add Team Lead</button>);
  if (view === 'properties' && user.role === ROLES.MGMT) actions.push(<button key="add-prop" className="btn btn-p" onClick={() => { setPropEdit({}); openModal('property-form'); }}><Mi>add</Mi>Add Property</button>);

  return (
    <div className={`hero${view === 'pipeline' ? ' hero-compact' : ''}`}>
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

  if (user.role === ROLES.MASTER && view !== 'profile') return <MasterDash />; // master sees the company-wise overview
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
  if (view === 'accounts') return <AccountsView />;
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
  const { user, setUser, setView, refreshDB, searchRef, panLead, setPanLead, closeModal, modal, setSearch, notifOpen } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadVisible, setLoadVisible] = useState(true);
  const [showLogin, setShowLogin] = useState(false); // landing → login gate
  const [entering, setEntering] = useState(false);    // brief loader after login
  const initialized = useRef(false);
  const notifOpenRef = useRef(false);
  notifOpenRef.current = notifOpen; // live value for the (stable) realtime callback

  // Show the post-login loader for a beat, then reveal the app
  const enterApp = (u) => {
    setUser(u);
    if (u.role === ROLES.MASTER) setView('companies');
    refreshDB();
    requestNotifyPermission(); // ask for browser push permission on login
    setEntering(true);
    setTimeout(() => setEntering(false), 1100);
  };

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
        // Real-time browser push (sound + OS popup). Suppressed only when the user
        // is actively viewing the notifications panel in a visible tab.
        const suppress = notifOpenRef.current && document.visibilityState === 'visible';
        pushNotify(newNotif, {
          suppress,
          onClick: (n) => { if (n.leadId) setPanLead(n.leadId); },
        });
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
      // Load from Supabase, then MERGE with local so records created locally but
      // not yet synced (e.g. a fresh import) survive the reload instead of being
      // clobbered by the cloud snapshot. Fall back to local/seed if cloud empty.
      const sbData = await sbLoad();
      const local = getDB();
      let freshDB;
      if (sbData && sbData.users && sbData.users.length) {
        freshDB = (local && local.users && local.users.length) ? mergeDB(sbData, local) : sbData;
      } else {
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
      // Re-purge from the cloud any tombstoned lead that crept back (other tab/device)
      reconcileDeletions(freshDB, sbData && sbData.leads);
      // Drop legacy demo seed accounts so they don't re-sync to the cloud
      purgeDemoSeed(freshDB);
      // Remove duplicate leads (keep newest) so the app stops re-uploading dupes
      dedupeLeads(freshDB);
      // Multi-tenant backfill: ensure companies + companyId on existing data, and a master account
      migrateTenancy(freshDB);
      checkFollowUpReminders(freshDB);
      saveDB(freshDB);
      expireHolds(); // auto-release expired holds (saves internally if any)
      refreshDB();

      // Fade out loading screen
      setLoading(false);
      setTimeout(() => setLoadVisible(false), 400);

      // Try to restore session
      const u = getSession();
      if (u) { setUser(u); if (u.role === ROLES.MASTER) setView('companies'); requestNotifyPermission(); }
    })();
  }, []);

  return (
    <>
      {loadVisible && <LoadingScreen visible={loading} />}
      {!user && !loading && !showLogin && <LandingPage onEnter={() => setShowLogin(true)} />}
      {!user && !loading && showLogin && <LoginPage onLogin={enterApp} onBack={() => setShowLogin(false)} />}
      {user && <AppShell />}
      {entering && <PostLoginLoader />}
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
      <DuplicateModal />
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
