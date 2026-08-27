import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { queryLeads, countLeads, fetchLeadProjects } from '../../lib/db.js';
import { selfInvolved } from '../../lib/leadQuery.js';
import { STATUS_LABELS, ROLES } from '../../lib/constants.js';
import { rlabel } from '../../lib/helpers.js';
import LeadTable, { PAGE_SIZE } from '../LeadTable.jsx';
import SearchBox from '../SearchBox.jsx';

// Order the admin's people picker groups the way the pipeline runs, so the
// dropdown reads top-down rather than alphabetically across mixed roles.
const ROLE_ORDER = [ROLES.TL, ROLES.IA, ROLES.MA, ROLES.EXEC, ROLES.MGMT];

// This view no longer filters an in-memory array — it asks the server for one
// page of 15 and the total that matches. Every control below is therefore an
// input to a QUERY (see leadQuery.js), not to an Array.filter, and changing any
// of them refetches page 1.
export default function LeadsView() {
  const {
    user, search, statusFilter, setStatusFilter,
    teamFilter, setTeamFilter, agentFilter: drillAgent, dbVersion, dateRange, db, sortBy,
    setLeadCounts,
  } = useApp();

  // Initial/Meeting agents get a My Leads ↔ Forwarded toggle.
  const isAgent = [ROLES.IA, ROLES.MA].includes(user.role);
  const isTL = user.role === ROLES.TL;
  const isMgmt = user.role === ROLES.MGMT;

  const [tab, setTab] = useState('mine');
  // The Team Lead's own agent picker. Distinct from `drillAgent`, the app-wide
  // drill-down set by clicking a person on a dashboard (AgentCard) — that one
  // wins when present, because it is an explicit "show me THIS person's book".
  const [agentFilter, setAgentFilter] = useState(user.id);
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [projectOptions, setProjectOptions] = useState([]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [fwdCount, setFwdCount] = useState(0);

  useEffect(() => { fetchLeadProjects(user).then(setProjectOptions); }, [user]);

  // Changing tab/team can retire the chosen project; fall back rather than leave
  // the select rendering blank on a value that is no longer an option.
  const activeProject = projectOptions.includes(projectFilter) ? projectFilter : 'ALL';

  // A Team Lead picks between their own hand-off queue (the default), one team
  // member, or the whole team book. The roster comes from db.users, which for a
  // TL is exactly their team (see sbLoad's tiers).
  const teamUsers = useMemo(
    () => (isTL ? (db.users || []).filter(u => u.teamId === user.teamId && u.id !== user.id) : []),
    [isTL, db.users, user.teamId],
  );
  const activeAgent = agentFilter === 'ALL' || teamUsers.some(u => u.id === agentFilter) ? agentFilter : user.id;

  // Management's people picker. This replaced the team select: an admin asking
  // "whose book is this" wants a person, and a team is reachable by picking its
  // Team Lead. `teamFilter` survives as a drill-down input (a dashboard click
  // still sets it) — it just has no control of its own in the bar any more.
  const mgmtUsers = useMemo(() => (isMgmt
    ? (db.users || [])
      .filter(u => u.role !== ROLES.MASTER
        && (!user.companyId || !u.companyId || u.companyId === user.companyId))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : []), [isMgmt, db.users, user.companyId, user.id]);
  const [userFilter, setUserFilter] = useState('ALL');
  // A roster change (someone deactivated, or a company switch) can retire the
  // selection; fall back rather than render the select on a dead value.
  const activeUser = userFilter === 'ALL' || mgmtUsers.some(u => u.id === userFilter) ? userFilter : 'ALL';

  // Everything the query depends on, in one object. Held in a memo so the fetch
  // effect fires on a real change rather than on every render.
  const q = useMemo(() => ({
    user,
    involved: true,
    // A drill-down on somebody else's book overrides the viewer's own tabs.
    ownTab: !drillAgent && isAgent ? tab : undefined,
    // A TL viewing their own row wants their hand-off queue — the leads they
    // hold now plus the ones they have since forwarded on. Their scope is the
    // whole team, so it takes an explicit narrowing term. Any other pick is
    // that agent's current leads; ALL leaves the team scope untouched.
    extra: !drillAgent && isTL && activeAgent === user.id ? [selfInvolved(user.id)] : [],
    // Drilling into one person means their CURRENT book — the same set
    // AgentCard counts with getLeads(agent) — so it maps to assigned_to.
    agentId: drillAgent
      || (isTL && activeAgent !== 'ALL' && activeAgent !== user.id ? activeAgent : undefined)
      || (isMgmt && activeUser !== 'ALL' ? activeUser : undefined),
    teamId: isMgmt ? teamFilter || undefined : undefined,
    status: statusFilter,
    project: activeProject,
    search,
    // The Forwarded tab is a historical hand-off list and always shows every
    // forwarded lead, so the global date filter is deliberately not applied there.
    start: dateRange?.range && !(isAgent && tab === 'fwd') ? dateRange.range.start : undefined,
    end: dateRange?.range && !(isAgent && tab === 'fwd') ? dateRange.range.end : undefined,
  }), [user, isAgent, isTL, isMgmt, tab, activeAgent, activeUser, drillAgent, teamFilter, statusFilter, activeProject, search, dateRange]);

  const query = q;

  // Any filter change invalidates the page number: page 4 of the old result set
  // is meaningless in the new one.
  const qKey = JSON.stringify({ ...query, user: user.id });
  const lastKey = useRef(qKey);
  if (lastKey.current !== qKey) { lastKey.current = qKey; if (page !== 0) setPage(0); }

  // The fetch. `seq` guards against out-of-order responses: typing in the search
  // box fires several, and a slow early one must not overwrite a fast later one.
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    queryLeads(query, { page, size: PAGE_SIZE, sort: sortBy })
      .then(res => {
        if (mine !== seq.current) return;
        // null = the request failed. Keep whatever is on screen rather than
        // blanking the table and claiming there are no customers.
        if (res) setResult(res);
        setLoading(false);
      });
  }, [qKey, page, sortBy, dbVersion, query]);

  // ── The header's "N customers · M active" ────────────────────────────────
  //
  // Both halves describe THIS list. The header used to count on its own with a
  // filter-free query, so it reported the whole book while the table below it
  // showed a filtered subset — a Team Lead's own hand-off queue, an admin's
  // one-user pick, any status/project/search — and the two numbers disagreed.
  //
  // `total` is the one the page fetch already returned, so it costs nothing;
  // `active` is the same predicate plus the non-closed arm, so it costs one
  // count query per filter change, the same as the header used to spend.
  const [activeCount, setActiveCount] = useState(null);
  useEffect(() => {
    let alive = true;
    setActiveCount(null);
    countLeads({ ...query, kpi: 'active' }).then(n => { if (alive) setActiveCount(n); });
    return () => { alive = false; };
  }, [query, dbVersion]);

  // Publish only once the rows have landed: mid-fetch the total on screen still
  // belongs to the previous filter, and the header would state it as fact.
  useEffect(() => {
    setLeadCounts(loading ? null : { total: result.total, active: activeCount });
  }, [loading, result.total, activeCount, setLeadCounts]);
  // The header outlives this view — leave nothing behind for the next one.
  useEffect(() => () => setLeadCounts(null), [setLeadCounts]);

  // The Forwarded tab's badge is a count, so it costs a count query, not rows.
  useEffect(() => {
    if (!isAgent) { setFwdCount(0); return; }
    let alive = true;
    countLeads({ user, involved: true, ownTab: 'fwd' }).then(n => { if (alive && n != null) setFwdCount(n); });
    return () => { alive = false; };
  }, [isAgent, user, dbVersion]);

  return (
    <>
      {isAgent && !drillAgent && (
        <div className="ftabs" style={{ marginBottom: 12 }}>
          <button className={`ftab${tab === 'mine' ? ' on' : ''}`} onClick={() => setTab('mine')}>My Leads</button>
          <button className={`ftab${tab === 'fwd' ? ' on' : ''}`} onClick={() => setTab('fwd')}>
            Forwarded{fwdCount > 0 ? ` (${fwdCount})` : ''}
          </button>
        </div>
      )}
      {/* Compact pill filter bar — everything applies live, no apply button. */}
      <div className="fbar">
        <SearchBox placeholder="" style={{ flex: '0 1 300px', minWidth: '180px' }} />
        <select className="fsel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ALL">All status</option>
          <option value="FOLLOW_UP">Follow-up</option>
          <option value="FORWARDED">Forwarded</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {projectOptions.length > 0 && (
          <select
            className="fsel"
            value={activeProject}
            onChange={e => setProjectFilter(e.target.value)}
            title="Show leads interested in a specific project"
          >
            <option value="ALL">All projects</option>
            {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {isMgmt && (
          <select
            className="fsel fsel-team"
            value={activeUser}
            onChange={e => { setUserFilter(e.target.value); if (teamFilter) setTeamFilter(null); }}
            title="Show leads for a specific user"
          >
            <option value="ALL">All users</option>
            {ROLE_ORDER.map(r => {
              const list = mgmtUsers.filter(u => u.role === r);
              if (!list.length) return null;
              return (
                <optgroup key={r} label={rlabel(r)}>
                  {list.map(u => (
                    <option key={u.id} value={u.id}>{u.id === user.id ? `${u.name} (me)` : u.name}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        )}
        {isTL && (
          <select className="fsel fsel-team" value={activeAgent} onChange={e => setAgentFilter(e.target.value)} title="Show leads for a specific agent">
            <option value={user.id}>{user.name}</option>
            <option value="ALL">All agents</option>
            {teamUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      <LeadTable leads={result.rows} total={result.total} page={page} onPage={setPage} loading={loading} />
    </>
  );
}
