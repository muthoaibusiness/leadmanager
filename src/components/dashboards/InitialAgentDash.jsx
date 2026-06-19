import { useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import TargetCard from './TargetCard.jsx';
import Mi from '../Mi.jsx';
import Avatar from '../Avatar.jsx';
import { scoreLead, scoreLabel } from '../../lib/helpers.js';
import { STATUS_LABELS, SRC_LABELS } from '../../lib/constants.js';

const CLOSED = ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
const REACHED_MEETING = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON'];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Why a lead needs a touch now + its priority. 0 overdue · 1 never called · 2 due today
function queueReason(lead, touched, todayStart, todayEnd) {
  const fu = lead.nextFollowup ? new Date(lead.nextFollowup) : null;
  if (fu && fu < todayStart) return { label: 'Overdue', cls: 'iad-rs-overdue', prio: 0 };
  if (!touched) return { label: 'Never called', cls: 'iad-rs-new', prio: 1 };
  if (fu && fu >= todayStart && fu <= todayEnd) return { label: 'Due today', cls: 'iad-rs-today', prio: 2 };
  return null;
}

export default function InitialAgentDash() {
  const { user, dbVersion, setPanLead, nav } = useApp();
  void dbVersion; // re-render when DB changes
  const db = getDB();
  const leads = getLeads(user);

  const view = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
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
    const myActs = Object.values(acts).flat();
    const callsToday = myActs.filter(a => a.userId === user.id && a.type === 'CALL' && new Date(a.timestamp) >= todayStart).length;
    const meetingsToday = db.leads.filter(l => l.meetingSetBy === user.id && l.meetingSetDate && new Date(l.meetingSetDate) >= todayStart).length;
    const reached = leads.filter(l => l.meetingSetBy === user.id || REACHED_MEETING.includes(l.status)).length;
    const conv = leads.length ? Math.round(reached / leads.length * 100) : 0;

    // ── Today's meetings — visits scheduled today on my / forwarded leads ──
    const meetings = db.leads
      .filter(l => (l.assignedTo === user.id || l.meetingSetBy === user.id) && l.meetingDate &&
        new Date(l.meetingDate) >= todayStart && new Date(l.meetingDate) <= todayEnd)
      .sort((a, b) => new Date(a.meetingDate) - new Date(b.meetingDate));

    return { now, queue, untouched, callsToday, meetingsToday, conv, active, meetings };
  }, [leads, db, user.id, dbVersion]);

  const QUEUE_CAP = 8;
  const shown = view.queue.slice(0, QUEUE_CAP);
  const firstName = (user.name || '').trim().split(/\s+/)[0];

  return (
    <>
      <div className="iad-page">
      {/* Greeting */}
      <div className="iad-greet">
        <div className="iad-greet-hi">{greeting()}, <span>{firstName}</span></div>
        <div className="iad-greet-sub">
          {view.queue.length > 0
            ? <>{view.queue.length} {view.queue.length === 1 ? 'lead' : 'leads'} to work today</>
            : <>You're all caught up.</>}
        </div>
      </div>

      {/* KPIs — labels only, no icons */}
      <div className="grid-4">
        <StatCard val={view.untouched.length} label="Untouched" tone={view.untouched.length ? 'warn' : ''} sub="need first call" />
        <StatCard val={view.callsToday} label="Calls Today" sub="logged" />
        <StatCard val={view.meetingsToday} label="Meetings Set" tone={view.meetingsToday ? 'good' : ''} sub="today" />
        <StatCard val={view.conv + '%'} label="To Meeting" tone="accent" sub="conversion" />
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
                      <Avatar name={l.name} avatar={l.avatar} className="iad-q-av" />
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

        {/* Rail: monthly target + today's meetings */}
        <aside className="iad-rail">
          <TargetCard user={user} />
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Today's meetings</span>
              {view.meetings.length > 0 && <span className="iad-q-ct">{view.meetings.length}</span>}
            </div>
            {view.meetings.length === 0 ? (
              <div className="iad-q-empty iad-q-empty-quiet">
                <span>No meetings scheduled today.</span>
              </div>
            ) : (
              <div className="iad-q-list">
                {view.meetings.map(l => (
                  <div key={l.id} className="iad-q-row" onClick={() => setPanLead(l.id)}>
                    <div className="iad-mt-time">{new Date(l.meetingDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="iad-q-info">
                      <div className="iad-q-name">{l.name}</div>
                      <div className="iad-q-meta">{l.meetingLocation || 'Site visit'} · {STATUS_LABELS[l.status] || l.status}</div>
                    </div>
                    <a className="iad-q-call" href={`tel:${l.phone}`} title="Call" onClick={e => e.stopPropagation()}><Mi>call</Mi></a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      </div>
    </>
  );
}
