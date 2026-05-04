import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
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
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const hasRange = !!dateRange?.range;
  const rangeStart = dateRange?.range?.start || todayStart;
  const rangeEnd = dateRange?.range?.end || new Date();

  const inRange = (iso) => { const d = new Date(iso); return d >= rangeStart && d <= rangeEnd; };

  // All leads ever assigned (for call/meeting stats across range)
  const allMyLeads = db.leads.filter(l => l.assignedTo === user.id || l.previousAssignees.includes(user.id));
  const allActs = Object.values(db.activities || {}).flat();
  const myActs = allActs.filter(a => a.userId === user.id && inRange(a.timestamp));

  const meetingSetLeads = db.leads.filter(l => l.previousAssignees.includes(user.id) && l.status === 'MEETING_SET');
  const active = leads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));

  // Stats filtered by date range
  const newL = leads.filter(l => l.status === 'NEW' && inRange(l.createdAt));
  const calls = myActs.filter(a => a.type === 'CALL').length;
  const msCount = allMyLeads.filter(l => l.meetingSetBy === user.id && l.meetingSetDate && inRange(l.meetingSetDate)).length;

  const talkSecs = myActs.filter(a => a.type === 'CALL').reduce((s, a) => s + (a.durationSeconds || 0), 0);
  const talkMins = Math.round(talkSecs / 60);

  const newLabel = hasRange ? 'New Leads' : 'New Today';
  const callLabel = hasRange ? 'Calls' : 'Total Calls';
  const msLabel = hasRange ? 'Meetings Set' : 'Meetings Set';
  const talkLabel = hasRange ? 'Talk Time' : 'Talk Time Today';

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
      <div className="grid-5">
        <StatCard val={active.length} label="Active Leads" ico="person" bg="#2563EB" />
        <StatCard val={newL.length} label={newLabel} ico="fiber_new" bg="#7C3AED" sub="uncontacted" />
        <StatCard val={calls} label={callLabel} ico="call" bg="#0891B2" />
        <StatCard val={talkMins + ' min'} label={talkLabel} ico="schedule" bg="#6D28D9" sub="call minutes" />
        <StatCard val={msCount} label={msLabel} ico="check_circle" bg="#16A34A" sub={hasRange ? '' : 'this month'} />
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
