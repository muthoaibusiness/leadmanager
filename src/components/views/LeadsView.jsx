import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads } from '../../lib/db.js';
import { STATUS_LABELS, ROLES } from '../../lib/constants.js';
import LeadTable from '../LeadTable.jsx';
import SearchBox from '../SearchBox.jsx';

const FU_OVERLAY = ['NEW', 'CONTACTED', 'INTERESTED'];

export default function LeadsView() {
  const {
    user, search, statusFilter, setStatusFilter,
    agentFilter, setAgentFilter, teamFilter, dbVersion, dateRange, db,
  } = useApp();

  // Initial/Meeting agents get a My Leads ↔ Forwarded toggle.
  const isAgent = [ROLES.IA, ROLES.MA].includes(user.role);
  const [tab, setTab] = useState('mine');

  let leads = getLeads(user, { involved: true }); // include forwarded leads so status filters (e.g. Meeting Set) show them
  if (agentFilter) leads = leads.filter(l => l.assignedTo === agentFilter || l.previousAssignees.includes(agentFilter));
  else if (teamFilter) leads = leads.filter(l => l.teamId === teamFilter);

  // Agent tabs: "mine" = leads they currently hold; "fwd" = leads they forwarded on.
  const myFwd = (l) => (l.previousAssignees || []).includes(user.id) && l.assignedTo !== user.id;
  if (isAgent) leads = tab === 'fwd' ? leads.filter(myFwd) : leads.filter(l => l.assignedTo === user.id);
  const fwdCount = isAgent ? getLeads(user, { involved: true }).filter(myFwd).length : 0;

  let disp = leads;
  if (statusFilter === 'FOLLOW_UP') disp = disp.filter(l => l.nextFollowup && FU_OVERLAY.includes(l.status));
  else if (statusFilter !== 'ALL') disp = disp.filter(l => l.status === statusFilter);
  if (search) { const q = search.toLowerCase(); disp = disp.filter(l => l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.propertyInterest || '').toLowerCase().includes(q)); }
  // Leads list shows the agent's full book — the global date filter (default Today)
  // only scopes dashboard counts, not the working lead list. (dateRange kept for ref.)
  void dateRange;

  // Agent filter is an admin-only control. Regular agents (IA/MA) only ever see
  // their own leads (enforced in getLeads), so the picker is hidden for them.
  // MGMT can pick any agent; a Team Lead is scoped to their own team's agents.
  const isMgmt = user.role === ROLES.MGMT;
  const canFilterAgents = isMgmt || user.role === ROLES.TL;
  const agentOptions = canFilterAgents
    ? (db.users || [])
        .filter(u => u.isActive !== false && (isMgmt
          ? [ROLES.IA, ROLES.MA, ROLES.TL].includes(u.role)
          // A Team Lead can only filter by agents inside their own team.
          : (u.teamId === user.teamId && [ROLES.IA, ROLES.MA].includes(u.role))))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];

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
          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {canFilterAgents && (
          <select
            className="fsel fsel-agent"
            value={agentFilter || ''}
            onChange={e => setAgentFilter(e.target.value || null)}
            title="Show leads for a specific agent"
          >
            <option value="">All leads</option>
            {agentOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
