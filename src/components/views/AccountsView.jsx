import { useState, useMemo, useEffect, useRef } from 'react';
import useNavState from '../../hooks/useNavState.js';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, addNotifs, unassignDeletedUser } from '../../lib/db.js';
import { createAccount, deleteAccount } from '../../lib/accessAdmin.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES, canSee } from '../../lib/constants.js';
import { useProjectToast } from '../project/projectToast.js';
import useLeadCounts from '../../hooks/useLeadCounts.js';
import useOpenUserLeads from '../../hooks/useOpenUserLeads.js';
import { eq } from '../../lib/leadQuery.js';
import AccessPanel from '../AccessPanel.jsx';
import DesignPicker from '../DesignPicker.jsx';
import '../booking/ShopBooking.css';
import '../project/AddPropertyWizard.css';
import './AccountsView.css';

// Users & Accounts: one Management page for the whole company roster, in the Booking page's look
// (see the .bk tokens in booking/ShopBooking.css). Every person is a row in one table; View opens
// their card (team stats, team mates); bulk create sits above the table. Access is the second tab.

const ROLE_OPTS = [
  { v: ROLES.AGENT, l: 'Agent' },
  { v: ROLES.MA, l: 'Meeting Agent' },
  { v: ROLES.TL, l: 'Team Lead' },
  { v: ROLES.MGMT, l: 'Management' },
];
const ROLE_FILTER_OPTS = [...ROLE_OPTS, { v: ROLES.EXEC, l: 'Executive' }];
const SIZES = [10, 25, 50];
const blankRow = () => ({ name: '', email: '', phone: '', role: ROLES.AGENT, password: '', teamId: '' });
// Role pill, one colour per role; Management carries the bolt.
const ROLE_TONE = { MANAGEMENT: 'mgmt', TEAM_LEAD: 'tl', AGENT: 'agent', MEETING_AGENT: 'agent', EXECUTIVE: 'exec' };
const RoleBadge = ({ role }) => (
  <span className={`acx-role t-${ROLE_TONE[role] || 'agent'}`}>
    {role === ROLES.MGMT ? <Mi aria-hidden="true">bolt</Mi> : <i aria-hidden="true" />}
    {rlabel(role)}
  </span>
);
// "1 account" / "3 accounts", never "account(s)".
const nAccounts = (n) => `${n} account${n === 1 ? '' : 's'}`;
const nRows = (n) => `${n} row${n === 1 ? '' : 's'}`;
// Team Lead first, then Agent, Executive, Management, so a team reads top-down when sorted by team.
const ROLE_ORDER = { TEAM_LEAD: 0, AGENT: 1, MEETING_AGENT: 1, EXECUTIVE: 2, MANAGEMENT: 3 };
const toggleIn = (set, id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

// Roster orders. 'team' is the default: teams A–Z, each read top-down by ROLE_ORDER.
const SORT_OPTS = [
  { value: 'team', label: 'Team' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'role', label: 'Role' },
];
const SENIORITY = { MANAGEMENT: 0, TEAM_LEAD: 1, AGENT: 2, MEETING_AGENT: 2, EXECUTIVE: 3 };
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');

// Export: the filtered roster, every page. Passwords are never exported.
const EXPORT_COLS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['role', 'Role'], ['team', 'Team'], ['status', 'Status']];
// Quoted CSV cell. A leading = + - @ would run as a formula in Excel, so it gets a ' prefix.
const csvCell = (v) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};
const download = (text, type, name) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function AccountsView() {
  const { user, dbVersion, refreshDB, showToast, openModal, setCreateUserRoles, modal, panLead, setEditUser, setDeleteUserId } = useApp();
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
  const [size, setSize] = useNavState('accounts.size', 10);
  const [tab, setTab] = useNavState('accounts.tab', 'users');
  // The View card: an id, so a deleted account simply closes it.
  const [detailId, setDetailId] = useState(null);
  const viewRef = useRef(null);   // the View button that opened the card; focus goes back to it
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

  // ── counts ──
  const counts = useMemo(() => {
    const c = { total: coUsers.length, inactive: 0, [ROLES.TL]: 0, [ROLES.AGENT]: 0, [ROLES.MGMT]: 0 };
    coUsers.forEach(u => { c[u.role] = (c[u.role] || 0) + 1; if (u.isActive === false) c.inactive++; });
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

  const pages = Math.max(1, Math.ceil(list.length / size));
  const curPage = Math.min(page, pages - 1);
  const pageRows = list.slice(curPage * size, curPage * size + size);
  const from = list.length ? curPage * size + 1 : 0;

  // Selection spans the whole filtered list; your own row is never selectable (you can't remove yourself).
  const selectable = list.filter(u => u.id !== user.id);
  const allOn = selectable.length > 0 && selectable.every(u => selected.has(u.id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(selectable.map(u => u.id)));
  const toggleOne = (id) => setSelected(s => toggleIn(s, id));
  const filtered = !!(q.trim() || roleFilter !== 'ALL' || teamFilter !== 'ALL');
  const clearFilters = () => { setQ(''); setRoleFilter('ALL'); setTeamFilter('ALL'); setPage(0); };

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

  const setF = (fn) => (v) => { fn(v); setPage(0); };

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
        <div className="acx-dhd">
          <Avatar name={u.name} avatar={u.avatar} className="ui-av acx-av acx-av-lg" />
          <div className="acx-dhd-t">
            <h3 id="acx-dname">{u.name}{self && <span className="acx-tag">you</span>}</h3>
            <RoleBadge role={u.role} />
          </div>
          <button type="button" className="bk-close" onClick={closeDetail} aria-label="Close" autoFocus><Mi>close</Mi></button>
        </div>
        <div className="acx-dbody">
          <div className="acx-dgrid">
            <div className="acx-df"><span className="bk-cap"><Mi>mail</Mi>Email</span>{u.email ? <a href={`mailto:${u.email}`}>{u.email}</a> : '—'}</div>
            <div className="acx-df"><span className="bk-cap"><Mi>call</Mi>Phone</span>{u.phone ? <a href={`tel:${u.phone}`}>{u.phone}</a> : '—'}</div>
            <div className="acx-df"><span className="bk-cap"><Mi>groups</Mi>Team</span>{team ? team.name : '—'}</div>
            <div className="acx-df"><span className="bk-cap"><Mi>{active ? 'check_circle' : 'cancel'}</Mi>Status</span>
              <span className={`bk-pill ${active ? 's-available' : 's-sold'}`}><i className="bk-dot" />{active ? 'Active' : 'Inactive'}</span></div>
          </div>
          {u.role === ROLES.TL && team && (
            <div className="acx-dsec">
              <span className="bk-cap">Team stats</span>
              <div className="acx-dstats">
                <div><b>{ag.length}</b><span>Agents</span></div>
                {ex.length > 0 && <div><b>{ex.length}</b><span>Executive</span></div>}
                <div><b>{num('act:' + team.id)}</b><span>Active leads</span></div>
                <div><b className="acx-won">{num('won:' + team.id)}</b><span>Won</span></div>
              </div>
            </div>
          )}
          <div className="acx-dsec">
            <span className="bk-cap">Team mates</span>
            {mates.length
              ? <div className="acx-mates">{mates.map(m => (
                  <button key={m.id} type="button" className="bk-chip" onClick={() => openLeads(m.id)} title={`Open ${m.name}'s leads`}>
                    <Mi>person</Mi>{m.name}<i>{rlabel(m.role)}</i>
                  </button>
                ))}</div>
              : <span className="acx-muted">{team ? 'No agents yet' : u.role === ROLES.EXEC ? 'Custom-access account · not in a team' : 'Not in a team'}</span>}
          </div>
        </div>
        <div className="acx-dft">
          {u.email && <a className="bk-btn primary" href={`mailto:${u.email}`}><Mi>send</Mi>Send email</a>}
          <button type="button" className="bk-btn" onClick={() => openLeads(u.id)}><Mi>person_search</Mi>Leads</button>
          <button type="button" className="bk-btn" onClick={() => { setEditUser(u); openModal('edit-agent'); }}><Mi>tune</Mi>Edit access</button>
          {!self && <button type="button" className="bk-btn acx-danger" onClick={() => { setDeleteUserId(u.id); openModal('del-user'); }}><Mi>delete</Mi>Delete</button>}
        </div>
      </>
    );
  };

  // Appearance (the company's app design) is for the admins themselves, not for an account that was only granted this page.
  const isAdmin = user.role === ROLES.MGMT || user.role === ROLES.MASTER;
  const TABS = [['users', 'Users', 'group', coUsers.length], ['access', 'Access', 'shield', null], ...(isAdmin ? [['design', 'Appearance', 'tune', null]] : [])];
  const tabBar = (
    <div className="rqx-tabs" role="tablist" aria-label="Users and access">
      {TABS.map(([k, l, ic, n]) => (
        <button key={k} type="button" role="tab" className="bk-chip" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>
          <Mi>{ic}</Mi>{l}{n != null && <i>{n}</i>}
        </button>
      ))}
    </div>
  );
  if (tab === 'access') return <div className="bk acx"><div className="rqx-wrap acx-wrap">{tabBar}<AccessPanel users={coUsers} /></div></div>;
  if (tab === 'design' && isAdmin) return <div className="bk acx"><div className="rqx-wrap acx-wrap">{tabBar}<DesignPicker /></div></div>;

  const kpis = [
    ['group', 'Total accounts', counts.total, counts.inactive ? `${counts.inactive} inactive` : 'all active'],
    ['supervisor_account', 'Team leads', counts[ROLES.TL] || 0, `${teams.length} team${teams.length === 1 ? '' : 's'}`],
    ['support_agent', 'Agents', counts[ROLES.AGENT] || 0, 'front line'],
    ['bolt', 'Management', counts[ROLES.MGMT] || 0, 'full access'],
  ];

  return (
    <div className="bk acx">
      <div className="rqx-wrap acx-wrap">
        {tabBar}

        <div className="rqi-kpis acx-kpis">
          {kpis.map(([ic, l, v, s]) => (
            <div key={l} className="rqi-k"><span className="rqi-ki"><Mi>{ic}</Mi></span><span className="bk-cap">{l}</span><b>{v}</b><span className="rqi-ks">{s}</span></div>
          ))}
        </div>

        <div className="rqx-bar">
          <label className="bk-search rqx-search">
            <Mi>search</Mi>
            <input value={q} onChange={e => setF(setQ)(e.target.value)} placeholder="Search name, email or phone" aria-label="Search users" />
            {q && <button type="button" className="bk-close" aria-label="Clear search" onClick={() => setF(setQ)('')}><Mi>close</Mi></button>}
          </label>
          <div className="rqx-chips" role="group" aria-label="Role">
            <button type="button" className="bk-chip" aria-pressed={roleFilter === 'ALL'} onClick={() => setF(setRoleFilter)('ALL')}>All<i>{counts.total}</i></button>
            {ROLE_FILTER_OPTS.map(o => (
              <button key={o.v} type="button" className="bk-chip" aria-pressed={roleFilter === o.v} onClick={() => setF(setRoleFilter)(o.v)}>{o.l}<i>{counts[o.v] || 0}</i></button>
            ))}
          </div>
          <div className="rqx-sels">
            <BkSelect label="Team" value={teamFilter} onChange={setF(setTeamFilter)}
              options={[{ value: 'ALL', label: 'All teams' }, ...teams.map(t => ({ value: t.id, label: t.name })), { value: 'NONE', label: 'No team' }]} />
            <BkSelect label="Sort by" value={sort} onChange={setF(setSort)} align="right" options={SORT_OPTS} />
          </div>
        </div>

        <div className="acx-acts">
          {selected.size > 0 ? (
            <div className="acx-sel">
              <button type="button" className="acx-chk on" onClick={() => setSelected(new Set())} title="Clear selection" aria-label="Clear selection"><Mi>check_box</Mi></button>
              <span>{selected.size} selected</span>
              <button type="button" className="bk-btn acx-danger" onClick={removeSelected}><Mi>delete</Mi>Remove</button>
            </div>
          ) : <span className="bk-cap">{filtered ? `${list.length} of ${counts.total} accounts` : nAccounts(counts.total)}</span>}
          <div className="acx-acts-r">
            <button type="button" className="bk-btn" disabled={!list.length} onClick={() => exportAs('csv')}><Mi>download</Mi>CSV</button>
            <button type="button" className="bk-btn" disabled={!list.length} onClick={() => exportAs('json')}><Mi>data_object</Mi>JSON</button>
            <button type="button" className="bk-btn" aria-pressed={bulkOpen} onClick={() => setBulkOpen(o => !o)}><Mi>group_add</Mi>Bulk add</button>
            <button type="button" className="bk-btn primary" onClick={() => { setCreateUserRoles([ROLES.TL]); openModal('create-user'); }}><Mi>add</Mi>Add user</button>
          </div>
        </div>

        {bulkOpen && (
          <section className="rqi-card acx-bulk" aria-label="Create multiple accounts">
            <header>
              <div><h3>Create multiple accounts</h3><span className="bk-cap">One row per person, or paste a list. Each password needs 10 characters or more.</span></div>
              <button type="button" className="bk-btn" onClick={() => setPasteOpen(o => !o)}><Mi>content_paste</Mi>Paste list</button>
            </header>

            {pasteOpen && (
              <div className="acx-paste">
                <span className="bk-hint">One per line: <code>Name, Email, Phone, Role</code>. Role is agent, team lead or management (blank = agent).</span>
                <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={5}
                  placeholder={'Masud Rahman, masud@company.com, +8801711000000, agent\nNadia Karim, nadia@company.com, +8801822000000, team lead'} />
                <div className="pw-acts">
                  <button type="button" className="bk-btn" onClick={() => { setPasteOpen(false); setPaste(''); }}>Cancel</button>
                  <button type="button" className="bk-btn primary" onClick={applyPaste}><Mi>playlist_add</Mi>Load rows</button>
                </div>
              </div>
            )}

            <div className="acx-rows">
              {rows.map((r, i) => (
                <div className="acx-row" key={i}>
                  <span className="acx-idx">{i + 1}</span>
                  <label className="pw-f"><span className="bk-cap">Full name</span><input value={r.name} onChange={e => setRow(i, 'name', e.target.value)} placeholder="e.g. Masud Rahman" /></label>
                  <label className="pw-f"><span className="bk-cap">Email</span><input value={r.email} onChange={e => setRow(i, 'email', e.target.value)} placeholder="user@company.com" /></label>
                  <label className="pw-f"><span className="bk-cap">Phone</span><input value={r.phone} onChange={e => setRow(i, 'phone', e.target.value)} placeholder="+880…" /></label>
                  <div className="pw-f"><span className="bk-cap">Role</span>
                    <BkSelect label="Role" value={r.role} onChange={v => setRow(i, 'role', v)} options={ROLE_OPTS.map(o => ({ value: o.v, label: o.l }))} /></div>
                  <div className="pw-f"><span className="bk-cap">Team</span>
                    {needsTeam(r.role)
                      ? <BkSelect label="Team" value={r.teamId} onChange={v => setRow(i, 'teamId', v)} options={[{ value: '', label: 'Owner team' }, ...teams.map(t => ({ value: t.id, label: t.name }))]} />
                      : <span className="acx-na">Not needed</span>}</div>
                  <label className="pw-f"><span className="bk-cap">Password</span><input value={r.password} onChange={e => setRow(i, 'password', e.target.value)} placeholder="10+ characters" /></label>
                  <button type="button" className="bk-close" onClick={() => delRow(i)} title="Remove row" aria-label={`Remove row ${i + 1}`}><Mi>close</Mi></button>
                </div>
              ))}
            </div>

            <div className="acx-bulk-ft">
              <div className="pw-acts">
                <button type="button" className="bk-btn" onClick={addRow}><Mi>add</Mi>Add row</button>
                <button type="button" className="bk-btn" onClick={addFive}><Mi>library_add</Mi>+5 rows</button>
              </div>
              <button type="button" className="bk-btn primary" onClick={createAll}><Mi>person_add</Mi>Create all accounts</button>
            </div>

            {result && (
              <div className="acx-result">
                {!!result.created.length && (
                  <div className="acx-res ok">
                    <div className="acx-res-h"><Mi>check_circle</Mi>{nAccounts(result.created.length)} created
                      <button type="button" className="bk-btn" onClick={copyCreds}><Mi>content_copy</Mi>Copy logins</button></div>
                    <ul className="rqi-list">
                      {result.created.map(c => (
                        <li key={c.id}><span><b>{c.name}</b><i>{c.email} · password <code>{c.pass}</code></i></span><RoleBadge role={c.role} /></li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!result.errors.length && (
                  <div className="acx-res bad">
                    <div className="acx-res-h"><Mi>error</Mi>{nRows(result.errors.length)} skipped</div>
                    {result.errors.map((e, i) => <div className="pw-warn" key={i}>Row {e.line} · {e.name}: {e.reason}</div>)}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="rqx-card acx-card" aria-label="Users">
          {pageRows.length === 0 ? (
            <div className="bk-empty bk-empty-lg">
              <Mi>{filtered ? 'search_off' : 'group'}</Mi>
              <b>{filtered ? 'No account matches' : 'No accounts yet'}</b>
              <span>{filtered ? 'Try a different word or clear the filters.' : 'Add a team lead to start.'}</span>
              {filtered && <button type="button" className="bk-btn" onClick={clearFilters}>Clear filters</button>}
            </div>
          ) : (
            <div className="rqx-scroll">
              <table className="rqx-table acx-table">
                <thead>
                  <tr>
                    <th className="acx-c-chk">
                      <button type="button" className={`acx-chk${allOn ? ' on' : ''}`} onClick={toggleAll} role="checkbox" aria-checked={allOn} aria-label="Select all">
                        <Mi>{allOn ? 'check_box' : 'check_box_outline_blank'}</Mi>
                      </button>
                    </th>
                    <th>Name</th><th>Role</th><th>Team</th><th>Email</th><th>Phone</th><th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(u => {
                    const team = teamOf(u);
                    const on = selected.has(u.id), self = u.id === user.id;
                    return (
                      <tr key={u.id} className={on ? 'sel' : ''}>
                        <td className="acx-c-chk">
                          {!self && (
                            <button type="button" className={`acx-chk${on ? ' on' : ''}`} onClick={() => toggleOne(u.id)} role="checkbox" aria-checked={on} aria-label={`Select ${u.name}`}>
                              <Mi>{on ? 'check_box' : 'check_box_outline_blank'}</Mi>
                            </button>
                          )}
                        </td>
                        <td>
                          <span className="acx-who">
                            <Avatar name={u.name} avatar={u.avatar} className="ui-av acx-av" />
                            <button type="button" className="acx-name" onClick={() => openLeads(u.id)} title={`Open ${u.name}'s leads`}>{u.name}</button>
                            {self && <span className="acx-tag">you</span>}
                            {u.isActive === false && <span className="acx-tag off">inactive</span>}
                          </span>
                        </td>
                        <td><RoleBadge role={u.role} /></td>
                        <td className="acx-muted">{team ? team.name : '—'}</td>
                        <td>{u.email ? <a className="acx-link" href={`mailto:${u.email}`} title={u.email}>{u.email}</a> : <span className="acx-muted">—</span>}</td>
                        <td className="rqx-mono">{u.phone ? <a className="acx-link" href={`tel:${u.phone}`}>{u.phone}</a> : <span className="acx-muted">—</span>}</td>
                        <td className="acx-c-act">
                          <button type="button" className="acx-ib" title="Edit access" aria-label={`Edit ${u.name}`} onClick={() => { setEditUser(u); openModal('edit-agent'); }}><Mi>tune</Mi></button>
                          {!self && <button type="button" className="acx-ib bad" title="Delete" aria-label={`Delete ${u.name}`} onClick={() => { setDeleteUserId(u.id); openModal('del-user'); }}><Mi>delete</Mi></button>}
                          <button type="button" className="acx-ib" title="View" aria-label={`View ${u.name}`} onClick={(e) => { viewRef.current = e.currentTarget; setDetailId(u.id); }}><Mi>visibility</Mi></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="rqx-foot">
            <span className="bk-cap">{list.length ? `${from}–${from + pageRows.length - 1} of ${list.length}` : '0 accounts'}</span>
            <label className="rqx-size bk-cap">Rows
              <BkSelect label="Rows per page" value={size} onChange={v => { setSize(Number(v)); setPage(0); }} options={SIZES.map(n => ({ value: n, label: String(n) }))} />
            </label>
            <div className="rqx-pager" role="group" aria-label="Pages">
              <button type="button" className="bk-zbtn" aria-label="Previous page" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}><Mi>chevron_left</Mi></button>
              <span className="bk-zbtn wide rqx-pg">{curPage + 1} / {pages}</span>
              <button type="button" className="bk-zbtn" aria-label="Next page" disabled={curPage >= pages - 1} onClick={() => setPage(curPage + 1)}><Mi>chevron_right</Mi></button>
            </div>
          </div>
        </section>
      </div>

      {detail && (
        <div className="pw-scrim" onClick={closeDetail}>
          <div className="acx-dcard" role="dialog" aria-modal="true" aria-labelledby="acx-dname" onClick={e => e.stopPropagation()}>
            {renderDetail(detail)}
          </div>
        </div>
      )}
    </div>
  );
}
