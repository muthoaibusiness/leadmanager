import { useState, useMemo, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import useNavState from '../../hooks/useNavState.js';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, addNotifs, unassignDeletedUser } from '../../lib/db.js';
import { createAccount, deleteAccount } from '../../lib/accessAdmin.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES, canSee } from '../../lib/constants.js';
import { useProjectToast } from '../project/projectToast.js';
import { EditBtn, DelBtn } from '../UserRow.jsx';
import { Menu, MenuItem, MenuLabel, MenuRadio, MenuRadioGroup, MenuSep } from '../ui/menu.jsx';
import useLeadCounts from '../../hooks/useLeadCounts.js';
import useOpenUserLeads from '../../hooks/useOpenUserLeads.js';
import { eq } from '../../lib/leadQuery.js';
import AccessPanel from '../AccessPanel.jsx';
import '../finance/finance.css'; // .fin-tabs

// Users & Accounts — one Management page for the whole company roster.
// Replaces the old Users (team cards) and Accounts (bulk create + flat list)
// tabs: every person is a row in one table, a row expands to what the team
// card used to show (team stats, team mates), and bulk create sits above it.

const ROLE_OPTS = [
  { v: ROLES.AGENT, l: 'Agent' },
  { v: ROLES.MA, l: 'Meeting Agent' },
  { v: ROLES.TL, l: 'Team Lead' },
  { v: ROLES.MGMT, l: 'Management' },
];
const ROLE_FILTER_OPTS = [...ROLE_OPTS, { v: ROLES.EXEC, l: 'Executive' }];
const PAGE = 10;
const blankRow = () => ({ name: '', email: '', phone: '', role: ROLES.AGENT, password: '', teamId: '' });
// Role pill, one colour per role; Management carries the bolt.
const ROLE_TONE = { MANAGEMENT: 'mgmt', TEAM_LEAD: 'tl', AGENT: 'agent', MEETING_AGENT: 'agent', EXECUTIVE: 'exec' };
const RoleBadge = ({ role }) => (
  <span className={`uct-role t-${ROLE_TONE[role] || 'agent'}`}>
    {role === ROLES.MGMT ? <Mi aria-hidden="true">bolt</Mi> : <i aria-hidden="true" />}
    {rlabel(role)}
  </span>
);
// "1 account" / "3 accounts" — never "account(s)".
const nAccounts = (n) => `${n} account${n === 1 ? '' : 's'}`;
const nRows = (n) => `${n} row${n === 1 ? '' : 's'}`;
// Team Lead first, then Agent, Executive, Management, so a team
// reads top-down when the table is sorted by team.
const ROLE_ORDER = { TEAM_LEAD: 0, AGENT: 1, MEETING_AGENT: 1, EXECUTIVE: 2, MANAGEMENT: 3 };
const toggleIn = (set, id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

// Roster orders. 'team' is the default: teams A–Z, each read top-down by
// ROLE_ORDER. 'role' goes by seniority.
const SORT_OPTS = [
  { v: 'team', l: 'Team' },
  { v: 'name', l: 'Name (A–Z)' },
  { v: 'name-desc', l: 'Name (Z–A)' },
  { v: 'role', l: 'Role' },
];
const SENIORITY = { MANAGEMENT: 0, TEAM_LEAD: 1, AGENT: 2, MEETING_AGENT: 2, EXECUTIVE: 3 };
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');

// Export: the filtered roster, every page. Passwords are never exported.
const EXPORT_COLS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['role', 'Role'], ['team', 'Team'], ['status', 'Status']];
// Quoted CSV cell. A leading = + - @ would run as a formula in Excel, so it
// gets a ' prefix (phone numbers like +880… included).
const csvCell = (v) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};
const download = (text, type, name) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Rows rise in, staggered, whenever the page, filters or order change.
const LIST_V = { visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } };
const ROW_V = {
  hidden: { opacity: 0, y: 20, scale: 0.98, filter: 'blur(4px)' },
  visible: {
    opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 400, damping: 25, mass: 0.7 },
    transitionEnd: { filter: 'none' },   // a leftover blur(0px) would keep each row on its own layer
  },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

export default function AccountsView() {
  const { user, dbVersion, refreshDB, showToast, openModal, setCreateUserRoles, modal, panLead } = useApp();
  const db = getDB();
  const openLeads = useOpenUserLeads();
  // company sandbox: a Management admin only ever sees/manages their own company
  // (tolerate missing companyId so unsynced/legacy rows don't disappear)
  const sameCo = (x) => !user.companyId || !x || x === user.companyId;
  const coUsers = db.users.filter(u => sameCo(u.companyId) && u.role !== ROLES.MASTER);
  const teams = (db.teams || []).filter(t => sameCo(t.companyId));
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]));
  const teamByLead = Object.fromEntries(teams.map(t => [t.leadId, t]));
  // A Team Lead heads a team; everyone else is stamped with one.
  const teamOf = (u) => (u.role === ROLES.TL ? teamByLead[u.id] : teamById[u.teamId]) || null;

  const [rows, setRows] = useState(() => [blankRow(), blankRow(), blankRow()]);
  const [result, setResult] = useState(null);     // { created, errors }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [q, setQ] = useNavState('accounts.q', '');
  const [roleFilter, setRoleFilter] = useNavState('accounts.role', 'ALL');
  const [teamFilter, setTeamFilter] = useNavState('accounts.team', 'ALL');
  const [sort, setSort] = useNavState('accounts.sort', 'team');
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useNavState('accounts.page', 0);
  const [tab, setTab] = useNavState('accounts.tab', 'users');
  // The View card: an id, so a deleted account simply closes it.
  const [detailId, setDetailId] = useState(null);
  const viewRef = useRef(null);   // the View button that opened the card; focus goes back to it
  const reduceMotion = useReducedMotion();
  const toast = useProjectToast({ always: true });
  const detail = detailId ? coUsers.find(u => u.id === detailId) : null;

  const closeDetail = () => { setDetailId(null); viewRef.current?.focus(); };
  // Esc closes the card, unless a modal opened from it (Edit, Delete) is on top:
  // App's own Esc handler closes that one first.
  useEffect(() => {
    if (!detail) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || modal || panLead) return;
      setDetailId(null);
      viewRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, modal, panLead]);

  // ── KPI counts ──
  const counts = useMemo(() => {
    const c = { total: coUsers.length, [ROLES.TL]: 0, [ROLES.AGENT]: 0, [ROLES.MGMT]: 0 };
    coUsers.forEach(u => { c[u.role] = (c[u.role] || 0) + 1; });
    return c;
  }, [dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- coUsers is re-derived from db each render; dbVersion tracks it

  // Won / Active per team, shown in a Team Lead's View card. Two count
  // queries per team rather than downloading the company's leads.
  const teamKey = teams.map(t => t.id).join();
  const teamQ = useMemo(() => {
    const spec = {};
    teams.forEach(t => {
      spec['won:' + t.id] = { user, involved: true, extra: [eq('team_id', t.id), eq('status', 'DEAL_CLOSED_WON')] };
      spec['act:' + t.id] = { user, involved: true, extra: [eq('team_id', t.id), 'status.not.in.(DEAL_CLOSED_WON,DEAL_CLOSED_LOST,NOT_INTERESTED)'] };
    });
    return spec;
  }, [user, teamKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const leadCounts = useLeadCounts(teamQ);
  const num = (k) => (leadCounts[k] == null ? '—' : leadCounts[k]);

  // ── bulk-create row editing ──
  const setRow = (i, k, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const addRow = () => setRows(rs => [...rs, blankRow()]);
  const addFive = () => setRows(rs => [...rs, ...Array.from({ length: 5 }, blankRow)]);
  const delRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : [blankRow()]);

  const needsTeam = (role) => role === ROLES.AGENT;

  // ── paste parser: name, email, phone, role ──
  const applyPaste = () => {
    const parsed = paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const [name = '', email = '', phone = '', roleRaw = ''] = line.split(/[,\t]/).map(s => s.trim());
      const rl = roleRaw.toLowerCase();
      // initial / meeting / agent (or blank) all mean Agent now.
      let role = ROLES.AGENT;
      if (rl.startsWith('team') || rl === 'tl') role = ROLES.TL;
      else if (rl.startsWith('manage') || rl === 'mgmt') role = ROLES.MGMT;
      return { ...blankRow(), name, email, phone, role };
    });
    if (parsed.length) { setRows(parsed); setPasteOpen(false); setPaste(''); showToast(`${parsed.length} rows loaded`, 'ok'); }
  };

  // ── create all ──
  // Create all reports through goey-toast (top centre), like the Projects tab.
  const createAll = async () => {
    const filled = rows.filter(r => r.name.trim() || r.email.trim());
    if (!filled.length) { toast.warning('Add at least one account', 'Enter a name and email in any row.'); return; }
    // One access-admin create per row, in order; the server checks the email
    // across every tenant and the role against the caller. Each row needs its
    // own password (10+ characters): there is no shared default any more.
    const res = { created: [], errors: [] };
    for (const [i, r] of filled.entries()) {
      const name = r.name.trim(); const email = r.email.trim();
      const out = await createAccount({ name, email, phone: r.phone.trim(), role: r.role, password: r.password, teamId: r.teamId || undefined });
      if (out.ok) res.created.push({ id: out.user.id, name, email, pass: r.password, role: r.role, roleLabel: rlabel(r.role) });
      else res.errors.push({ line: i + 1, name: name || email || `(row ${i + 1})`, reason: out.error });
    }
    setResult(res);
    if (res.created.length) {
      // notify management + relevant TLs
      const newDb = getDB();
      const mgmtIds = newDb.users.filter(u => u.role === ROLES.MGMT && u.id !== user.id).map(u => u.id);
      addNotifs(mgmtIds.map(uid => ({ userId: uid, type: 'NEW_USER', message: `${res.created.length} new account(s) created`, leadId: null })), user);
      setRows([blankRow(), blankRow(), blankRow()]);
      refreshDB();
      toast.success(
        `${nAccounts(res.created.length)} created`,
        res.errors.length
          ? `${nRows(res.errors.length)} skipped — see the list below.`
          : 'Their login details are listed below.',
      );
    } else {
      toast.error('No accounts created', 'Fix the rows listed below and try again.');
    }
  };

  const copyCreds = () => {
    if (!result?.created?.length) return;
    const txt = result.created.map(c => `${c.name}\t${c.email}\t${c.pass}\t${c.roleLabel}`).join('\n');
    navigator.clipboard?.writeText(txt);
    showToast('Credentials copied', 'ok');
  };

  // ── roster ──
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return coUsers
      .filter(u => roleFilter === 'ALL' || u.role === roleFilter)
      .filter(u => {
        if (teamFilter === 'ALL') return true;
        const t = teamOf(u);
        return teamFilter === 'NONE' ? !t : t?.id === teamFilter;
      })
      .filter(u => !term || (u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term) || (u.phone || '').includes(term))
      .sort((a, b) => {
        if (sort === 'name') return byName(a, b);
        if (sort === 'name-desc') return byName(b, a);
        if (sort === 'role') return (SENIORITY[a.role] ?? 9) - (SENIORITY[b.role] ?? 9) || byName(a, b);
        const ta = teamOf(a)?.name, tb = teamOf(b)?.name;
        if (ta !== tb) return !ta ? 1 : !tb ? -1 : ta.localeCompare(tb);
        return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || byName(a, b);
      });
  }, [dbVersion, q, roleFilter, teamFilter, sort]); // eslint-disable-line react-hooks/exhaustive-deps -- coUsers is re-derived from db each render; dbVersion tracks it

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const curPage = Math.min(page, pages - 1);
  const pageRows = list.slice(curPage * PAGE, curPage * PAGE + PAGE);

  // Selection spans the whole filtered list; your own row is never selectable
  // (you can't remove yourself).
  const selectable = list.filter(u => u.id !== user.id);
  const allOn = selectable.length > 0 && selectable.every(u => selected.has(u.id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(selectable.map(u => u.id)));
  const toggleOne = (id) => setSelected(s => toggleIn(s, id));
  const nFilters = (roleFilter !== 'ALL') + (teamFilter !== 'ALL');

  const exportAs = (kind) => {
    const out = list.map(u => ({
      name: u.name || '', email: u.email || '', phone: u.phone || '', role: rlabel(u.role),
      team: teamOf(u)?.name || '', status: u.isActive === false ? 'Inactive' : 'Active',
    }));
    const name = `users-${new Date().toLocaleDateString('en-CA')}.${kind}`;   // en-CA: local YYYY-MM-DD
    if (kind === 'json') { download(JSON.stringify(out, null, 2), 'application/json', name); return; }
    const lines = [EXPORT_COLS.map(([, l]) => l), ...out.map(r => EXPORT_COLS.map(([k]) => r[k]))];
    // BOM: Excel then reads the file as UTF-8 (Bangla names stay intact).
    download('﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8', name);
  };

  // One access-admin call per account; the toast counts what the server
  // actually removed and names the first refusal.
  const removeSelected = async () => {
    const ids = [...selected].filter(id => id !== user.id && coUsers.some(u => u.id === id));
    if (!ids.length) return;
    const names = ids.map(id => coUsers.find(u => u.id === id)?.name).filter(Boolean);
    if (!window.confirm(`Remove ${nAccounts(ids.length)}?\n\n${names.join(', ')}\n\nTheir leads become unassigned; a Team Lead's team is removed too. This cannot be undone.`)) return;
    let done = 0; let firstErr = '';
    for (const id of ids) {
      const r = await deleteAccount(id);
      if (r.ok) { unassignDeletedUser(id, user); done++; } else if (!firstErr) firstErr = r.error;
    }
    setSelected(new Set());
    refreshDB();
    if (done) toast.success(`${nAccounts(done)} removed`, firstErr ? `${nAccounts(ids.length - done)} not removed: ${firstErr}` : 'They can no longer sign in.');
    else toast.error('Nothing removed', firstErr);
  };

  // After every hook, so the hook order never depends on the role.
  // Same rule as the nav entry and the access-admin function (access-rules.js).
  if (!canSee(user, 'accounts')) return null;

  // The View card: contact details, then what the old team card showed, per role.
  const renderDetail = (u) => {
    const team = teamOf(u);
    const lead = team ? coUsers.find(m => m.id === team.leadId) : null;
    const members = team ? coUsers.filter(m => m.teamId === team.id && m.id !== team.leadId && [ROLES.AGENT, ROLES.EXEC].includes(m.role)) : [];
    const ag = members.filter(m => m.role === ROLES.AGENT);
    const ex = members.filter(m => m.role === ROLES.EXEC);
    const mates = [lead, ...members].filter(m => m && m.id !== u.id);
    const active = u.isActive !== false;
    const self = u.id === user.id;
    return (
      <>
        <div className="uct-dhd">
          <Avatar name={u.name} avatar={u.avatar} className="ui-av" />
          <div className="uct-dhd-t">
            <h3 id="uct-dname">{u.name}{self && <span className="uct-tag">you</span>}</h3>
            <RoleBadge role={u.role} />
          </div>
        </div>
        <div className="uct-dgrid">
          <div className="uct-df"><div className="uct-dl"><Mi>mail</Mi>Email</div>{u.email ? <a className="uct-mail" href={`mailto:${u.email}`}>{u.email}</a> : '—'}</div>
          <div className="uct-df"><div className="uct-dl"><Mi>call</Mi>Phone</div>{u.phone ? <a className="uct-tel" href={`tel:${u.phone}`}>{u.phone}</a> : '—'}</div>
          <div className="uct-df"><div className="uct-dl"><Mi>groups</Mi>Team</div>{team ? team.name : '—'}</div>
          <div className="uct-df"><div className="uct-dl"><Mi>{active ? 'check_circle' : 'cancel'}</Mi>Status</div><span><span className={`cot-badge ${active ? 'ok' : 'off'}`}>{active ? 'Active' : 'Inactive'}</span></span></div>
        </div>
        {u.role === ROLES.TL && team && (
          <div>
            <div className="uct-dl uct-dsec">Team stats</div>
            <div className="uct-dstats">
              <div className="uct-dstat"><b>{ag.length}</b><span>Agents</span></div>
              {ex.length > 0 && <div className="uct-dstat"><b>{ex.length}</b><span>Executive</span></div>}
              <div className="uct-dstat"><b>{num('act:' + team.id)}</b><span>Active Prospects</span></div>
              <div className="uct-dstat"><b className="uct-won">{num('won:' + team.id)}</b><span>Won</span></div>
            </div>
          </div>
        )}
        <div>
          <div className="uct-dl uct-dsec">Team Mates</div>
          {mates.length
            ? <div className="uct-mates">{mates.map(m => (
                <button key={m.id} className="uct-mate" onClick={() => openLeads(m.id)} title={`Open ${m.name}'s prospects`}>
                  <Mi>person</Mi>{m.name}<span className="uct-mate-r">{rlabel(m.role)}</span>
                </button>
              ))}</div>
            : <div className="uct-dmuted">{team ? 'No agents yet' : u.role === ROLES.EXEC ? 'Custom-access account · not in a team' : 'Not in a team'}</div>}
        </div>
        <div className="uct-dft">
          {u.email && <a className="btn btn-p uct-send" href={`mailto:${u.email}`}><Mi>send</Mi>Send Email</a>}
          <button className="btn btn-g" onClick={() => openLeads(u.id)} title={`Open ${u.name}'s prospects`}><Mi>person_search</Mi>Prospects</button>
          <EditBtn u={u} />
          {!self && <DelBtn id={u.id} />}
        </div>
      </>
    );
  };

  const TABS = [['users', 'Users', 'group'], ['access', 'Access', 'shield']];
  const tabBar = (
    <div className="fin-tabs acc-tabs" role="tablist" aria-label="Users and access">
      {TABS.map(([k, l, ic]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
          <Mi>{ic}</Mi>{l}
        </button>
      ))}
    </div>
  );
  if (tab === 'access') return <div className="acc">{tabBar}<AccessPanel users={coUsers} /></div>;

  return (
    <div className="acc">
      {tabBar}
      {/* KPI strip */}
      <div className="acc-kpis">
        <div className="acc-kpi"><div className="acc-kpi-v">{counts.total}</div><div className="acc-kpi-l">Total accounts</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.TL] || 0}</div><div className="acc-kpi-l">Team Leads</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.AGENT] || 0}</div><div className="acc-kpi-l">Agents</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.MGMT] || 0}</div><div className="acc-kpi-l">Management</div></div>
      </div>

      {/* Toolbar: search, selection, Filter / Sort / Export menus, add */}
      <div className="uct-bar">
        <div className="acc-search uct-search"><Mi>search</Mi><input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Search name, email or phone" aria-label="Search users" /></div>
        {selected.size > 0 && (
          <div className="uct-sel">
            <button className="uct-chk on" onClick={() => setSelected(new Set())} title="Clear selection" aria-label="Clear selection"><Mi>check_box</Mi></button>
            <span>{selected.size} Selected</span>
            <button className="btn btn-g btn-sm" onClick={removeSelected}><Mi>delete</Mi>Remove</button>
          </div>
        )}
        <div className="uct-bar-r">
          <Menu label="Filter users" className="uct-menu" trigger={
            <button className={`uct-btn${nFilters ? ' on' : ''}`}><Mi>filter_list</Mi>Filter{nFilters > 0 && <span className="uct-n">{nFilters}</span>}</button>
          }>
            <MenuLabel>Role</MenuLabel>
            <MenuRadioGroup value={roleFilter} onChange={v => { setRoleFilter(v); setPage(0); }}>
              <MenuRadio value="ALL">All roles</MenuRadio>
              {ROLE_FILTER_OPTS.map(o => <MenuRadio key={o.v} value={o.v}>{o.l}</MenuRadio>)}
            </MenuRadioGroup>
            <MenuSep />
            <MenuLabel>Team</MenuLabel>
            <MenuRadioGroup value={teamFilter} onChange={v => { setTeamFilter(v); setPage(0); }}>
              <MenuRadio value="ALL">All teams</MenuRadio>
              {teams.map(t => <MenuRadio key={t.id} value={t.id}>{t.name}</MenuRadio>)}
              <MenuRadio value="NONE">No team</MenuRadio>
            </MenuRadioGroup>
          </Menu>
          <Menu label="Sort users" trigger={
            <button className="uct-btn"><Mi>swap_vert</Mi>Sort{sort !== 'team' && <span className="uct-n">1</span>}<Mi className="uct-chev">expand_more</Mi></button>
          }>
            <MenuRadioGroup value={sort} onChange={v => { setSort(v); setPage(0); }}>
              {SORT_OPTS.map(o => <MenuRadio key={o.v} value={o.v}>{o.l}</MenuRadio>)}
            </MenuRadioGroup>
          </Menu>
          <Menu label="Export users" trigger={
            <button className="uct-btn" disabled={!list.length}><Mi>download</Mi>Export<Mi className="uct-chev">expand_more</Mi></button>
          }>
            <MenuItem icon="table_view" onSelect={() => exportAs('csv')} hint={nAccounts(list.length)}>CSV</MenuItem>
            <MenuItem icon="data_object" onSelect={() => exportAs('json')}>JSON</MenuItem>
          </Menu>
          <button className={`btn btn-g${bulkOpen ? ' on' : ''}`} onClick={() => setBulkOpen(o => !o)}><Mi>group_add</Mi>Bulk add</button>
          <button className="btn btn-p" onClick={() => { setCreateUserRoles([ROLES.TL]); openModal('create-user'); }}><Mi>add</Mi>Add User</button>
        </div>
      </div>

      {/* Bulk create */}
      {bulkOpen && (
        <div className="acc-card">
          <div className="acc-card-hd">
            <div>
              <div className="acc-card-t"><Mi>group_add</Mi>Create multiple accounts</div>
              <div className="acc-card-s">Add a row per person, or paste a list. Each account needs its own password, 10 characters or more.</div>
            </div>
            <button className="btn btn-g btn-sm" onClick={() => setPasteOpen(o => !o)}><Mi>content_paste</Mi>Paste list</button>
          </div>

          {pasteOpen && (
            <div className="acc-paste">
              <div className="acc-paste-hint">One per line: <code>Name, Email, Phone, Role</code> — role = agent / team lead / management (blank = agent).</div>
              <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={5}
                placeholder={'Masud Rahman, masud@company.com, +8801711000000, agent\nNadia Karim, nadia@company.com, +8801822000000, team lead'} />
              <div className="acc-paste-ft">
                <button className="btn btn-g btn-sm" onClick={() => { setPasteOpen(false); setPaste(''); }}>Cancel</button>
                <button className="btn btn-p btn-sm" onClick={applyPaste}><Mi>playlist_add</Mi>Load rows</button>
              </div>
            </div>
          )}

          <div className="acc-table">
            <div className="acc-tr acc-th">
              <span>#</span><span>Full name</span><span>Email</span><span>Phone</span><span>Role</span><span>Team</span><span>Password</span><span />
            </div>
            {rows.map((r, i) => (
              <div className="acc-tr" key={i}>
                <span className="acc-idx">{i + 1}</span>
                <input className="fi" value={r.name} onChange={e => setRow(i, 'name', e.target.value)} placeholder="e.g. Masud Rahman" />
                <input className="fi" value={r.email} onChange={e => setRow(i, 'email', e.target.value)} placeholder="user@company.com" />
                <input className="fi" value={r.phone} onChange={e => setRow(i, 'phone', e.target.value)} placeholder="+880…" />
                <select className="fi" value={r.role} onChange={e => setRow(i, 'role', e.target.value)}>
                  {ROLE_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                {needsTeam(r.role) ? (
                  <select className="fi" value={r.teamId} onChange={e => setRow(i, 'teamId', e.target.value)}>
                    <option value="">Owner team</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                ) : <span className="acc-na">—</span>}
                <input className="fi" value={r.password} onChange={e => setRow(i, 'password', e.target.value)} placeholder="10+ characters" />
                <button className="acc-del" onClick={() => delRow(i)} title="Remove"><Mi>close</Mi></button>
              </div>
            ))}
          </div>

          <div className="acc-actions">
            <div className="acc-actions-l">
              <button className="btn btn-g btn-sm" onClick={addRow}><Mi>add</Mi>Add row</button>
              <button className="btn btn-g btn-sm" onClick={addFive}><Mi>library_add</Mi>+5 rows</button>
            </div>
            <button className="btn btn-p" onClick={createAll}><Mi>person_add</Mi>Create all accounts</button>
          </div>

          {/* Results */}
          {result && (
            <div className="acc-result">
              {!!result.created.length && (
                <div className="acc-res-ok">
                  <div className="acc-res-hd"><Mi>check_circle</Mi>{nAccounts(result.created.length)} created
                    <button className="btn btn-g btn-sm" style={{ marginLeft: 'auto' }} onClick={copyCreds}><Mi>content_copy</Mi>Copy logins</button>
                  </div>
                  <div className="acc-creds">
                    {result.created.map(c => (
                      <div className="acc-cred" key={c.id}>
                        <span className="acc-cred-n">{c.name}</span>
                        <span className="acc-cred-e">{c.email}</span>
                        <span className="acc-cred-p">pwd: <b>{c.pass}</b></span>
                        <RoleBadge role={c.role} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!!result.errors.length && (
                <div className="acc-res-err">
                  <div className="acc-res-hd"><Mi>error</Mi>{nRows(result.errors.length)} skipped</div>
                  {result.errors.map((e, i) => <div className="acc-err-row" key={i}>Row {e.line} · {e.name} — {e.reason}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Roster: a grid table; View opens the person's card over it */}
      <div className={`uct-card${detail ? ' has-detail' : ''}`}>
        <div className="uct-scroll">
          <div className="uct-table" role="table" aria-label="Users">
            <div className="uct-row uct-head" role="row">
              <div className="uct-c uct-c-chk" role="columnheader">
                <button className={`uct-chk${allOn ? ' on' : ''}`} onClick={toggleAll} role="checkbox" aria-checked={allOn} aria-label="Select all" title="Select all">
                  <Mi>{allOn ? 'check_box' : 'check_box_outline_blank'}</Mi>
                </button>
              </div>
              <div className="uct-c" role="columnheader"><Mi aria-hidden="true">person</Mi>Name</div>
              <div className="uct-c" role="columnheader"><Mi aria-hidden="true">badge</Mi>Role</div>
              <div className="uct-c" role="columnheader"><Mi aria-hidden="true">groups</Mi>Team</div>
              <div className="uct-c" role="columnheader"><Mi aria-hidden="true">mail</Mi>Email</div>
              <div className="uct-c" role="columnheader"><Mi aria-hidden="true">call</Mi>Phone</div>
              <div className="uct-c uct-c-act" role="columnheader">Action</div>
            </div>
            <AnimatePresence mode="wait" initial={!reduceMotion}>
              <motion.div key={`${curPage}|${sort}|${roleFilter}|${teamFilter}`} className="uct-body" role="rowgroup"
                variants={reduceMotion ? undefined : LIST_V} initial="hidden" animate="visible">
                {pageRows.map(u => {
                  const team = teamOf(u);
                  const on = selected.has(u.id), self = u.id === user.id;
                  return (
                    <motion.div key={u.id} variants={reduceMotion ? undefined : ROW_V} className={`uct-row${on ? ' sel' : ''}`} role="row">
                      <div className="uct-c uct-c-chk" role="cell">
                        {!self && (
                          <button className={`uct-chk${on ? ' on' : ''}`} onClick={() => toggleOne(u.id)} role="checkbox" aria-checked={on} aria-label={`Select ${u.name}`}>
                            <Mi>{on ? 'check_box' : 'check_box_outline_blank'}</Mi>
                          </button>
                        )}
                      </div>
                      <div className="uct-c" role="cell">
                        <span className="uct-chip">
                          <Avatar name={u.name} avatar={u.avatar} className="ui-av uct-av" />
                          <button className="uct-name" onClick={() => openLeads(u.id)} title={`Open ${u.name}'s prospects`}>{u.name}</button>
                        </span>
                        {self && <span className="uct-tag">you</span>}
                        {u.isActive === false && <span className="uct-tag off">inactive</span>}
                      </div>
                      <div className="uct-c" role="cell"><RoleBadge role={u.role} /></div>
                      <div className="uct-c uct-muted" role="cell">{team ? team.name : '—'}</div>
                      <div className="uct-c" role="cell">{u.email ? <a className="uct-mail" href={`mailto:${u.email}`} title={u.email}>{u.email}</a> : <span className="uct-muted">—</span>}</div>
                      <div className="uct-c" role="cell">{u.phone ? <a className="uct-tel" href={`tel:${u.phone}`}>{u.phone}</a> : <span className="uct-muted">—</span>}</div>
                      <div className="uct-c uct-c-act" role="cell">
                        <EditBtn u={u} />
                        {!self && <DelBtn id={u.id} />}
                        <button className="btn btn-g btn-sm uct-act-view" onClick={(e) => { viewRef.current = e.currentTarget; setDetailId(u.id); }} aria-label={`View ${u.name}`} title="View">
                          <Mi>visibility</Mi>
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
                {!pageRows.length && <div className="uct-empty" role="row"><span role="cell">{coUsers.length ? 'No accounts match.' : 'No accounts yet. Add a Team Lead to start.'}</span></div>}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <div className="uct-foot">
          <span className="uct-range">{list.length ? `${curPage * PAGE + 1} - ${Math.min(list.length, (curPage + 1) * PAGE)} of ${list.length}` : '0 of 0'}</span>
          <button className="uct-pg" disabled={curPage === 0} onClick={() => setPage(curPage - 1)} title="Previous" aria-label="Previous page"><Mi>chevron_left</Mi></button>
          <button className="uct-pg" disabled={curPage >= pages - 1} onClick={() => setPage(curPage + 1)} title="Next" aria-label="Next page"><Mi>chevron_right</Mi></button>
        </div>

        <AnimatePresence>
          {detail && (
            <motion.div key="ov" className="uct-ov" onClick={closeDetail}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <motion.div className="uct-dcard" role="dialog" aria-modal="true" aria-labelledby="uct-dname" onClick={e => e.stopPropagation()}
                initial={reduceMotion ? { opacity: 0 } : { scale: 0.8, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { scale: 0.8, opacity: 0, y: 20 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.8 }}>
                <button className="uct-dx" onClick={closeDetail} aria-label="Close" autoFocus><Mi>close</Mi></button>
                {renderDetail(detail)}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
