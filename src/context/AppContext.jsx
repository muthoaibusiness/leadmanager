import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { getDB, getSession } from '../lib/db.js';
import { DRAWER_MQ } from '../lib/constants.js';
import { readBoot } from '../lib/navHistory.js';
import useNavHistory, { replaceNextPage } from '../hooks/useNavHistory.js';
import { waCanChat } from '../lib/wa.js';
import { claimLead, isQuotaLimited } from '../lib/leadQuota.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Seeded from the cached session (a synchronous localStorage read) so a
  // returning user's shell renders on the first pass instead of after a
  // round-trip. Lazy initialisers — these run once, not per render.
  const [user, setUser] = useState(getSession);
  // The page to open on: this tab's history entry after a reload, a #/view
  // URL, or home (see readBoot / useNavHistory).
  const [boot] = useState(readBoot);
  const [view, setView] = useState(boot.snap.view);
  const [tab, setTab] = useState(boot.snap.tab);
  const [statusFilter, setStatusFilter] = useState(boot.snap.statusFilter);
  const [sortBy, setSortBy] = useState(boot.snap.sortBy);
  const [search, setSearch] = useState(boot.snap.search);
  const [panLead, setPanLeadRaw] = useState(null);
  const [modal, setModal] = useState(null);
  const [fwdTarget, setFwdTarget] = useState(null);
  const [tgtUser, setTgtUser] = useState(null);
  const [agentFilter, setAgentFilter] = useState(boot.snap.agentFilter);
  const [teamFilter, setTeamFilter] = useState(boot.snap.teamFilter);
  // The Customers header used to run its own count query, which knew nothing
  // about the filters on screen — so it reported the whole book while the table
  // below it listed a filtered subset, and the two numbers disagreed. LeadsView
  // owns the query, so it publishes its own totals here and the header just
  // renders them. null = not counted yet.
  const [leadCounts, setLeadCounts] = useState(null);
  const [propSel, setPropSel] = useState(null);   // property id for detail view
  const [propEdit, setPropEdit] = useState(null);  // property obj for edit, {} for new
  const [propDraft, setPropDraft] = useState(null); // unsaved new project (Add Property) — stored only once saved
  // Projects → Available Units: which tab the Projects page shows, the project
  // and floor plan picked there, and the plan open in the floor plan editor
  // ({ projectId, planId } — planId null for a new plan).
  const [projTab, setProjTab] = useState(boot.snap.projTab); // 'list' | 'units'
  const [planSel, setPlanSel] = useState({ projectId: null, planId: null });
  const [planEdit, setPlanEdit] = useState(null);
  const [bookSel, setBookSel] = useState(null);    // booking id for detail modal
  const [createUserRoles, setCreateUserRoles] = useState([]);
  const [editUser, setEditUser] = useState(null);   // agent obj for edit-agent modal
  const [deleteUserId, setDeleteUserId] = useState(null);
  const [importData, setImportData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // the ≤1023px drawer
  // Desktop (≥1024px) can collapse the docked sidebar away. Read before the
  // first paint, so a collapsed sidebar is simply absent on load instead of
  // sliding shut; written by its setter, never by an effect.
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    try { return localStorage.getItem('sidebar') === 'collapsed'; } catch { return false; }
  });
  // Mirrors sidebarCollapsed for toggleSidebar, which can then stay stable.
  const collapsedRef = useRef(sidebarCollapsed);
  const [notifOpen, setNotifOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [dbVersion, setDbVersion] = useState(0);
  const [credInfo, setCredInfo] = useState(null);
  // Default the global date filter to "All time" so an agent sees all of their
  // data on login. They can narrow to today/range via the date picker.
  const [dateRange, setDateRange] = useState({ preset: 'allTime', range: null });
  const [impersonator, setImpersonator] = useState(null); // the real admin while viewing as another account
  const [consoleAdmin, setConsoleAdmin] = useState(false); // open the project console straight into Admin catalog
  const [consoleUnit, setConsoleUnit] = useState(null); // { projectId, variantId, unitId } the console opens with already picked (Available Units → Continue)
  // WhatsApp chat config (wa_settings row) — loaded once on login. Null until then.
  const [waSettings, setWaSettings] = useState(null);
  const [waUnread, setWaUnread] = useState(0); // total unread across chat threads
  const [chatTarget, setChatTarget] = useState(null);
  const searchRef = useRef(null);

  // Admin account switcher — become any account without email/password.
  // The session is never changed, so a page reload always returns to the real admin.
  const impersonate = useCallback((target) => {
    if (!target) return;
    setImpersonator(prev => prev || user);
    setUser(target);
    setView(target.role === 'MASTER' ? 'companies' : 'dashboard');
    setSidebarOpen(false);
  }, [user]);

  const stopImpersonate = useCallback(() => {
    setImpersonator(prev => {
      if (prev) { setUser(prev); setView(prev.role === 'MASTER' ? 'companies' : 'dashboard'); }
      return null;
    });
    setSidebarOpen(false);
  }, []);

  const setSidebarCollapsed = useCallback((v) => {
    collapsedRef.current = v;
    setSidebarCollapsedState(v);
    try { localStorage.setItem('sidebar', v ? 'collapsed' : 'expanded'); } catch { /* storage blocked: this session only */ }
  }, []);

  // Show/hide the sidebar in whichever layout is on screen: below 1024px it is
  // the overlay drawer (sidebarOpen), from 1024px the docked sidebar collapses.
  const setSidebarShown = useCallback((show) => {
    if (window.matchMedia(DRAWER_MQ).matches) setSidebarOpen(show);
    else setSidebarCollapsed(!show);
  }, [setSidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(DRAWER_MQ).matches) setSidebarOpen(o => !o);
    else setSidebarCollapsed(!collapsedRef.current);
  }, [setSidebarCollapsed]);

  // Widening the window past the drawer breakpoint closes the drawer, so its
  // backdrop and the inert page behind it never linger over the docked layout.
  useEffect(() => {
    const mq = window.matchMedia(DRAWER_MQ);
    const onChange = (e) => { if (!e.matches) setSidebarOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const refreshDB = useCallback(() => {
    setDbVersion(v => v + 1);
  }, []);

  const showToast = useCallback((msg, type = '') => {
    setToast({ msg, type, key: Date.now() });
  }, []);

  const openModal = useCallback((name) => setModal(name), []);
  // Single gate for every way of opening a lead — enforces the per-agent lead quota.
  const setPanLead = useCallback((id) => {
    if (!id || !isQuotaLimited(user)) { setPanLeadRaw(id); return; }
    claimLead(user, id).then(r => { if (r.ok) setPanLeadRaw(id); else setModal('upgrade-plan'); });
  }, [user]);
  const closeModal = useCallback(() => setModal(null), []);

  const nav = useCallback((v) => {
    setView(v);
    setProjTab('list'); // the sidebar's Projects opens the project list
    setTab(0);
    setStatusFilter('ALL');
    setSearch('');
    setAgentFilter(null);
    setTeamFilter(null);
    setSidebarOpen(false);
  }, []);

  // A redirect (a page this account may not see) replaces the history entry
  // instead of adding one, so Back does not return to the forbidden page.
  const replaceView = useCallback((v) => { replaceNextPage(); setView(v); }, []);

  // Put a history entry's page back on screen (Back/Forward, the header's Back).
  const applySnap = useCallback((s) => {
    setView(s.view);
    setProjTab(s.projTab);
    setAgentFilter(s.agentFilter);
    setTeamFilter(s.teamFilter);
    setTab(s.tab);
    setStatusFilter(s.statusFilter);
    setSortBy(s.sortBy);
    setSearch(s.search);
    setSidebarOpen(false);
  }, []);
  const closeAll = useCallback(() => {
    setModal(null);
    setPanLeadRaw(null);
    setNotifOpen(false);
    setSidebarOpen(false);
  }, []);
  const closeNotif = useCallback(() => setNotifOpen(false), []);

  const db = getDB();
  const { pageId, back: navBack, trail: navTrail } = useNavHistory({
    boot, user, db, apply: applySnap, closeAll, closeNotif,
    snap: { view, projTab, agentFilter, teamFilter, tab, statusFilter, sortBy, search },
    overlays: { modal, panLead, notifOpen, sidebarOpen },
  });
  // Whether the signed-in account may see the Conversations section at all.
  const chatOk = waCanChat(user, waSettings);

  const value = {
    user, setUser,
    view, setView, replaceView,
    pageId, navBack, navTrail,
    tab, setTab,
    statusFilter, setStatusFilter,
    sortBy, setSortBy,
    search, setSearch,
    panLead, setPanLead,
    modal, openModal, closeModal,
    fwdTarget, setFwdTarget,
    tgtUser, setTgtUser,
    agentFilter, setAgentFilter,
    teamFilter, setTeamFilter,
    leadCounts, setLeadCounts,
    propSel, setPropSel,
    propEdit, setPropEdit,
    propDraft, setPropDraft,
    projTab, setProjTab,
    planSel, setPlanSel,
    planEdit, setPlanEdit,
    bookSel, setBookSel,
    createUserRoles, setCreateUserRoles,
    editUser, setEditUser,
    deleteUserId, setDeleteUserId,
    importData, setImportData,
    sidebarOpen, setSidebarOpen,
    sidebarCollapsed, setSidebarShown, toggleSidebar,
    notifOpen, setNotifOpen,
    toast, showToast,
    dbVersion, refreshDB,
    credInfo, setCredInfo,
    dateRange, setDateRange,
    impersonator, impersonate, stopImpersonate,
    consoleAdmin, setConsoleAdmin,
    consoleUnit, setConsoleUnit,
    waSettings, setWaSettings, chatOk,
    waUnread, setWaUnread,
    chatTarget, setChatTarget,
    searchRef,
    nav,
    db,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
