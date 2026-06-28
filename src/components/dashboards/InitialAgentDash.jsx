import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, clearFollowup } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import KpiSheet from '../KpiSheet.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import SuccessGauge from '../SuccessGauge.jsx';
import Mi from '../Mi.jsx';
import { scoreLead, scoreLabel } from '../../lib/helpers.js';
import { STATUS_LABELS, SRC_LABELS } from '../../lib/constants.js';

const CLOSED = ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];

// Why a lead needs a touch now + its priority. 0 overdue · 1 never called · 2 due today
function queueReason(lead, touched, todayStart, todayEnd) {
  const fu = lead.nextFollowup ? new Date(lead.nextFollowup) : null;
  if (fu && fu < todayStart) return { label: 'Overdue', cls: 'iad-rs-overdue', prio: 0 };
  if (!touched) return { label: 'Never called', cls: 'iad-rs-new', prio: 1 };
  if (fu && fu >= todayStart && fu <= todayEnd) return { label: 'Due today', cls: 'iad-rs-today', prio: 2 };
  return null;
}

export default function InitialAgentDash() {
  const { user, dbVersion, setPanLead, nav, refreshDB, showToast, dateRange } = useApp();
  const [detail, setDetail] = useState(null);
  void dbVersion; // re-render when DB changes
  const db = getDB();
  const leads = getLeads(user);

  const view = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    // Activity KPIs follow the global date filter (calendar). No range = all time.
    const r = dateRange?.range;
    const winStart = r ? new Date(r.start) : new Date(0);
    const winEnd = r ? new Date(r.end) : todayEnd;
    const inWin = (ts) => { if (!ts) return false; const d = new Date(ts); return d >= winStart && d <= winEnd; };
    const acts = db.activities || {};
    const touched = (l) =>
      (l.callCount || 0) > 0 || (l.smsCount || 0) > 0 || (l.whatsappCount || 0) > 0 ||
      (acts[l.id] || []).some(a => ['CALL', 'SMS', 'WHATSAPP', 'VISIT'].includes(a.type));

    const active = leads.filter(l => !CLOSED.includes(l.status));

    const queue = active
      .map(l => ({ l, r: queueReason(l, touched(l), todayStart, todayEnd), score: scoreLead(l, acts[l.id]) }))
      .filter(x => x.r)
      .sort((a, b) => a.r.prio - b.r.prio || b.score - a.score || new Date(a.l.createdAt) - new Date(b.l.createdAt));

    const untouched = active.filter(l => !touched(l));
    const leadName = {}; db.leads.forEach(l => { leadName[l.id] = l.name; });
    const myCallList = []; let talkSecs = 0;
    Object.entries(acts).forEach(([lid, arr]) => (arr || []).forEach(a => {
      if (a.userId === user.id && a.type === 'CALL' && inWin(a.timestamp)) {
        talkSecs += (a.durationSeconds || 0);
        myCallList.push({ leadId: lid, title: leadName[lid] || 'Lead', sub: 'call', ts: a.timestamp, right: Math.round((a.durationSeconds || 0) / 60) + 'm' });
      }
    }));
    const callsToday = myCallList.length;
    const talkMins = Math.round(talkSecs / 60);
    const meetingLeads = db.leads.filter(l => l.meetingSetBy === user.id && inWin(l.meetingSetDate));
    const meetingsToday = meetingLeads.length;

    // ── Follow-ups due today (+ overdue) — the task list ──
    const followToday = active
      .filter(l => l.nextFollowup && new Date(l.nextFollowup) <= todayEnd)
      .sort((a, b) => new Date(a.nextFollowup) - new Date(b.nextFollowup));

    // ── Totals for the selected date range (leads received in the period) ──
    const periodLeads = getLeads(user, { involved: true }).filter(l => inWin(l.createdAt));
    const connectedLeads = periodLeads.filter(l => (l.callCount || 0) > 0 || l.status !== 'NEW');
    const interestedLeads = periodLeads.filter(l => l.status === 'INTERESTED');
    const followLeads = periodLeads.filter(l => l.nextFollowup && !CLOSED.includes(l.status));
    const totals = { leads: periodLeads.length, connected: connectedLeads.length, interested: interestedLeads.length, onFollowup: followLeads.length };
    const sets = { leads: periodLeads, connected: connectedLeads, interested: interestedLeads, onFollowup: followLeads, untouched, meetings: meetingLeads, calls: myCallList };

    return { now, todayStart, queue, untouched, callsToday, talkMinsToday: talkMins, meetingsToday, active, followToday, totals, sets };
  }, [leads, db, user.id, dbVersion, dateRange]);

  const QUEUE_CAP = 8;
  const shown = view.queue.slice(0, QUEUE_CAP);
  const PERIOD_LABELS = {
    today: 'today', yesterday: 'yesterday', last7: 'last 7 days', last28: 'last 28 days',
    last30: 'last 30 days', thisMonth: 'this month', lastMonth: 'last month', last90: 'last 90 days',
    qtd: 'quarter to date', thisYear: 'this year', lastYear: 'last year', allTime: 'all time', custom: 'selected range',
  };
  const periodSub = PERIOD_LABELS[dateRange?.preset] || (dateRange?.range ? 'selected range' : 'all time');

  return (
    <>
      <div className="iad-page">
      {/* Greeting */}
      <DashGreeting user={user} sub={view.queue.length > 0
        ? `${view.queue.length} ${view.queue.length === 1 ? 'lead' : 'leads'} to work today`
        : "You're all caught up."} />

      {/* All-time totals — every lead received / actioned */}
      <div className="grid-4">
        <StatCard val={view.totals.leads} label="Total Leads" sub={periodSub} onClick={() => setDetail({ title: 'Total Leads', leads: view.sets.leads })} />
        <StatCard val={view.totals.connected} label="Connected" tone={view.totals.connected ? 'accent' : ''} sub="called" onClick={() => setDetail({ title: 'Connected', leads: view.sets.connected })} />
        <StatCard val={view.totals.interested} label="Interested" tone={view.totals.interested ? 'good' : ''} sub="qualified" onClick={() => setDetail({ title: 'Interested', leads: view.sets.interested })} />
        <StatCard val={view.totals.onFollowup} label="On Follow-up" tone={view.totals.onFollowup ? 'warn' : ''} sub="active" onClick={() => setDetail({ title: 'On Follow-up', leads: view.sets.onFollowup })} />
      </div>

      {/* KPIs — labels only, no icons */}
      <div className="grid-4">
        <StatCard val={view.untouched.length} label="Untouched" tone={view.untouched.length ? 'warn' : ''} sub="need first call" onClick={() => setDetail({ title: 'Untouched', leads: view.sets.untouched })} />
        <StatCard val={view.callsToday} label="Calls" sub={periodSub} onClick={() => setDetail({ title: 'Calls', rows: view.sets.calls })} />
        <StatCard val={view.talkMinsToday + ' min'} label="Talk Time" tone={view.talkMinsToday ? 'accent' : ''} sub={periodSub} onClick={() => setDetail({ title: 'Talk Time · calls', rows: view.sets.calls })} />
        <StatCard val={view.meetingsToday} label="Meetings Set" tone={view.meetingsToday ? 'good' : ''} sub={periodSub} onClick={() => setDetail({ title: 'Meetings Set', leads: view.sets.meetings })} />
      </div>

      {/* Follow-ups due today — task list */}
      <div className="iad-fu">
        <div className="iad-q-hd">
          <span className="iad-q-ttl">Follow-ups due today</span>
          {view.followToday.length > 0 && <span className="iad-q-ct">{view.followToday.length}</span>}
        </div>
        {view.followToday.length === 0 ? (
          <div className="iad-fu-empty">No follow-ups due today. Scheduled ones show here when their day arrives.</div>
        ) : (
          <table className="fut">
            <thead>
              <tr><th>Customer</th><th>Due</th><th>Status</th><th aria-label="actions" /></tr>
            </thead>
            <tbody>
              {view.followToday.map(l => {
                const fu = new Date(l.nextFollowup);
                const overdue = fu < view.todayStart;
                const time = fu.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const day = fu.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                return (
                  <tr key={l.id} onClick={() => setPanLead(l.id)}>
                    <td><div className="fut-name">{l.name}</div><div className="fut-sub">{l.phone} · {SRC_LABELS[l.source] || l.source}</div></td>
                    <td><span className={`fut-due${overdue ? ' over' : ''}`}>{overdue ? `Overdue · ${day}` : time}</span></td>
                    <td><span className="fut-status">{STATUS_LABELS[l.status] || l.status}</span></td>
                    <td>
                      <div className="fut-act">
                        <a className="fut-ico" href={`tel:${l.phone}`} title="Call" onClick={e => e.stopPropagation()}><Mi>call</Mi></a>
                        <button className="fut-ico fut-done" title="Mark done"
                          onClick={e => { e.stopPropagation(); clearFollowup(l.id, user); refreshDB(); showToast('Follow-up completed', 'ok'); }}>
                          <Mi>check</Mi>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Main (call list) + rail (target · today's meetings) */}
      <div className="iad-layout">
        {/* Primary: today's call list */}
        <div className="iad-main">
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Today's call list</span>
              {view.queue.length > 0 && <span className="iad-q-ct">{view.queue.length}</span>}
            </div>
            {shown.length === 0 ? (
              <div className="iad-q-empty">
                <Mi>check_circle</Mi>
                <b>All caught up</b>
                <span>No leads waiting to be called.</span>
              </div>
            ) : (
              <div className="iad-q-list">
                {shown.map(({ l, r, score }) => {
                  const sl = scoreLabel(score);
                  return (
                    <div key={l.id} className="iad-q-row" onClick={() => setPanLead(l.id)}>
                      <div className="iad-q-info">
                        <div className="iad-q-name">{l.name}</div>
                        <div className="iad-q-meta">{l.phone} · {SRC_LABELS[l.source] || l.source}</div>
                      </div>
                      <span className={`iad-rs ${r.cls}`}>{r.label}</span>
                      <span className="iad-q-score" style={{ color: sl.color }}>{sl.label}</span>
                      <a className="iad-q-call" href={`tel:${l.phone}`} title="Call" onClick={e => e.stopPropagation()}><Mi>call</Mi></a>
                    </div>
                  );
                })}
                {view.queue.length > QUEUE_CAP && (
                  <div className="iad-q-more" onClick={() => nav('leads')}>View all in Leads</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Rail: monthly target + success rate */}
        <aside className="iad-rail">
          <TargetCard user={user} />
          <SuccessGauge user={user} />
        </aside>
      </div>

      </div>
      <KpiSheet detail={detail} onClose={() => setDetail(null)} onLead={(id) => { setDetail(null); setPanLead(id); }} />
    </>
  );
}
