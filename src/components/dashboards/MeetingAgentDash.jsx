import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import LeadTable from '../LeadTable.jsx';
import TargetCard from './TargetCard.jsx';
import Mi from '../Mi.jsx';
import { ROLES } from '../../lib/constants.js';

export default function MeetingAgentDash() {
  const { user, tab, setTab, dbVersion, dateRange } = useApp();
  const db = getDB();
  const leads = getLeads(user);
  const meetingSet = leads.filter(l => l.status === 'MEETING_SET');
  const sched = leads.filter(l => l.status === 'SITE_VISIT_SCHEDULED');
  const done = leads.filter(l => l.status === 'SITE_VISIT_DONE');
  const fwdTL = db.leads.filter(l => l.previousAssignees.includes(user.id) && ['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'].includes(l.status));

  const tabs = [`Meeting Set (${meetingSet.length})`, 'Visit Scheduled', 'Visits Done', 'Forwarded to TL', 'All'];
  let disp = meetingSet;
  if (tab === 1) disp = sched;
  else if (tab === 2) disp = done;
  else if (tab === 3) disp = fwdTL;
  else if (tab === 4) disp = leads;
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  return (
    <>
      <TargetCard user={user} />
      <div className="grid-4">
        <StatCard val={meetingSet.length} label="Meeting Set" ico="event" bg="#C8FF00" />
        <StatCard val={sched.length} label="Visits Scheduled" ico="calendar_month" bg="#F0A92B" />
        <StatCard val={done.length} label="Visits Done" ico="location_on" bg="#34D399" />
        <StatCard val={fwdTL.length} label="Sent to Team Lead" ico="forward_to_inbox" bg="#DDB948" sub="all time" />
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>list</Mi>My Customers</div></div>
      <div className="fbar">
        <div className="ftabs">
          {tabs.map((t, i) => (
            <div key={i} className={`ftab${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>{t}</div>
          ))}
        </div>
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
