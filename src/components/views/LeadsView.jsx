import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads } from '../../lib/db.js';
import { STATUS_LABELS, ROLES } from '../../lib/constants.js';
import LeadTable from '../LeadTable.jsx';
import SearchBox from '../SearchBox.jsx';

const FU_OVERLAY = ['NEW', 'CONTACTED', 'INTERESTED'];

// A lead's projects, as a list. `propertyInterest` is a single string holding one or
// more project names, and the writers disagree on the separator: ProjectInterestPicker
// and schedVisit join with ', ', CSV import joins with ' · '. Split on both. Matching
// whole names (rather than a substring of the raw string) keeps "Lake" from also
// selecting every "Lake View" lead.
const projectsOf = (l) => (l.propertyInterest || '').split(/[,·]/).map(s => s.trim()).filter(Boolean);

export default function LeadsView() {
  const {
    user, search, statusFilter, setStatusFilter,
    teamFilter, setTeamFilter, dbVersion, dateRange, db,
  } = useApp();

  // Initial/Meeting agents get a My Leads ↔ Forwarded toggle.
  const isAgent = [ROLES.IA, ROLES.MA].includes(user.role);
  const isTL = user.role === ROLES.TL;
  const isMgmt = user.role === ROLES.MGMT;
  
  const [tab, setTab] = useState('mine');
  const [agentFilter, setAgentFilter] = useState('ALL');
  const [projectFilter, setProjectFilter] = useState('ALL');

  let leads = getLeads(user, { involved: true }); // include forwarded leads so status filters (e.g. Meeting Set) show them
  if (teamFilter) {
    const teamMemberIds = new Set(
      (db.users || []).filter(u => u.teamId === teamFilter).map(u => u.id)
    );
    leads = leads.filter(l =>
      l.teamId === teamFilter ||
      teamMemberIds.has(l.assignedTo) ||
      (l.previousAssignees || []).some(id => teamMemberIds.has(id))
    );
  }

  // Agent tabs: "mine" = leads they currently hold; "fwd" = leads they forwarded on.
  const myFwd = (l) => (l.previousAssignees || []).includes(user.id) && l.assignedTo !== user.id;
  if (isAgent) leads = tab === 'fwd' ? leads.filter(myFwd) : leads.filter(l => l.assignedTo === user.id);
  const fwdCount = isAgent ? getLeads(user, { involved: true }).filter(myFwd).length : 0;
  
  if (isTL && agentFilter !== 'ALL') {
    leads = leads.filter(l => l.assignedTo === agentFilter);
  }

  // Project options come from the leads themselves, not the project catalog: the
  // interest picker accepts free text and CSV import brings its own names, so a
  // catalog-driven list would both miss real values and offer dead ones. Built from
  // `leads` (before the filters below) so picking a project doesn't collapse the list
  // to the one option just chosen. Deduped case-insensitively to match how the filter
  // compares — otherwise "Sky Villa" and "sky villa" list twice and select the same
  // leads — keeping the first spelling seen.
  const projectSeen = new Map();
  for (const p of leads.flatMap(projectsOf)) {
    const k = p.toLowerCase();
    if (!projectSeen.has(k)) projectSeen.set(k, p);
  }
  const projectOptions = [...projectSeen.values()].sort((a, b) => a.localeCompare(b));
  // Changing tab/team can retire the chosen project; fall back rather than leave the
  // select rendering blank on a value that is no longer an option.
  const activeProject = projectOptions.includes(projectFilter) ? projectFilter : 'ALL';

  let disp = leads;
  if (activeProject !== 'ALL') disp = disp.filter(l => projectsOf(l).some(p => p.toLowerCase() === activeProject.toLowerCase()));
  if (statusFilter === 'FOLLOW_UP') disp = disp.filter(l => l.nextFollowup && FU_OVERLAY.includes(l.status));
  else if (statusFilter === 'FORWARDED') disp = disp.filter(l => (l.previousAssignees || []).length > 0);
  else if (statusFilter !== 'ALL') disp = disp.filter(l => l.status === statusFilter);
  if (search) { const q = search.toLowerCase(); disp = disp.filter(l => l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.propertyInterest || '').toLowerCase().includes(q)); }
  // Apply the global date filter (by createdAt) — except on the Forwarded tab,
  // which is a historical hand-off list and should always show every forwarded lead.
  if (dateRange?.range && !(isAgent && tab === 'fwd')) {
    const { start, end } = dateRange.range;
    disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; });
  }

  const teamOptions = isMgmt
    ? (db.teams || []).filter(t => !user.companyId || !t.companyId || t.companyId === user.companyId)
    : [];
    
  const teamUsers = isTL ? (db.users || []).filter(u => u.teamId === user.teamId) : [];

  return (
    <>
      {isAgent && (
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
            value={teamFilter || ''}
            onChange={e => setTeamFilter(e.target.value || null)}
            title="Show leads for a specific team"
          >
            <option value="">All teams</option>
            {teamOptions.map(t => {
              const tl = db.users?.find(u => u.id === t.leadId);
              return <option key={t.id} value={t.id}>{tl ? tl.name : 'Team ' + t.id}</option>;
            })}
          </select>
        )}
        {isTL && (
          <select className="fsel fsel-team" value={agentFilter} onChange={e => setAgentFilter(e.target.value)} title="Show leads for a specific agent">
            <option value="ALL">All agents</option>
            {teamUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
