import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, getTarget } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import KpiSheet from '../KpiSheet.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import SuccessGauge from '../SuccessGauge.jsx';
import ConversionPanel from './ConversionPanel.jsx';
import Mi from '../Mi.jsx';
import { scoreLead, scoreLabel } from '../../lib/helpers.js';
import { STATUS_LABELS, ROLES } from '../../lib/constants.js';
import { panelConfigFor } from '../../lib/funnel.js';

export default function MeetingAgentDash() {
  const { user, dbVersion, setPanLead, nav, dateRange } = useApp();
  void dbVersion;
  const db = getDB();
  const leads = getLeads(user);
  // Separate set for the funnel: forwarding a lead to a Team Lead drops it out of
  // getLeads(user), which would permanently zero the MA's Won bar. Kept apart from
  // `leads` so the existing stage tiles below keep their current scoping.
  const panelLeads = getLeads(user, { involved: true });
  const [detail, setDetail] = useState(null);

  const view = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    // Pipeline stages (non-overlapping): Meeting Set → Attended → Visit Scheduled
    // → Visit Done → Offer Sent. Unqualified is the drop-off.
    const meetingSet = leads.filter(l => l.status === 'MEETING_SET' && !l.meetingAttended); // awaiting attend
    const attended = leads.filter(l => l.status === 'MEETING_SET' && l.meetingAttended);    // attended, needs a visit
    const sched = leads.filter(l => l.status === 'SITE_VISIT_SCHEDULED');
    const done = leads.filter(l => l.status === 'SITE_VISIT_DONE');
    const fwdTL = db.leads.filter(l => (l.previousAssignees || []).includes(user.id) && l.assignedRole === ROLES.TL);
    const unqualified = leads.filter(l => l.status === 'NOT_INTERESTED');

    // Today's visits = ONLY visits scheduled for today (not all pending work).
    const todayVisits = sched
      .filter(l => l.meetingDate && new Date(l.meetingDate) >= todayStart && new Date(l.meetingDate) <= todayEnd)
      .sort((a, b) => new Date(a.meetingDate) - new Date(b.meetingDate));
    const overdue = sched.filter(l => l.meetingDate && new Date(l.meetingDate) < todayStart);
    const upcoming = sched
      .filter(l => l.meetingDate && new Date(l.meetingDate) > todayEnd)
      .sort((a, b) => new Date(a.meetingDate) - new Date(b.meetingDate));

    return { meetingSet, attended, sched, done, fwdTL, unqualified, todayVisits, overdue, upcoming };
  }, [leads, db, user.id, dbVersion]);

  // The visual pipeline funnel (clickable stages).
  const STAGES = [
    { key: 'set', label: 'Meeting Set', sub: 'to attend', val: view.meetingSet.length, leads: view.meetingSet, color: 'var(--orange)' },
    { key: 'att', label: 'Meeting Attended', sub: 'needs a visit', val: view.attended.length, leads: view.attended, color: 'var(--accent)' },
    { key: 'sched', label: 'Visit Scheduled', sub: 'upcoming', val: view.sched.length, leads: view.sched },
    { key: 'done', label: 'Visit Done', sub: 'completed', val: view.done.length, leads: view.done, color: '#2DD4BF' },
    { key: 'tl', label: 'Offer Sent', sub: 'handed off', val: view.fwdTL.length, leads: view.fwdTL, color: 'var(--accent)' },
  ];

  return (
    <div className="iad-page">
      <DashGreeting user={user} sub={view.todayVisits.length > 0
        ? `${view.todayVisits.length} ${view.todayVisits.length === 1 ? 'visit' : 'visits'} scheduled today`
        : "No visits scheduled today."} />

      {/* Pipeline bar — Meeting Set → Attended → Visit Scheduled → Visit Done → Offer Sent */}
      <div className="mpipe">
        {STAGES.map((s, i) => (
          <button key={s.key} className="mpipe-seg" onClick={() => setDetail({ title: s.label, leads: s.leads })}>
            <span className="mpipe-step">Step {i + 1}</span>
            <span className="mpipe-num" style={s.val && s.color ? { color: s.color } : undefined}>{s.val}</span>
            <span className="mpipe-lbl">{s.label}</span>
            <span className="mpipe-bar" style={{ background: s.color || 'var(--t3)' }} />
          </button>
        ))}
      </div>

      <div className="grid-2">
        <StatCard val={view.overdue.length} label="Overdue Visits" tone={view.overdue.length ? 'danger' : ''} sub="past due" onClick={() => setDetail({ title: 'Overdue Visits', leads: view.overdue })} />
        <StatCard val={view.unqualified.length} label="Unqualified" tone={view.unqualified.length ? 'danger' : ''} sub="not interested" onClick={() => setDetail({ title: 'Unqualified', leads: view.unqualified })} />
      </div>

      {/* Starts at Meeting Set: a Meeting Agent only ever receives leads that far along. */}
      {(() => {
        const cfg = panelConfigFor(user.role);
        return (
          <ConversionPanel
            leads={panelLeads}
            activities={db.activities || {}}
            dateRange={dateRange}
            stages={cfg.stages}
            seriesKeys={cfg.seriesKeys}
            title={cfg.title}
          />
        );
      })()}

      <div className="iad-layout">
        {/* Primary: today's scheduled visits only */}
        <div className="iad-main">
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Today's visits</span>
              {view.todayVisits.length > 0 && <span className="iad-q-ct">{view.todayVisits.length}</span>}
            </div>
            {view.todayVisits.length === 0 ? (
              <div className="iad-q-empty">
                <Mi>event_available</Mi>
                <b>No visits today</b>
                <span>Nothing scheduled for today.</span>
              </div>
            ) : (
              <div className="iad-q-list">
                {view.todayVisits.map(l => {
                  const sl = scoreLabel(scoreLead(l, db.activities?.[l.id]));
                  return (
                    <div key={l.id} className="iad-q-row" onClick={() => setPanLead(l.id)}>
                      <div className="iad-mt-time">{new Date(l.meetingDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                      <div className="iad-q-info">
                        <div className="iad-q-name">{l.name}</div>
                        <div className="iad-q-meta">{l.meetingLocation || 'Site visit'} · {l.propertyInterest || 'No project'}</div>
                      </div>
                      <span className="iad-q-score" style={{ color: sl.color }}>{sl.label}</span>
                      <a className="iad-q-call" href={`tel:${l.phone}`} title="Call" onClick={e => e.stopPropagation()}><Mi>call</Mi></a>
                    </div>
                  );
                })}
                <div className="iad-q-more" onClick={() => nav('calendar')}>Open calendar</div>
              </div>
            )}
          </div>
        </div>

        {/* Rail: monthly target + upcoming scheduled visits */}
        <aside className="iad-rail">
          {getTarget(user.id) && <TargetCard user={user} />}
          <SuccessGauge user={user} />
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
      <KpiSheet detail={detail} onClose={() => setDetail(null)} onLead={(id) => { setDetail(null); setPanLead(id); }} />
    </div>
  );
}
