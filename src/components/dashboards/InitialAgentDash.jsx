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
        const overdue = new Date(l.nextFollowup) < new Date(new Date().setHours(0, 0, 0, 0));
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
  const { user, tab, setTab, search, dbVersion, dateRange, setPanLead } = useApp();
  void dbVersion; // re-render when DB changes
  const db = getDB();
  const leads = getLeads(user);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  // ── IA-focused metrics (point-in-time, daily-work oriented) ──
  const active = leads.filter(l => !['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status));

  const actsByLead = db.activities || {};
  const isTouched = (l) =>
    (l.callCount || 0) > 0 || (l.smsCount || 0) > 0 || (l.whatsappCount || 0) > 0 ||
    (actsByLead[l.id] || []).some(a => ['CALL', 'SMS', 'WHATSAPP', 'VISIT'].includes(a.type));
  const untouched = active.filter(l => !isTouched(l)); // open leads never contacted

  const nowD = new Date();
  const overdue = active.filter(l => l.nextFollowup && new Date(l.nextFollowup) < nowD); // follow-up gone late

  const allActs = Object.values(db.activities || {}).flat();
  const myCallsToday = allActs.filter(a => a.userId === user.id && a.type === 'CALL' && new Date(a.timestamp) >= todayStart);
  const callsToday = myCallsToday.length;
  const talkMinsToday = Math.round(myCallsToday.reduce((s, a) => s + (a.durationSeconds || 0), 0) / 60);

  const meetingsMonth = achievement(user.id, ROLES.IA); // meetings set this month

  // Meetings this IA set — tracked by meetingSetBy so they persist even after the
  // Meeting Agent progresses the lead (visit scheduled/done, etc.).
  const meetingSetLeads = db.leads.filter(l => l.meetingSetBy === user.id);

  // ── My customers table ──
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
      <div className="grid-6">
        <StatCard val={leads.length} label="My Leads" ico="contacts" tone="accent" sub="total assigned" />
        <StatCard val={active.length} label="Open Deals" ico="trending_up" sub="in progress" />
        <StatCard val={untouched.length} label="Untouched" ico="fiber_new" tone={untouched.length ? 'warn' : ''} sub="need first call" />
        <StatCard val={overdue.length} label="Overdue Follow-ups" ico="alarm" tone={overdue.length ? 'danger' : ''} sub="late · call now" />
        <StatCard val={callsToday} label="My Calls Today" ico="call" sub={talkMinsToday + ' min talk'} />
        <StatCard val={meetingsMonth} label="Meetings Set" ico="event_available" tone="good" sub="this month" />
      </div>
      <div className="sec-hd"><div className="sec-t"><Mi>list</Mi>My Customers</div></div>
      <div className="fbar">
        <SearchBox placeholder="Search name, phone, property..." />
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
