import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import LeadTable from '../LeadTable.jsx';
import TargetCard from './TargetCard.jsx';
import Mi from '../Mi.jsx';
import SearchBox from '../SearchBox.jsx';
import { fmtD } from '../../lib/helpers.js';
import { STATUS_LABELS } from '../../lib/constants.js';

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
  const { user, search, dbVersion, dateRange, setPanLead } = useApp();
  void dbVersion; // re-render when DB changes
  const [statusFilter, setStatusFilter] = useState('ALL');
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

  // Leads this IA forwarded — so they can track status even after the lead leaves
  // their own list (assignedTo changes to the Meeting Agent / Team Lead).
  // Captured by meetingSetBy === me (set when forwarding to a Meeting Agent) OR
  // by being a previous assignee on a lead that has progressed past contact.
  const FWD_STATUSES = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];
  const meetingSetLeads = db.leads.filter(l =>
    l.meetingSetBy === user.id ||
    ((l.previousAssignees || []).includes(user.id) && FWD_STATUSES.includes(l.status))
  );

  // ── My customers table — same filter UI as the Leads page ──
  let disp = statusFilter === 'FORWARDED' ? meetingSetLeads
    : statusFilter === 'ALL' ? leads
    : leads.filter(l => l.status === statusFilter);
  if (search) { const q = search.toLowerCase(); disp = disp.filter(l => l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.propertyInterest || '').toLowerCase().includes(q)); }
  if (dateRange?.range) { const { start, end } = dateRange.range; disp = disp.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; }); }

  return (
    <>
      {/* 1 — Overview KPIs */}
      <div className="sec-hd"><div className="sec-t"><Mi>insights</Mi>My Day</div></div>
      <div className="grid-5">
        <StatCard val={leads.length} label="My Leads" ico="contacts" tone="accent" sub="total assigned" />
        <StatCard val={active.length} label="Open Deals" ico="trending_up" sub="in progress" />
        <StatCard val={untouched.length} label="Untouched" ico="fiber_new" tone={untouched.length ? 'warn' : ''} sub="need first call" />
        <StatCard val={overdue.length} label="Overdue Follow-ups" ico="alarm" tone={overdue.length ? 'danger' : ''} sub="late · call now" />
        <StatCard val={callsToday} label="My Calls Today" ico="call" sub={talkMinsToday + ' min talk'} />
      </div>

      {/* 2 — Priorities: target progress + who to call */}
      <div className="ia-priorities">
        <TargetCard user={user} />
        <FollowUpQueue leads={leads} onOpen={setPanLead} />
      </div>

      {/* 3 — Customers */}
      <div className="sec-hd"><div className="sec-t"><Mi>list</Mi>My Customers</div></div>
      <div className="fbar">
        <SearchBox placeholder="Search name, phone, property..." style={{ flex: '0 1 300px', minWidth: '180px' }} />
        <select className="fsel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="ALL">All status</option>
          <option value="FORWARDED">Forwarded / Meeting Set ({meetingSetLeads.length})</option>
          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <LeadTable leads={disp} />
    </>
  );
}
