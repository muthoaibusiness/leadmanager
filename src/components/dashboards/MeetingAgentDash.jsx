import { useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import Mi from '../Mi.jsx';
import { scoreLead, scoreLabel } from '../../lib/helpers.js';
import { STATUS_LABELS, ROLES } from '../../lib/constants.js';

// Why this lead needs the meeting agent now + its priority.
// 0 overdue visit · 1 visit today · 2 meeting set, needs a visit scheduled
function visitReason(lead, todayStart, todayEnd) {
  if (lead.status === 'SITE_VISIT_SCHEDULED') {
    const d = lead.meetingDate ? new Date(lead.meetingDate) : null;
    if (d && d < todayStart) return { label: 'Overdue', cls: 'iad-rs-overdue', prio: 0 };
    if (d && d >= todayStart && d <= todayEnd) return { label: 'Visit today', cls: 'iad-rs-today', prio: 1 };
    return null; // future visits live in the rail
  }
  if (lead.status === 'MEETING_SET') return { label: 'Schedule visit', cls: 'iad-rs-new', prio: 2 };
  return null;
}

export default function MeetingAgentDash() {
  const { user, dbVersion, setPanLead, nav } = useApp();
  void dbVersion;
  const db = getDB();
  const leads = getLeads(user);

  const view = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const acts = db.activities || {};

    const meetingSet = leads.filter(l => l.status === 'MEETING_SET');
    const sched = leads.filter(l => l.status === 'SITE_VISIT_SCHEDULED');
    const done = leads.filter(l => l.status === 'SITE_VISIT_DONE');
    // Leads this MA forwarded on to a Team Lead (handled earlier, now sits with a TL).
    const fwdTL = db.leads.filter(l => (l.previousAssignees || []).includes(user.id) && l.assignedRole === ROLES.TL);

    // Action queue: overdue visits → today's visits → meetings needing a visit.
    const queue = [...sched, ...meetingSet]
      .map(l => ({ l, r: visitReason(l, todayStart, todayEnd), score: scoreLead(l, acts[l.id]) }))
      .filter(x => x.r)
      .sort((a, b) => a.r.prio - b.r.prio || b.score - a.score || new Date(a.l.createdAt) - new Date(b.l.createdAt));

    // Upcoming visits (scheduled in the future) for the rail, by date.
    const upcoming = sched
      .filter(l => l.meetingDate && new Date(l.meetingDate) > todayEnd)
      .sort((a, b) => new Date(a.meetingDate) - new Date(b.meetingDate));

    return { meetingSet, sched, done, fwdTL, queue, upcoming };
  }, [leads, db, user.id, dbVersion]);

  const QUEUE_CAP = 8;
  const shown = view.queue.slice(0, QUEUE_CAP);

  return (
    <div className="iad-page">
      <DashGreeting user={user} sub={view.queue.length > 0
        ? `${view.queue.length} ${view.queue.length === 1 ? 'visit' : 'visits'} to handle today`
        : "No visits waiting — you're all set."} />

      <div className="grid-4">
        <StatCard val={view.meetingSet.length} label="Meeting Set" tone={view.meetingSet.length ? 'warn' : ''} sub="need a visit" />
        <StatCard val={view.sched.length} label="Visits Scheduled" sub="upcoming" />
        <StatCard val={view.done.length} label="Visits Done" tone={view.done.length ? 'good' : ''} sub="completed" />
        <StatCard val={view.fwdTL.length} label="Sent to Team Lead" tone="accent" sub="all time" />
      </div>

      <div className="iad-layout">
        {/* Primary: today's visit work */}
        <div className="iad-main">
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Today's visits</span>
              {view.queue.length > 0 && <span className="iad-q-ct">{view.queue.length}</span>}
            </div>
            {shown.length === 0 ? (
              <div className="iad-q-empty">
                <Mi>check_circle</Mi>
                <b>All caught up</b>
                <span>No visits to schedule or run right now.</span>
              </div>
            ) : (
              <div className="iad-q-list">
                {shown.map(({ l, r, score }) => {
                  const sl = scoreLabel(score);
                  return (
                    <div key={l.id} className="iad-q-row" onClick={() => setPanLead(l.id)}>
                      <div className="iad-q-info">
                        <div className="iad-q-name">{l.name}</div>
                        <div className="iad-q-meta">{l.phone} · {l.propertyInterest || l.dealProjectName || 'No project'}</div>
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

        {/* Rail: monthly target + upcoming scheduled visits */}
        <aside className="iad-rail">
          <TargetCard user={user} />
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Upcoming visits</span>
              {view.upcoming.length > 0 && <span className="iad-q-ct">{view.upcoming.length}</span>}
            </div>
            {view.upcoming.length === 0 ? (
              <div className="iad-q-empty iad-q-empty-quiet">
                <span>No future visits scheduled.</span>
              </div>
            ) : (
              <div className="iad-q-list">
                {view.upcoming.slice(0, 6).map(l => (
                  <div key={l.id} className="iad-q-row" onClick={() => setPanLead(l.id)}>
                    <div className="iad-mt-time">{new Date(l.meetingDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
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
  );
}
