import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { getDB } from '../lib/db.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
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
  const [dateRange, setDateRange] = useState({ preset: 'allTime', range: null });
  const searchRef = useRef(null);

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
