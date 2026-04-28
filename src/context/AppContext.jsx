import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { getDB } from '../lib/db.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [panLead, setPanLead] = useState(null);
  const [modal, setModal] = useState(null);
  const [fwdTarget, setFwdTarget] = useState(null);
  const [tgtUser, setTgtUser] = useState(null);
  const [agentFilter, setAgentFilter] = useState(null);
  const [teamFilter, setTeamFilter] = useState(null);
  const [createUserRoles, setCreateUserRoles] = useState([]);
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
    search, setSearch,
    panLead, setPanLead,
    modal, openModal, closeModal,
    fwdTarget, setFwdTarget,
    tgtUser, setTgtUser,
    agentFilter, setAgentFilter,
    teamFilter, setTeamFilter,
    createUserRoles, setCreateUserRoles,
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
