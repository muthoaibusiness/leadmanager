import { useState, useMemo } from 'react';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, bulkCreateUsers, addNotifs } from '../../lib/db.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

const ROLE_OPTS = [
  { v: ROLES.IA, l: 'Initial Agent' },
  { v: ROLES.MA, l: 'Meeting Agent' },
  { v: ROLES.TL, l: 'Team Lead' },
  { v: ROLES.MGMT, l: 'Management' },
];
const blankRow = () => ({ name: '', email: '', phone: '', role: ROLES.IA, password: '', teamId: '' });
const roleBadge = (role) => {
  const cls = { INITIAL_AGENT: 's-new', MEETING_AGENT: 's-site_visit_done', TEAM_LEAD: 's-negotiating', MANAGEMENT: 's-deal_closed_won' }[role] || 's-new';
  return <span className={`bdg ${cls}`}>{rlabel(role)}</span>;
};

export default function AccountsView() {
  const { user, dbVersion, refreshDB, showToast, setDeleteUserId, openModal } = useApp();
  const db = getDB();
  // company sandbox: a Management admin only ever sees/manages their own company
  const coUsers = db.users.filter(u => u.companyId === user.companyId && u.role !== ROLES.MASTER);
  const teams = (db.teams || []).filter(t => t.companyId === user.companyId);

  const [rows, setRows] = useState(() => [blankRow(), blankRow(), blankRow()]);
  const [result, setResult] = useState(null);     // { created, errors }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  if (user.role !== ROLES.MGMT) return null;

  // ── KPI counts ──
  const counts = useMemo(() => {
    const c = { total: coUsers.length, [ROLES.TL]: 0, [ROLES.MA]: 0, [ROLES.IA]: 0, [ROLES.MGMT]: 0 };
    coUsers.forEach(u => { c[u.role] = (c[u.role] || 0) + 1; });
    return c;
  }, [dbVersion]);

  // ── row editing ──
  const setRow = (i, k, v) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const addRow = () => setRows(rs => [...rs, blankRow()]);
  const addFive = () => setRows(rs => [...rs, ...Array.from({ length: 5 }, blankRow)]);
  const delRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : [blankRow()]);

  const needsTeam = (role) => role === ROLES.IA || role === ROLES.MA;

  // ── paste parser: name, email, phone, role ──
  const applyPaste = () => {
    const parsed = paste.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const [name = '', email = '', phone = '', roleRaw = ''] = line.split(/[,\t]/).map(s => s.trim());
      const rl = roleRaw.toLowerCase();
      let role = ROLES.IA;
      if (rl.startsWith('team') || rl === 'tl') role = ROLES.TL;
      else if (rl.startsWith('meet') || rl === 'ma') role = ROLES.MA;
      else if (rl.startsWith('manage') || rl === 'mgmt') role = ROLES.MGMT;
      return { ...blankRow(), name, email, phone, role };
    });
    if (parsed.length) { setRows(parsed); setPasteOpen(false); setPaste(''); showToast(`${parsed.length} rows loaded`, 'ok'); }
  };

  // ── create all ──
  const createAll = () => {
    const filled = rows.filter(r => r.name.trim() || r.email.trim());
    if (!filled.length) { showToast('Add at least one account', 'warn'); return; }
    const res = bulkCreateUsers(filled, user);
    setResult(res);
    if (res.created.length) {
      // notify management + relevant TLs
      const newDb = getDB();
      const mgmtIds = newDb.users.filter(u => u.role === ROLES.MGMT && u.id !== user.id).map(u => u.id);
      addNotifs(mgmtIds.map(uid => ({ userId: uid, type: 'NEW_USER', message: `${res.created.length} new account(s) created`, leadId: null })), user);
      setRows([blankRow(), blankRow(), blankRow()]);
      refreshDB();
      showToast(`${res.created.length} account(s) created`, 'ok');
    } else {
      showToast('No accounts created — check errors', 'warn');
    }
  };

  const copyCreds = () => {
    if (!result?.created?.length) return;
    const txt = result.created.map(c => `${c.name}\t${c.email}\t${c.pass}\t${c.roleLabel}`).join('\n');
    navigator.clipboard?.writeText(txt);
    showToast('Credentials copied', 'ok');
  };

  // ── account list ──
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return coUsers
      .filter(u => roleFilter === 'ALL' ? true : u.role === roleFilter)
      .filter(u => !term || u.name.toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dbVersion, q, roleFilter]);

  return (
    <div className="acc">
      {/* KPI strip */}
      <div className="acc-kpis">
        <div className="acc-kpi"><div className="acc-kpi-v">{counts.total}</div><div className="acc-kpi-l">Total accounts</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.TL] || 0}</div><div className="acc-kpi-l">Team Leads</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.MA] || 0}</div><div className="acc-kpi-l">Meeting Agents</div></div>
        <div className="acc-kpi"><div className="acc-kpi-v">{counts[ROLES.IA] || 0}</div><div className="acc-kpi-l">Initial Agents</div></div>
      </div>

      {/* Bulk create */}
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
            <div className="acc-paste-hint">One per line: <code>Name, Email, Phone, Role</code> — role = initial / meeting / team lead / management.</div>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={5}
              placeholder={'Masud Rahman, masud@company.com, +8801711000000, initial\nNadia Karim, nadia@company.com, +8801822000000, meeting'} />
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
                <div className="acc-res-hd"><Mi>check_circle</Mi>{result.created.length} account(s) created
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
                <div className="acc-res-hd"><Mi>error</Mi>{result.errors.length} row(s) skipped</div>
                {result.errors.map((e, i) => <div className="acc-err-row" key={i}>Row {e.line} · {e.name} — {e.reason}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* All accounts */}
      <div className="acc-card">
        <div className="acc-card-hd">
          <div className="acc-card-t"><Mi>manage_accounts</Mi>All accounts <span className="acc-count">{list.length}</span></div>
          <div className="acc-list-tools">
            <div className="acc-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or email" /></div>
            <select className="fi acc-rolefilter" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="ALL">All roles</option>
              {ROLE_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        </div>
        <div className="acc-users">
          {list.map(u => (
            <div className="acc-user" key={u.id}>
              <Avatar name={u.name} avatar={u.avatar} className="ui-av ui-sm" />
              <div className="ui-info"><div className="ui-n">{u.name}</div><div className="ui-e">{u.email}</div></div>
              {roleBadge(u.role)}
              <span className="ui-ph">{u.phone || '—'}</span>
              {u.id !== user.id && (
                <button className="btn btn-g btn-sm" onClick={() => { setDeleteUserId(u.id); openModal('del-user'); }}><Mi>delete</Mi></button>
              )}
            </div>
          ))}
          {!list.length && <div className="ui-empty">No accounts match.</div>}
        </div>
      </div>
    </div>
  );
}
