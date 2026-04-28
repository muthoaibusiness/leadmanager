import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import LeadTable from '../LeadTable.jsx';
import Mi from '../Mi.jsx';
import SearchBox from '../SearchBox.jsx';
import { fmtBDT, avc, ini, startOfMonth } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function ManagementDash() {
  const { tab, setTab, search, setSearch, setView, setTeamFilter, setAgentFilter, dbVersion, dateRange } = useApp();
  const db = getDB();
  const allLeads = db.leads;
  const teams = db.users.filter(u => u.role === ROLES.TL);
  const won = allLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
  const lost = allLeads.filter(l => l.status === 'DEAL_CLOSED_LOST');
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = allLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).reduce((s, l) => s + (l.dealValue || 0), 0);
  const wr = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0;

  const tabs = ['All Leads', 'Negotiating', 'Won', 'Lost'];
  let disp = allLeads;
  if (tab === 1) disp = allLeads.filter(l => l.status === 'NEGOTIATING');
  else if (tab === 2) disp = allLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
  else if (tab === 3) disp = allLeads.filter(l => l.status === 'DEAL_CLOSED_LOST');
  if (search) { const q = search.toLowerCase(); disp = disp.filter(l => l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.propertyInterest || '').toLowerCase().includes(q)); }
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  const viewTeamLeads = (teamId) => {
    setView('leads');
    setTab(0);
    setSearch('');
    setAgentFilter(null);
    setTeamFilter(teamId);
  };

  const sm = startOfMonth();

  return (
    <>
      <div className="grid-4" style={{ marginBottom: '20px' }}>
        <StatCard val={fmtBDT(rev)} label="Total Revenue" ico="payments" bg="#16A34A" />
        <StatCard val={fmtBDT(pipe)} label="Total Pipeline" ico="trending_up" bg="#2563EB" />
        <StatCard val={won.length + '/' + (won.length + lost.length)} label="Deals (Won/Total)" ico="emoji_events" bg="#D97706" />
        <StatCard val={wr + '%'} label="Overall Win Rate" ico="percent" bg="#7C3AED" />
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>groups</Mi>Team Performance</div></div>
      <div className="grid-2" style={{ marginBottom: '20px' }}>
        {teams.map(tl => {
          const tLeads = db.leads.filter(l => l.teamId === tl.teamId);
          const tWon = tLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
          const tRev = tWon.reduce((s, l) => s + (l.dealValue || 0), 0);
          const tAgents = db.users.filter(u => (u.role === ROLES.IA || u.role === ROLES.MA) && u.teamId === tl.teamId);
          const c = avc(tl.name);
          return (
            <div key={tl.id} className="tmcard" onClick={() => viewTeamLeads(tl.teamId)}>
              <div className="tmc-hd">
                <div className="tmc-ico" style={{ background: c, color: '#fff' }}>{ini(tl.name)}</div>
                <div>
                  <div className="tmc-n">{tl.name}'s Team</div>
                  <div className="tmc-s">{tAgents.length} agents · {tLeads.length} leads</div>
                </div>
              </div>
              <div className="tmc-grid">
                <div className="tmc-stat"><div className="tmc-sv">{fmtBDT(tRev)}</div><div className="tmc-sl">Revenue</div></div>
                <div className="tmc-stat"><div className="tmc-sv">{tWon.length} won</div><div className="tmc-sl">Closed deals</div></div>
                <div className="tmc-stat"><div className="tmc-sv">{tLeads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)).length}</div><div className="tmc-sl">Active leads</div></div>
                <div className="tmc-stat"><div className="tmc-sv">{tLeads.filter(l => l.siteVisitDoneDate && new Date(l.siteVisitDoneDate) >= sm).length}</div><div className="tmc-sl">Visits this mo.</div></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sec-hd">
        <div className="sec-t"><Mi>list</Mi>All Leads</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="ftabs">
            {tabs.map((t, i) => (
              <div key={i} className={`ftab${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>{t}</div>
            ))}
          </div>
          <SearchBox placeholder="Search..." style={{ minWidth: '160px' }} />
        </div>
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
