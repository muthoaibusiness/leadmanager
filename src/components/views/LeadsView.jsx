import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { queryLeads, countLeads, fetchLeadProjects, fetchLastFollowups } from '../../lib/db.js';
import { selfInvolved } from '../../lib/leadQuery.js';
import { STATUS_LABELS, ROLES, canSee } from '../../lib/constants.js';
import { rlabel } from '../../lib/helpers.js';
import LeadTable, { PAGE_SIZE } from '../LeadTable.jsx';

import BkSelect from '../booking/BkSelect.jsx';
import '../booking/ShopBooking.css';
import '../LeadTable.css';
import useChanged from '../../hooks/useChanged.js';
import useNavState from '../../hooks/useNavState.js';
import { loadLeadPage, storeLeadPage } from '../../lib/deviceCache.js';
import useIsPhone from '../../hooks/useIsPhone.js';
import Mi from '../Mi.jsx';
import BackButton from '../BackButton.jsx';
import RefreshButton from '../RefreshButton.jsx';

// Order the admin's people picker groups the way the pipeline runs, so the
// dropdown reads top-down rather than alphabetically across mixed roles.
const ROLE_ORDER = [ROLES.TL, ROLES.AGENT, ROLES.EXEC, ROLES.MGMT];

// This view no longer filters an in-memory array — it asks the server for one
// page of 15 and the total that matches. Every control below is therefore an
// input to a QUERY (see leadQuery.js), not to an Array.filter, and changing any
// of them refetches page 1.
export default function LeadsView() {
  const {
    user, search, statusFilter, setStatusFilter,
    teamFilter, setTeamFilter, agentFilter: drillAgent, dbVersion, dateRange, db, sortBy,
    setLeadCounts, openModal, setSearch, searchRef,
  } = useApp();
  const searchEl = useRef(null);
  // the page's search box takes the keyboard shortcut that focuses search
  useEffect(() => {
    if (searchRef) searchRef.current = searchEl.current;
    return () => { if (searchRef) searchRef.current = null; };
  }, [searchRef]);
  const phone = useIsPhone();
  const canAdd = canSee(user, 'add_customer'); // the hero's Add Customer / Import gate
  const pageSize = PAGE_SIZE; // 10 leads a page on every screen

  // Agents get a My Leads ↔ Forwarded toggle.
  const isAgent = user.role === ROLES.AGENT;
  const isTL = user.role === ROLES.TL;
  const isMgmt = user.role === ROLES.MGMT;

  // Tabs, pickers and the page number are kept in the history entry
  // (useNavState), so Back to this list returns to the same page of it.
  const [tab, setTab] = useNavState('leads.tab', 'mine');
  // The Team Lead's own agent picker. Distinct from `drillAgent`, the app-wide
  // drill-down set by clicking a person on a dashboard (AgentCard) — that one
  // wins when present, because it is an explicit "show me THIS person's book".
  const [agentFilter, setAgentFilter] = useNavState('leads.agent', user.id);
  const [projectFilter, setProjectFilter] = useNavState('leads.project', 'ALL');
  const [projectOptions, setProjectOptions] = useState([]);
  const [page, setPage] = useNavState('leads.page', 0);
  const [result, setResult] = useState({ rows: [], total: 0 });
  const [doneKey, setDoneKey] = useState(null); // fetchKey of the last answered fetch
  const [fwdCount, setFwdCount] = useState(null); // null until the first count lands

  useEffect(() => { fetchLeadProjects(user).then(setProjectOptions); }, [user]);

  // Changing tab/team can retire the chosen project; fall back rather than leave
  // the select rendering blank on a value that is no longer an option.
  // Case-blind: Available Units' See more passes the project's own spelling.
  const activeProject = projectOptions.find(p => p.toLowerCase() === String(projectFilter).toLowerCase()) || 'ALL';

  // A Team Lead picks between their own hand-off queue (the default), one team
  // member, or the whole team book. The roster comes from db.users, which for a
  // TL is exactly their team (see sbLoad's tiers).
  const teamUsers = useMemo(
    () => (isTL ? (db.users || []).filter(u => u.teamId === user.teamId && u.id !== user.id) : []),
    [isTL, db.users, user.teamId, user.id],
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
    : []), [isMgmt, db.users, user.companyId]);
  const [userFilter, setUserFilter] = useNavState('leads.user', 'ALL');
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
  // is meaningless in the new one. The query the page belongs to is kept with
  // it, so a page restored by Back survives the remount while its query matches.
  // It names the project picked rather than activeProject, which reads ALL until
  // the project list loads and would otherwise reset a restored page.
  const qKey = JSON.stringify({ ...query, user: user.id });
  const pageForKey = JSON.stringify({ ...query, project: projectFilter, user: user.id });
  const [pageFor, setPageFor] = useNavState('leads.pageFor', pageForKey);
  if (pageFor !== pageForKey) {
    setPageFor(pageForKey);
    if (page !== 0) setPage(0);
  }

  // Loading until the newest fetch for what is on screen has answered.
  const fetchKey = `${qKey}|${page}|${sortBy}|${dbVersion}`;
  const loading = doneKey !== fetchKey;

  // The fetch. `seq` guards against out-of-order responses: typing in the search
  // box fires several, and a slow early one must not overwrite a fast later one.
  const seq = useRef(0);
  // Which page the rows on screen answer. The last answer for a page is kept on
  // the device (deviceCache.js) and shown while the fresh one loads, so a list
  // that was looked at before opens at once. `loading` stays true meanwhile:
  // the table shows its busy bar and the header publishes no count yet.
  const shownPage = useRef(null);
  useEffect(() => {
    const mine = ++seq.current;
    const pageKey = `${qKey}|${page}|${pageSize}|${sortBy}`;
    let answered = false;
    // Only for a page that is not on screen already: a data change (dbVersion)
    // refetches the same page, and its stored copy is what is showing.
    if (shownPage.current !== pageKey) {
      loadLeadPage(pageKey).then(hit => {
        if (!hit || answered || mine !== seq.current) return;
        shownPage.current = pageKey;
        setResult(hit);
      });
    }
    queryLeads(query, { page, size: pageSize, sort: sortBy })
      .then(res => {
        if (mine !== seq.current) return;
        answered = true;
        // null = the request failed. Keep whatever is on screen rather than
        // blanking the table and claiming there are no customers.
        if (res) {
          shownPage.current = pageKey;
          setResult(res);
          // A search is typed letter by letter; keeping each step would push
          // the pages worth keeping out of the store.
          if (!query.search) storeLeadPage(pageKey, res);
        }
        setDoneKey(fetchKey);
      });
  }, [fetchKey, qKey, page, pageSize, sortBy, dbVersion, query]);

  // The Last Follow-up column: the newest FOLLOW_UP and Add Note for the rows on
  // screen, fetched for this page's ids once its rows land. A separate request,
  // so the page query -- shared with the KPI cards and dashboards -- stays as it
  // is. Every new page result refetches (a dbVersion bump included). `fu.rows`
  // records which result the map answers, so the table can tell "not answered
  // yet" from "none"; a failed fetch (null) changes nothing, so rows it never
  // answered keep showing '…' rather than claiming '—'.
  const [fu, setFu] = useState({ rows: null, map: {} });
  const fuSeq = useRef(0);
  useEffect(() => {
    const rows = result.rows;
    const mine = ++fuSeq.current;
    fetchLastFollowups(rows.map(l => l.id)).then(map => {
      if (mine !== fuSeq.current || !map) return;
      setFu({ rows, map });
    });
  }, [result.rows]);

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
  // A new query or a data change clears the count until it is asked again.
  const queryChanged = useChanged(query);
  const versionChanged = useChanged(dbVersion);
  if ((queryChanged || versionChanged) && activeCount !== null) setActiveCount(null);
  useEffect(() => {
    let alive = true;
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
  // It is live: realtime lead changes the agent is involved in (inScope keeps
  // leads they held before) bump dbVersion, and the count is asked again.
  if (!isAgent && fwdCount !== 0) setFwdCount(0);
  useEffect(() => {
    if (!isAgent) return;
    let alive = true;
    countLeads({ user, involved: true, ownTab: 'fwd' }).then(n => { if (alive && n != null) setFwdCount(n); });
    return () => { alive = false; };
  }, [isAgent, user, dbVersion]);

  const statusOpts = [
    { value: 'ALL', label: 'All status' }, { value: 'FOLLOW_UP', label: 'Follow-up' }, { value: 'FORWARDED', label: 'Forwarded' },
    ...Object.entries(STATUS_LABELS).map(([k, l]) => ({ value: k, label: l })),
  ];

  return (
    <div className="bk lvx">
      <div className="lvx-wrap">
        {/* Phones, every role: the Projects pages' header (AvailableUnitsTab.css
            .fpv-ph): Back, the page name, Refresh at the end. The hero,
            header bar and bottom bar do not mount here (App.jsx, BottomNav). */}
        {phone && (
          <div className="fpv-ph lv-ph">
            <div className="fpv-ph-top">
              <BackButton />
              <h1>Leads</h1>
              <RefreshButton />
            </div>
          </div>
        )}
        {/* One row: the agent's two tabs, then (phones) Import and Add, which the hero carries on wider screens. */}
        {((isAgent && !drillAgent) || (phone && canAdd)) && (
          <div className="lvx-tabs" role="tablist" aria-label="Lead lists">
            {isAgent && !drillAgent && (
              <>
                <button type="button" role="tab" className="bk-chip" aria-selected={tab === 'mine'} aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>My leads</button>
                <button type="button" role="tab" className="bk-chip" aria-selected={tab === 'fwd'} aria-pressed={tab === 'fwd'} onClick={() => setTab('fwd')}>
                  Forwarded{fwdCount != null ? <i>{fwdCount}</i> : null}
                </button>
              </>
            )}
            {phone && canAdd && (
              <>
                <button type="button" className="bk-btn" onClick={() => openModal('import')}><Mi aria-hidden="true">upload</Mi>Import</button>
                <button type="button" className="bk-btn primary" onClick={() => openModal('add-lead')} aria-label="Add lead"><Mi aria-hidden="true">person_add</Mi>Add</button>
              </>
            )}
          </div>
        )}
        {/* Everything applies live, no apply button. */}
        <div className="rqx-bar">
          <label className="bk-search rqx-search">
            <Mi>search</Mi>
            <input ref={searchEl} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); } }}
              placeholder="Search name, phone or project" aria-label="Search leads" />
            {search && <button type="button" className="bk-close" aria-label="Clear search" onClick={() => setSearch('')}><Mi>close</Mi></button>}
          </label>
          <div className="rqx-sels">
            <BkSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOpts} />
            {projectOptions.length > 0 && (
              <BkSelect label="Project" value={activeProject} onChange={setProjectFilter} options={[{ value: 'ALL', label: 'All projects' }, ...projectOptions.map(p => ({ value: p, label: p }))]} />
            )}
            {isMgmt && (
              <BkSelect label="User" value={activeUser} onChange={v => { setUserFilter(v); if (teamFilter) setTeamFilter(null); }}
                options={[{ value: 'ALL', label: 'All users' }, ...ROLE_ORDER.flatMap(r => mgmtUsers.filter(u => u.role === r).map(u => ({ value: u.id, label: `${u.id === user.id ? `${u.name} (me)` : u.name} · ${rlabel(r)}` })))]} />
            )}
            {isTL && (
              <BkSelect label="Agent" value={activeAgent} onChange={setAgentFilter}
                options={[{ value: user.id, label: user.name }, { value: 'ALL', label: 'All agents' }, ...teamUsers.map(u => ({ value: u.id, label: u.name }))]} />
            )}
          </div>
        </div>
        <LeadTable leads={result.rows} total={result.total} page={page} onPage={setPage} pageSize={pageSize} loading={loading}
          lastFu={fu.map} fuPending={fu.rows !== result.rows} />
      </div>
    </div>
  );
}
