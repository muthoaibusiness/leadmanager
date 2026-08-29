import { useState, useEffect, useRef } from 'react';
import { useApp } from './context/AppContext.jsx';
import { getDB, getUnreadCount, getSession, setSession, loginRemote, hasSessionId, saveDBDeferred, checkFollowUpReminders, getProperties, expireHolds, migrateTenancy, mergeDB, purgeDemoSeed, dedupeLeads, reconcileDeletions, applyRealtimeEvent, clearLocalDB, cacheBelongsTo, fetchSessionUser } from './lib/db.js';
import { seedDB, SEED_PROPERTIES, DEMO_PROPERTIES } from './lib/seed.js';
import { sbLoad, sbSubscribeAll } from './lib/supabase.js';
import { pushUnreadSummary, requestNotifyPermission } from './lib/pushNotify.js';
import { avc, ini, rlabel } from './lib/helpers.js';
import { ROLES, canSee, FEATURE_KEYS, effectiveRole } from './lib/constants.js';

import Mi from './components/Mi.jsx';
import { SignIn1 } from './components/ui/modern-stunning-sign-in.jsx';
import LoadingRadar from './components/LoadingRadar.jsx';
import LandingPage from './components/LandingPage.jsx';
import Sidebar from './components/Sidebar.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
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
import CalendarView from './components/views/CalendarView.jsx';
import CarpoolView from './components/views/CarpoolView.jsx';
import TeamView from './components/views/TeamView.jsx';
import UsersView from './components/views/UsersView.jsx';
import AccountsView from './components/views/AccountsView.jsx';
import RequestsView from './components/views/RequestsView.jsx';
import ProfileView from './components/views/ProfileView.jsx';
import PropertiesView from './components/views/PropertiesView.jsx';
import BookingsView from './components/views/BookingsView.jsx';
import PipelineView from './components/views/PipelineView.jsx';
import ClientsView from './components/views/ClientsView.jsx';
import ReportsView from './components/views/ReportsView.jsx';
import AgentPerformanceView from './components/views/AgentPerformanceView.jsx';

import AddLeadModal from './components/modals/AddLeadModal.jsx';
import ForwardModal from './components/modals/ForwardModal.jsx';
import RescheduleModal from './components/modals/RescheduleModal.jsx';
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
import ProjectConsole from './components/project/ProjectConsole.jsx';
import { migrateProjects, createProject } from './lib/projects.js';
import PropertyFormModal from './components/modals/PropertyFormModal.jsx';
import UnitBookingModal from './components/modals/UnitBookingModal.jsx';
import BookingModal from './components/modals/BookingModal.jsx';
import TransferLeadModal from './components/modals/TransferLeadModal.jsx';
import GlobalLoadingBar from './components/GlobalLoadingBar.jsx';

// ── Loading screen ──────────────────────────────────────────────────────────
function LoadingScreen({ visible }) {
  return (
    <div id="ld" className={visible ? '' : 'out'} style={visible ? {} : { pointerEvents: 'none' }}>
      <LoadingRadar />
    </div>
  );
}

// ── Post-login loader — radar sweep, no text ─────────────────────────────────
function PostLoginLoader() {
  return (
    <div className="pl-overlay">
      <LoadingRadar />
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

  const doLogin = async () => {
    if (!email || !pw) { setErr('Enter email and password.'); return; }
    setLoading(true);
    setErr('');
    // loginRemote checks the cached DB first, then falls back to a single
    // filtered row — so nothing has to be downloaded before this screen paints.
    const u = await loginRemote(email, pw);
    setLoading(false);
    if (!u) { setErr('Incorrect email or password.'); return; }
    setSession(u);
    onLogin(u);
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
      <span className="pg-div" />
      <NotifBell />
    </header>
  );
}

// ── In-body hero header (eyebrow + big title + subtitle + actions) ───────────
function PageHero() {
  const { user, view, agentFilter, teamFilter, setAgentFilter, setTeamFilter, setTab, setStatusFilter, setSearch, openModal, setCreateUserRoles, setPropEdit, setPropSel, setConsoleAdmin, dbVersion, leadCounts } = useApp();

  // The Customers count is NOT computed here. It has to agree with the table
  // underneath it, and the table's query is built from filters this component
  // cannot see — the Team Lead's agent picker, the admin's user picker, the
  // agent's My Leads / Forwarded tab, status, project, search. LeadsView runs
  // that query, so it publishes both numbers and this only renders them.
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
  const props = getProperties();
  const propAvail = props.filter(p => p.status !== 'SOLD_OUT').length;
  const teamAgents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === user.teamId).length;

  const META = {
    dashboard: { eyebrow: rlabel(user.role), title: 'Dashboard', sub: '' },
    leads: { eyebrow: 'Pipeline', title: 'Customers', sub: leadCounts?.total == null ? 'Counting…' : `${leadCounts.total} customers · ${leadCounts.active ?? 0} active` },
    calendar: { eyebrow: 'Schedule', title: 'Calendar', sub: 'Your scheduled meetings' },
    pipeline: { eyebrow: 'Sales', title: 'Pipeline', sub: 'Drag deals across stages' },
    clients: { eyebrow: 'Relationships', title: 'Contacts', sub: '360° customer view' },
    properties: { eyebrow: 'Catalog', title: 'Projects', sub: `${props.length} projects · ${propAvail} available` },
    reports: { eyebrow: 'Insights', title: 'Reports', sub: 'Live sales analytics' },
    agentperf: { eyebrow: 'Insights', title: 'Performance', sub: 'Per-role scorecards & funnels' },
    bookings: { eyebrow: 'Sales', title: 'Sales Activity', sub: 'Payments, instalments & dues' },
    team: { eyebrow: 'Team', title: 'My Team', sub: `${teamAgents} agents` },
    users: { eyebrow: 'Administration', title: 'Users', sub: `${db.users.length} accounts` },
    accounts: { eyebrow: 'Administration', title: 'Account Management', sub: 'Create & manage multiple accounts' },
    carpool: { eyebrow: 'Administration', title: 'Carpool Requests', sub: 'Approve agent ride requests' },
    requests: { eyebrow: 'Administration', title: 'Hold Requests', sub: 'Approve agent unit holds' },
    profile: { eyebrow: 'Account', title: 'My Profile', sub: 'Manage your details & avatar' },
    companies: { eyebrow: 'Master Admin', title: 'Companies', sub: 'Company-wise overview' },
  };
  let { eyebrow, title, sub } = META[view] || { eyebrow: '', title: view, sub: '' };
  if (user.role === ROLES.MASTER) ({ eyebrow, title, sub } = META.companies); // master only ever sees the company overview
  if (drilled) {
    title = agentFilter && agentName ? agentName : (tlUser?.name || 'Team') + "'s Team";
    // A drill-down is the case where the count matters most, and it is now the
    // count of exactly what is listed below.
    sub = view === 'leads' && leadCounts?.total != null ? `${leadCounts.total} filtered customers` : 'Filtered customers';
  }

  // actions
  let actions = [];
  if (view === 'leads' && canSee(user, 'add_customer')) {
    actions.push(<button key="add-lead" className="btn btn-p" onClick={() => openModal('add-lead')}><Mi>add</Mi>Add Customer</button>);
    actions.push(<button key="import" className="btn btn-g" onClick={() => openModal('import')}><Mi>upload</Mi>Import</button>);
  }
  // Duplicate checker button removed — dedup runs automatically on load/import.
  // Executives are created by a Team Lead, alongside the two agent roles, so they land
  // in that Team Lead's team (createUserFn stamps the creator's teamId). Management only
  // creates Team Leads, each of which starts a team of its own.
  if (view === 'team' && user.role === ROLES.TL) actions.push(<button key="add-agent" className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.IA, ROLES.MA, ROLES.EXEC]); openModal('create-user'); }}><Mi>person_add</Mi>Add Agent</button>);
  if (view === 'users' && user.role === ROLES.MGMT) actions.push(<button key="add-user" className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.TL]); openModal('create-user'); }}><Mi>person_add</Mi>Add User</button>);
  if (view === 'properties' && user.role === ROLES.MGMT) actions.push(<button key="add-prop" className="btn btn-p" onClick={() => { const nid = createProject({ name: '', companyId: user.companyId }); setConsoleAdmin(true); setPropSel(nid); openModal('project-console'); }}><Mi>add</Mi>Add Property</button>);

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
    // Executives operate as the agent role their granted features imply.
    const er = effectiveRole(user);
    if (er === ROLES.IA) return <InitialAgentDash />;
    if (er === ROLES.MA) return <MeetingAgentDash />;
    if (er === ROLES.TL) return <TeamLeadDash />;
    if (er === ROLES.MGMT) return <ManagementDash />;
    return null; // no dashboard resolved
  }
  if (view === 'leads') return <LeadsView />;
  if (view === 'calendar') return <CalendarView />;
  if (view === 'pipeline') return <PipelineView />;
  if (view === 'clients') return <ClientsView />;
  if (view === 'properties') return <PropertiesView />;
  if (view === 'bookings') return <BookingsView />;
  if (view === 'reports') return <ReportsView />;
  if (view === 'agentperf') return <AgentPerformanceView />;
  if (view === 'team') return <TeamView />;
  if (view === 'users') return <UsersView />;
  if (view === 'accounts') return <AccountsView />;
  if (view === 'requests') return <RequestsView />;
  if (view === 'carpool') return <CarpoolView />;
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
      <ThemeToggle />
    </div>
  );
}

// True only when a session id is stored but the cached DB cannot resolve it
// (cleared storage, new device, or a snapshot trimmed by persistLocal's quota
// fallback) — the single boot path that has to wait on the network.
const needsBootFetch = () => hasSessionId() && !getSession();

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { user, setUser, view, setView, refreshDB, searchRef, panLead, setPanLead, closeModal, modal, setSearch, setNotifOpen } = useApp();
  // The loader is only for the one case that genuinely has nothing to render:
  // a stored session id whose user is NOT in the local cache. An anonymous
  // visitor gets Landing/Login and a returning user gets the shell, both on the
  // very first render — no loading state, no cascade, and no network.
  const [loading, setLoading] = useState(needsBootFetch);
  const [loadVisible, setLoadVisible] = useState(needsBootFetch);
  const [showLogin, setShowLogin] = useState(false); // landing → login gate
  const [entering, setEntering] = useState(false);    // brief loader after login
  const initialized = useRef(false);

  // Pull the cloud snapshot, reconcile it against the local cache, and run the
  // one-time migrations. Deliberately NOT on the first-paint path: the shell
  // renders from the localStorage cache and this refreshes it underneath.
  // `who` is the account to load for. The cloud read is scoped to that user's
  // company (sbLoad), so it MUST be known before fetching — passing nothing
  // falls back to the old unfiltered load, which is what MASTER gets.
  const hydrateFromCloud = async (who) => {
    const forUser = who || user || getSession();
    // The cached snapshot now holds one company's rows. Handing it to a
    // different account is a leak, not a head start: mergeDB unions local into
    // remote and mergeCloudFirst keeps local-only users/teams forever, so every
    // row of the previous tenant would survive the next login. clearSession
    // covers a deliberate sign-out; this covers a closed browser or a crash.
    if (forUser && !cacheBelongsTo(forUser.id)) clearLocalDB();
    // Load from Supabase, then MERGE with local so records created locally but
    // not yet synced (e.g. a fresh import) survive the reload instead of being
    // clobbered by the cloud snapshot. Fall back to local/seed if cloud empty.
    const sbData = await sbLoad(forUser);
    const local = getDB();
    let freshDB;
    if (sbData && sbData.users && sbData.users.length) {
      freshDB = (local && local.users && local.users.length) ? mergeDB(sbData, local) : sbData;
    } else {
      freshDB = (local.users && local.users.length) ? local : seedDB();
    }
    // sbLoad deliberately OMITS `leads` (see the note there) so mergeDB can tell
    // "the cloud was not asked" from "the cloud says none". On a cold cache the
    // merge is skipped entirely and sbData is used raw — which would leave
    // freshDB.leads undefined and take down everything downstream that iterates
    // it. checkFollowUpReminders did exactly that, and because the whole
    // hydrate is one async function, the throw silently skipped the save: the
    // users and teams it had just fetched never reached the store, which is why
    // the admin account switcher and the Users / Accounts tabs came up empty.
    if (!freshDB.leads) freshDB.leads = local.leads || [];
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
    // Multi-tenant backfill: ensure companies + companyId on existing data, and a master account.
    // Passing the user keeps it from inventing a 'c1' company or a master account
    // out of a snapshot that only ever contained one company — see migrateTenancy.
    migrateTenancy(freshDB, forUser);
    migrateProjects(freshDB); // backfill storefront fields (variants/media/fastClose)
    checkFollowUpReminders(freshDB);
    saveDBDeferred(freshDB); // in-memory now, localStorage write on an idle frame
    expireHolds(); // auto-release expired holds (saves internally if any)
    refreshDB();
  };

  // #ld fades out over `transition: opacity .4s`; unmount once that finishes.
  const revealApp = () => {
    setLoading(false);
    setTimeout(() => setLoadVisible(false), 400);
  };

  const signIn = (u) => {
    setUser(u);
    if (u.role === ROLES.MASTER) setView('companies');
    requestNotifyPermission(); // ask for browser push permission on login
  };

  // The app's only browser push: one summary of everything still unread, sent
  // once per page load after the data is in. Individual notifications stay
  // silent — they show up in the bell.
  const summarizeUnread = (who) => {
    const u = who || user || getSession();
    if (!u) return;
    pushUnreadSummary(getUnreadCount(u.id), {
      onClick: () => setNotifOpen(true),
    });
  };

  // Reveal the app as soon as there is something to show. A returning user has
  // a warm cache and goes straight in; a first login on a new browser has no
  // data at all, so the loader stays up for the real fetch rather than for a
  // fixed timer.
  const enterApp = (u) => {
    signIn(u);
    // A cache belonging to somebody else is not a warm cache — it is the
    // previous tenant's data, and rendering from it would flash their rows.
    if (!cacheBelongsTo(u.id)) clearLocalDB();
    refreshDB();
    // "Warm" used to mean "the cache holds more than one user". Under per-account
    // scoping an agent's snapshot holds exactly ONE user — their own — so that
    // test is now always false and every login would sit behind the loader.
    // Leads are the real signal that there is something to render.
    const warm = (getDB().leads || []).length > 0;
    if (warm) {
      hydrateFromCloud(u).finally(() => summarizeUnread(u)); // refresh underneath, nothing blocks
      return;
    }
    setEntering(true);
    hydrateFromCloud(u).finally(() => { setEntering(false); summarizeUnread(u); });
  };

  // Real-time subscription, scoped to the signed-in account's company (MASTER
  // stays unfiltered). Deferred past first paint: it opens a socket across 10
  // tables and would otherwise contend with hydrateFromCloud for the connection
  // while the shell is still painting.
  useEffect(() => {
    if (!user) return;
    let unsub = null;
    let cancelled = false; // the effect can tear down before the idle callback runs

    const open = () => {
      if (cancelled) return;
      unsub = sbSubscribeAll((table, type, record, oldRecord) => {
        if (import.meta.env.DEV) console.log(`[Realtime] ${type} ${table}`, record || oldRecord);
        // applyRealtimeEvent re-checks the tenant client-side: the server filter
        // covers INSERT/UPDATE only, since DELETE is subscribed unfiltered.
        const changed = applyRealtimeEvent(table, type, record, oldRecord, user);
        if (changed) {
          refreshDB();
          // No per-notification OS popup: new notifications land in the in-app
          // bell only. The single push is the startup unread summary below.
        }
      }, user);
    };

    if (typeof requestIdleCallback === 'function') requestIdleCallback(open, { timeout: 2000 });
    else setTimeout(open, 0);

    return () => { cancelled = true; if (unsub) unsub(); };
  }, [user?.id]);

  // Auto-release expired unit holds every minute
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { if (expireHolds()) refreshDB(); }, 60000);
    return () => clearInterval(t);
  }, [user?.id]);

  // Keep the user on a view they're allowed to see (e.g. Executives with no
  // dashboard land on their first granted feature instead of a forbidden page).
  useEffect(() => {
    if (!user || !view) return;
    if (!canSee(user, view)) {
      const first = FEATURE_KEYS.find(k => canSee(user, k)) || 'profile';
      setView(first);
    }
  }, [user?.id, view, user?.allowedFeatures]);

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

    // No session id: Landing/Login are already on screen via the seeded state
    // above. Nothing is fetched until the user submits credentials — see
    // loginRemote, which pulls a single filtered row instead of every user.
    if (!hasSessionId()) return;

    const cached = getSession(); // resolves the stored id against the cached users
    if (cached) {
      // Warm cache: the shell is already rendering from it (AppProvider seeded
      // `user` from the same read). Just ask for push permission and refresh
      // the data underneath.
      requestNotifyPermission();
      hydrateFromCloud(cached).finally(() => summarizeUnread(cached));
      return;
    }

    // Session id present but the cache is cold (cleared storage, new device, or
    // a snapshot trimmed by persistLocal's quota fallback). The session cannot
    // be resolved without the users table, so this is the one path that waits.
    //
    // The load is scoped by company, so it needs the user before it can build
    // its filters — and the cache is exactly what cannot supply one here. Fetch
    // that single row by primary key first; falling back to the unfiltered load
    // if it fails keeps a broken network from locking anyone out.
    (async () => {
      const sid = JSON.parse(localStorage.getItem('pcrm_sess') || 'null')?.id;
      const who = await fetchSessionUser(sid);
      await hydrateFromCloud(who);
      const u = getSession();
      if (u) signIn(u);
      revealApp();
      if (u) summarizeUnread(u);
    })();
  }, []);

  return (
    <>
      {/* Speaks for every fetch in the app — see GlobalLoadingBar / netActivity. */}
      <GlobalLoadingBar />
      {loadVisible && <LoadingScreen visible={loading} />}
      {!user && !loading && !showLogin && <LandingPage onEnter={() => setShowLogin(true)} />}
      {!user && !loading && showLogin && <LoginPage onLogin={enterApp} onBack={() => setShowLogin(false)} />}
      {user && <AppShell />}
      {entering && <PostLoginLoader />}
      <LeadPanel />
      {/* Modals */}
      <AddLeadModal />
      <ForwardModal />
      <RescheduleModal />
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
      <ProjectConsole />
      <PropertyFormModal />
      <UnitBookingModal />
      <BookingModal />
      <TransferLeadModal />
      <Toast />
    </>
  );
}
