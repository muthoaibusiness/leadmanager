import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, achievement } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import LeadTable from '../LeadTable.jsx';
import TargetCard from './TargetCard.jsx';
import Mi from '../Mi.jsx';
import SearchBox from '../SearchBox.jsx';
import { ROLES } from '../../lib/constants.js';
import { fmtD } from '../../lib/helpers.js';

function FollowUpQueue({ leads, onOpen }) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const due = leads.filter(l =>
    l.nextFollowup &&
    new Date(l.nextFollowup) <= today &&
    !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)
  ).sort((a, b) => new Date(a.nextFollowup) - new Date(b.nextFollowup));

  if (!due.length) return null;

  return (
    <div className="fuq-card">
      <div className="fuq-hd">
        <Mi>alarm</Mi>
        <span>Who to Call Today</span>
        <span className="fuq-ct">{due.length}</span>
      </div>
      {due.map(l => {
        const overdue = new Date(l.nextFollowup) < new Date(new Date().setHours(0,0,0,0));
        return (
          <div key={l.id} className="fuq-row" onClick={() => onOpen(l.id)}>
            <div className="fuq-name">{l.name}</div>
            <div className="fuq-phone">{l.phone}</div>
            <div className={`fuq-date${overdue ? ' overdue' : ''}`}>
              <Mi>{overdue ? 'warning' : 'event'}</Mi>
              {overdue ? 'Overdue · ' : ''}{fmtD(l.nextFollowup)}
            </div>
            <Mi style={{ color: 'var(--t3)', fontSize: '18px' }}>chevron_right</Mi>
          </div>
        );
      })}
    </div>
  );
}

export default function InitialAgentDash() {
  const { user, tab, setTab, search, setSearch, dbVersion, dateRange, setPanLead } = useApp();
  const db = getDB();
  const leads = getLeads(user);
  const meetingSetLeads = db.leads.filter(l => l.previousAssignees.includes(user.id) && l.status === 'MEETING_SET');
  const newL = leads.filter(l => l.status === 'NEW');
  const active = leads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));
  const msThis = achievement(user.id, ROLES.IA);
  const calls = leads.reduce((s, l) => s + (l.callCount || 0), 0);

  const tabs = ['All', 'New', 'Contacted', 'Interested', `Meeting Set (${meetingSetLeads.length})`];
  const tFilter = ['ALL', 'NEW', 'CONTACTED', 'INTERESTED', 'MEETING_SET'];

  let disp = leads;
  if (tab === 4) disp = meetingSetLeads;
  else if (tab > 0) disp = leads.filter(l => l.status === tFilter[tab]);
  if (search) { const q = search.toLowerCase(); disp = disp.filter(l => l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.propertyInterest || '').toLowerCase().includes(q)); }
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  return (
    <>
      <TargetCard user={user} />
      <FollowUpQueue leads={leads} onOpen={setPanLead} />
      <div className="grid-4">
        <StatCard val={active.length} label="Active Leads" ico="person" bg="#2563EB" />
        <StatCard val={newL.length} label="New Today" ico="fiber_new" bg="#7C3AED" sub="uncontacted" />
        <StatCard val={calls} label="Total Calls" ico="call" bg="#0891B2" />
        <StatCard val={msThis} label="Meetings Set" ico="check_circle" bg="#16A34A" sub="this month" />
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>list</Mi>My Leads</div></div>
      <div className="fbar">
        <div className="ftabs">
          {tabs.map((t, i) => (
            <div key={i} className={`ftab${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
        <SearchBox placeholder="Search name, phone, property..." />
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
