import { useState, useMemo } from 'react';
import useNavState from '../../hooks/useNavState.js';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, bulkCreateUsers, addNotifs, deleteUserFn } from '../../lib/db.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import { useProjectToast } from '../project/projectToast.js';
import { EditBtn, DelBtn } from '../UserRow.jsx';
import useLeadCounts from '../../hooks/useLeadCounts.js';
import useOpenUserLeads from '../../hooks/useOpenUserLeads.js';
import { eq } from '../../lib/leadQuery.js';

// Users & Accounts — one Management page for the whole company roster.
// Replaces the old Users (team cards) and Accounts (bulk create + flat list)
// tabs: every person is a row in one table, a row expands to what the team
// card used to show (team stats, team mates), and bulk create sits above it.

const ROLE_OPTS = [
  { v: ROLES.AGENT, l: 'Agent' },
  { v: ROLES.TL, l: 'Team Lead' },
  { v: ROLES.MGMT, l: 'Management' },
];
const ROLE_FILTER_OPTS = [...ROLE_OPTS, { v: ROLES.EXEC, l: 'Executive' }];
const PAGE = 10;
const blankRow = () => ({ name: '', email: '', phone: '', role: ROLES.AGENT, password: '', teamId: '' });
const roleBadge = (role) => {
  const cls = { AGENT: 's-new', TEAM_LEAD: 's-negotiating', MANAGEMENT: 's-deal_closed_won', EXECUTIVE: 's-negotiating' }[role] || 's-new';
  return <span className={`bdg ${cls}`}>{rlabel(role)}</span>;
};
// "1 account" / "3 accounts" — never "account(s)".
const nAccounts = (n) => `${n} account${n === 1 ? '' : 's'}`;
const nRows = (n) => `${n} row${n === 1 ? '' : 's'}`;
// Team Lead first, then Agent, Executive, Management, so a team
// reads top-down when the table is sorted by team.
const ROLE_ORDER = { TEAM_LEAD: 0, AGENT: 1, EXECUTIVE: 2, MANAGEMENT: 3 };
const toggleIn = (set, id) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

export default function AccountsView() {
  const { user, dbVersion, refreshDB, showToast, openModal, setCreateUserRoles } = useApp();
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
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [page, setPage] = useNavState('accounts.page', 0);
  const toast = useProjectToast({ always: true });

  // ── KPI counts ──
  const counts = useMemo(() => {
    const c = { total: coUsers.length, [ROLES.TL]: 0, [ROLES.AGENT]: 0, [ROLES.MGMT]: 0 };
    coUsers.forEach(u => { c[u.role] = (c[u.role] || 0) + 1; });
    return c;
  }, [dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- coUsers is re-derived from db each render; dbVersion tracks it

  // Won / Active per team, shown when a Team Lead row is expanded. Two count
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
    // async: bulkCreateUsers asks the server about duplicate emails, because
    // db.users only holds this company since the load became tenant-scoped.
    const res = await bulkCreateUsers(filled, user);
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
        const ta = teamOf(a)?.name, tb = teamOf(b)?.name;
        if (ta !== tb) return !ta ? 1 : !tb ? -1 : ta.localeCompare(tb);
        return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || '').localeCompare(b.name || '');
      });
  }, [dbVersion, q, roleFilter, teamFilter]); // eslint-disable-line react-hooks/exhaustive-deps -- coUsers is re-derived from db each render; dbVersion tracks it

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const curPage = Math.min(page, pages - 1);
  const pageRows = list.slice(curPage * PAGE, curPage * PAGE + PAGE);

  // Selection spans the whole filtered list; your own row is never selectable
  // (you can't remove yourself).
  const selectable = list.filter(u => u.id !== user.id);
  const allOn = selectable.length > 0 && selectable.every(u => selected.has(u.id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(selectable.map(u => u.id)));
  const toggleOne = (id) => setSelected(s => toggleIn(s, id));
  const toggleExp = (id) => setExpanded(s => toggleIn(s, id));

  const removeSelected = () => {
    const ids = [...selected].filter(id => id !== user.id && coUsers.some(u => u.id === id));
    if (!ids.length) return;
    const names = ids.map(id => coUsers.find(u => u.id === id)?.name).filter(Boolean);
    if (!window.confirm(`Remove ${nAccounts(ids.length)}?\n\n${names.join(', ')}\n\nTheir leads become unassigned; a Team Lead's team is removed too. This cannot be undone.`)) return;
    ids.forEach(id => deleteUserFn(id, user)); // tombstone + cloud delete + unassign their leads
    setSelected(new Set());
    refreshDB();
    toast.success(`${nAccounts(ids.length)} removed`, 'They can no longer sign in.');
  };

  // After every hook, so the hook order never depends on the role.
  if (user.role !== ROLES.MGMT) return null;

  // Expanded row: what the old team card showed, per role.
  const renderDetail = (u) => {
    const team = teamOf(u);
    const lead = team ? coUsers.find(m => m.id === team.leadId) : null;
    const members = team ? coUsers.filter(m => m.teamId === team.id && m.id !== team.leadId && [ROLES.AGENT, ROLES.EXEC].includes(m.role)) : [];
    const ag = members.filter(m => m.role === ROLES.AGENT);
    const ex = members.filter(m => m.role === ROLES.EXEC);
    const mates = [lead, ...members].filter(m => m && m.id !== u.id);
    return (
      <div className="ut-detail">
        {u.role === ROLES.TL && team && (
          <div className="ut-dcol">
            <div className="ut-dl">Team stats</div>
            <div className="ut-dstats">
              <div className="ut-dstat"><b>{ag.length}</b><span>Agents</span></div>
              {ex.length > 0 && <div className="ut-dstat"><b>{ex.length}</b><span>Executive</span></div>}
              <div className="ut-dstat"><b>{num('act:' + team.id)}</b><span>Active Prospects</span></div>
              <div className="ut-dstat"><b className="ut-won">{num('won:' + team.id)}</b><span>Won</span></div>
            </div>
          </div>
        )}
        <div className="ut-dcol">
          <div className="ut-dl">Team Mates</div>
          {mates.length
            ? <div className="ut-dlist">{mates.map(m => (
                <button key={m.id} className="ut-mate" onClick={() => openLeads(m.id)} title={`Open ${m.name}'s prospects`}>
                  <Mi>person</Mi>{m.name}<span className="ut-mate-r">{rlabel(m.role)}</span>
                </button>
              ))}</div>
            : <div className="ut-dmuted">{team ? 'No agents yet' : u.role === ROLES.EXEC ? 'Custom-access account · not in a team' : 'Not in a team'}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="acc">
      {/* KPI strip */}
      <div className="acc-kpis">
        <div className="acc-kpi"><div className="acc-kpi-v">{counts.total}</div><div className="acc-kpi-l">Total accounts</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.TL] || 0}</div><div className="acc-kpi-l">Team Leads</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.AGENT] || 0}</div><div className="acc-kpi-l">Agents</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.MGMT] || 0}</div><div className="acc-kpi-l">Management</div></div>
      </div>

      {/* Toolbar: search, filters, selection, add */}
      <div className="ut-bar">
        <div className="acc-search ut-search"><Mi>search</Mi><input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Search name, email or phone" /></div>
        <select className="fi acc-rolefilter" value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(0); }}>
          <option value="ALL">All roles</option>
          {ROLE_FILTER_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <select className="fi acc-rolefilter" value={teamFilter} onChange={e => { setTeamFilter(e.target.value); setPage(0); }}>
          <option value="ALL">All teams</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="NONE">No team</option>
        </select>
        {selected.size > 0 && (
          <div className="ut-sel">
            <button className="ut-chk on" onClick={() => setSelected(new Set())} title="Clear selection"><Mi>check_box</Mi></button>
            <span>{selected.size} Selected</span>
            <button className="btn btn-g btn-sm" onClick={removeSelected}><Mi>delete</Mi>Remove</button>
          </div>
        )}
        <div className="ut-bar-r">
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
              <div className="acc-card-s">Add a row per person, or paste a list. Blank password defaults to <b>1234</b>.</div>
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
                <input className="fi" value={r.password} onChange={e => setRow(i, 'password', e.target.value)} placeholder="1234" />
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
                        {roleBadge(c.role)}
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

      {/* Roster */}
      <div className="ut-card">
        <div className="ut-scroll">
          <table className="ut">
            <thead>
              <tr>
                <th className="ut-c-chk"><button className={`ut-chk${allOn ? ' on' : ''}`} onClick={toggleAll} title="Select all"><Mi>{allOn ? 'check_box' : 'check_box_outline_blank'}</Mi></button></th>
                <th className="ut-c-exp" />
                <th>Name</th>
                <th>Team</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th className="ut-c-act">Edit</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(u => {
                const team = teamOf(u);
                const on = selected.has(u.id), open = expanded.has(u.id), self = u.id === user.id;
                const active = u.isActive !== false;
                return [
                  <tr key={u.id} className={`ut-row${on ? ' sel' : ''}${open ? ' open' : ''}`}>
                    <td className="ut-c-chk">{!self && <button className={`ut-chk${on ? ' on' : ''}`} onClick={() => toggleOne(u.id)}><Mi>{on ? 'check_box' : 'check_box_outline_blank'}</Mi></button>}</td>
                    <td className="ut-c-exp"><button className="ut-exp" onClick={() => toggleExp(u.id)} aria-expanded={open} title={open ? 'Collapse' : 'Details'}><Mi>{open ? 'expand_less' : 'expand_more'}</Mi></button></td>
                    <td>
                      <div className="ut-who">
                        <Avatar name={u.name} avatar={u.avatar} className="ui-av ui-sm" />
                        <button className="ut-name" onClick={() => openLeads(u.id)} title={`Open ${u.name}'s prospects`}>{u.name}</button>
                        {self && <span className="ut-you">you</span>}
                      </div>
                    </td>
                    <td className="ut-muted">{team ? team.name : '—'}</td>
                    <td className="ut-muted">{u.email}</td>
                    <td className="ut-muted ut-nowrap">{u.phone || '—'}</td>
                    <td><span className={`cot-badge ${active ? 'ok' : 'off'}`}>{active ? 'Active' : 'Inactive'}</span></td>
                    <td className="ut-c-act"><div className="ut-acts"><EditBtn u={u} />{!self && <DelBtn id={u.id} />}</div></td>
                  </tr>,
                  open && <tr key={u.id + ':d'} className="ut-dtr"><td colSpan={8}>{renderDetail(u)}</td></tr>,
                ];
              })}
              {!pageRows.length && <tr><td colSpan={8} className="cot-empty">{coUsers.length ? 'No accounts match.' : 'No accounts yet. Add a Team Lead to start.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="ut-foot">
          <span className="ut-range">{list.length ? `${curPage * PAGE + 1} - ${Math.min(list.length, (curPage + 1) * PAGE)} of ${list.length}` : '0 of 0'}</span>
          <button className="ut-pg" disabled={curPage === 0} onClick={() => setPage(curPage - 1)} title="Previous"><Mi>chevron_left</Mi></button>
          <button className="ut-pg" disabled={curPage >= pages - 1} onClick={() => setPage(curPage + 1)} title="Next"><Mi>chevron_right</Mi></button>
        </div>
      </div>
    </div>
  );
}
