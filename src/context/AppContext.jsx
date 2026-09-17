import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { getDB, getSession } from '../lib/db.js';
import { ROLES } from '../lib/constants.js';
import { waCanChat } from '../lib/wa.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Seeded from the cached session (a synchronous localStorage read) so a
  // returning user's shell renders on the first pass instead of after a
  // round-trip. Lazy initialisers — these run once, not per render.
  const [user, setUser] = useState(getSession);
  const [view, setView] = useState(() => (getSession()?.role === ROLES.MASTER ? 'companies' : 'dashboard'));
  const [tab, setTab] = useState(0);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('updated');
  const [search, setSearch] = useState('');
  const [panLead, setPanLead] = useState(null);
  const [modal, setModal] = useState(null);
  const [fwdTarget, setFwdTarget] = useState(null);
  const [tgtUser, setTgtUser] = useState(null);
  const [agentFilter, setAgentFilter] = useState(null);
  const [teamFilter, setTeamFilter] = useState(null);
  // The Customers header used to run its own count query, which knew nothing
  // about the filters on screen — so it reported the whole book while the table
  // below it listed a filtered subset, and the two numbers disagreed. LeadsView
  // owns the query, so it publishes its own totals here and the header just
  // renders them. null = not counted yet.
  const [leadCounts, setLeadCounts] = useState(null);
  const [propSel, setPropSel] = useState(null);   // property id for detail view
  const [propEdit, setPropEdit] = useState(null);  // property obj for edit, {} for new
  const [bookSel, setBookSel] = useState(null);    // booking id for detail modal
  const [createUserRoles, setCreateUserRoles] = useState([]);
  const [editUser, setEditUser] = useState(null);   // agent obj for edit-agent modal
  const [deleteUserId, setDeleteUserId] = useState(null);
  const [importData, setImportData] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [dbVersion, setDbVersion] = useState(0);
  const [credInfo, setCredInfo] = useState(null);
  // Default the global date filter to "All time" so an agent sees all of their
  // data on login. They can narrow to today/range via the date picker.
  const [dateRange, setDateRange] = useState({ preset: 'allTime', range: null });
  const [impersonator, setImpersonator] = useState(null); // the real admin while viewing as another account
  const [consoleAdmin, setConsoleAdmin] = useState(false); // open the project console straight into Admin catalog
  // WhatsApp chat config (wa_settings row) — loaded once on login. Null until then.
  const [waSettings, setWaSettings] = useState(null);
  const [waUnread, setWaUnread] = useState(0); // total unread across chat threads
  // Set by the lead panel's WhatsApp button; ConversationsView consumes it once
  // it has mounted, opening (or starting) that customer's thread.
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
  }, []);

  const refreshDB = useCallback(() => {
    setDbVersion(v => v + 1);
  }, []);

  const showToast = useCallback((msg, type = '') => {
    setToast({ msg, type, key: Date.now() });
  }, []);

  const openModal = useCallback((name) => setModal(name), []);
  const closeModal = useCallback(() => setModal(null), []);

  const nav = useCallback((v) => {
    setView(v);
    setTab(0);
    setStatusFilter('ALL');
    setSearch('');
    setAgentFilter(null);
    setTeamFilter(null);
    setSidebarOpen(false);
  }, []);

  const db = getDB();
  // Whether the signed-in account may see the Conversations section at all.
  const chatOk = waCanChat(user, waSettings);

  const value = {
    user, setUser,
    view, setView,
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
    bookSel, setBookSel,
    createUserRoles, setCreateUserRoles,
    editUser, setEditUser,
    deleteUserId, setDeleteUserId,
    importData, setImportData,
    sidebarOpen, setSidebarOpen,
    notifOpen, setNotifOpen,
    toast, showToast,
    dbVersion, refreshDB,
    credInfo, setCredInfo,
    dateRange, setDateRange,
    impersonator, impersonate, stopImpersonate,
    consoleAdmin, setConsoleAdmin,
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
