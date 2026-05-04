import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import LeadTable from '../LeadTable.jsx';
import Mi from '../Mi.jsx';
import SearchBox from '../SearchBox.jsx';

export default function LeadsView() {
  const { user, tab, setTab, search, setSearch, agentFilter, setAgentFilter, teamFilter, setTeamFilter, dbVersion, dateRange } = useApp();
  const db = getDB();
  let leads = getLeads(user);

  if (agentFilter) leads = leads.filter(l => l.assignedTo === agentFilter || l.previousAssignees.includes(agentFilter));
  else if (teamFilter) leads = leads.filter(l => l.teamId === teamFilter);

  const src = ['ALL', 'META_ADS', 'WHATSAPP_ADS', 'LINKEDIN', 'WEBSITE', 'HOTLINE', 'PERSONAL'];
  const srcL = ['All', 'Meta', 'WhatsApp', 'LinkedIn', 'Website', 'Hotline', 'Personal'];
  let disp = tab > 0 ? leads.filter(l => l.source === src[tab]) : leads;
  if (search) { const q = search.toLowerCase(); disp = disp.filter(l => l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.propertyInterest || '').toLowerCase().includes(q)); }
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  const agentName = agentFilter ? db.users.find(u => u.id === agentFilter)?.name : '';
  const tlUser = teamFilter ? db.users.find(u => u.role === 'TEAM_LEAD' && u.teamId === teamFilter) : null;
  const teamName = tlUser?.name || '';

  const clearFilter = () => {
    setAgentFilter(null);
    setTeamFilter(null);
    setTab(0);
    setSearch('');
  };

  return (
    <>
      {agentFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <button className="btn btn-g btn-sm" onClick={clearFilter}><Mi>arrow_back</Mi>All Leads</button>
          <span style={{ fontSize: '13px', color: 'var(--t2)' }}>Leads for <strong>{agentName}</strong></span>
        </div>
      )}
      {teamFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <button className="btn btn-g btn-sm" onClick={clearFilter}><Mi>arrow_back</Mi>All Leads</button>
          <span style={{ fontSize: '13px', color: 'var(--t2)' }}>{teamName}'s Team</span>
        </div>
      )}
      <div className="fbar">
        <div className="ftabs">
          {srcL.map((t, i) => (
            <div key={i} className={`ftab${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
        <SearchBox placeholder="Search leads..." />
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
