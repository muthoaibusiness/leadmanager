import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getTarget, queryLeads } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import KpiSheet from '../KpiSheet.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import SuccessGauge from '../SuccessGauge.jsx';
import ConversionPanel from './ConversionPanel.jsx';
import Mi from '../Mi.jsx';
import Spinner, { LoadingBlock } from '../Spinner.jsx';
import { scoreLead, scoreLabel } from '../../lib/helpers.js';
import { STATUS_LABELS, ROLES } from '../../lib/constants.js';
import { panelConfigFor } from '../../lib/funnel.js';
import useActWindow from '../../hooks/useActWindow.js';
import useLeadCounts from '../../hooks/useLeadCounts.js';
import { eq, is, lt, or, forwardedToRole } from '../../lib/leadQuery.js';

export default function MeetingAgentDash() {
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, dbVersion, setPanLead, nav, dateRange } = useApp();
  void dbVersion;
  const db = getDB();
  const [detail, setDetail] = useState(null);

  // ── Stage tiles: counted on the server, listed only when clicked ────────
  // Every one of these is a plain predicate on the lead row, so none of the
  // numbers has to wait for the book (which this page still loads underneath,
  // for the funnel and the ranked visit lists below).
  //
  // involved:false throughout — a Meeting Agent's pipeline is the leads they
  // HOLD. The one exception is "Offer Sent", which is by definition a lead they
  // no longer hold, so it needs the involved superset.
  const cardQ = useMemo(() => {
    const mine = { user, involved: false };
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return {
      // NOT `meeting_attended.is.false`: the column is null on every lead written
      // before it existed, and null is not false to Postgres — the old test was
      // `!l.meetingAttended`, which treats both the same. Getting this wrong
      // silently reads 0 instead of 16.
      set: { ...mine, extra: [eq('status', 'MEETING_SET'), or(is('meeting_attended', 'false'), is('meeting_attended', 'null'))] },
      att: { ...mine, extra: [eq('status', 'MEETING_SET'), is('meeting_attended', 'true')] },
      sched: { ...mine, extra: [eq('status', 'SITE_VISIT_SCHEDULED')] },
      done: { ...mine, extra: [eq('status', 'SITE_VISIT_DONE')] },
      tl: { user, involved: true, extra: [forwardedToRole(user.id, ROLES.TL)] },
      unqualified: { ...mine, extra: [eq('status', 'NOT_INTERESTED')] },
      overdue: { ...mine, extra: [eq('status', 'SITE_VISIT_SCHEDULED'), lt('meeting_date', todayStart.toISOString())] },
    };
  }, [user]);
  const counts = useLeadCounts(cardQ);
  // null while the count is in flight — StatCard and the stage tiles below
  // render a spinner for it rather than a placeholder that looks like data.
  const n = (k) => counts[k];

  // -- The visit lists -----------------------------------------------------
  // The tiles above are counts; these two panels need the rows themselves, so
  // they come from ONE bounded query for scheduled visits rather than from a
  // download of the agent's whole book. Splitting today / overdue / upcoming
  // happens below, on that page of rows.
  const VISITS_FETCH = 100;
  const [visitRows, setVisitRows] = useState(null);
  useEffect(() => {
    let alive = true;
    queryLeads({ user, involved: false, extra: [eq('status', 'SITE_VISIT_SCHEDULED')] },
      { page: 0, size: VISITS_FETCH, sort: 'oldest' })
      .then(res => { if (alive && res) setVisitRows(res.rows); });
    return () => { alive = false; };
  }, [user, dbVersion]);

  const view = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    // The stage tiles are server counts now (cardQ above). What is left here are
    // the two LISTS the page renders — today's visits and what is coming up —
    // which need the rows themselves, ranked by lead score.
    const sched = visitRows || [];

    // Today's visits = ONLY visits scheduled for today (not all pending work).
    const todayVisits = sched
      .filter(l => l.meetingDate && new Date(l.meetingDate) >= todayStart && new Date(l.meetingDate) <= todayEnd)
      .sort((a, b) => new Date(a.meetingDate) - new Date(b.meetingDate));
    const overdue = sched.filter(l => l.meetingDate && new Date(l.meetingDate) < todayStart);
    const upcoming = sched
      .filter(l => l.meetingDate && new Date(l.meetingDate) > todayEnd)
      .sort((a, b) => new Date(a.meetingDate) - new Date(b.meetingDate));

    return { todayVisits, overdue, upcoming };
  }, [visitRows, dbVersion]);

  // The visual pipeline funnel (clickable stages).
  const STAGES = [
    { key: 'set', label: 'Meeting Set', sub: 'to attend', color: 'var(--orange)' },
    { key: 'att', label: 'Meeting Attended', sub: 'needs a visit', color: 'var(--accent)' },
    { key: 'sched', label: 'Visit Scheduled', sub: 'upcoming' },
    { key: 'done', label: 'Visit Done', sub: 'completed', color: '#2DD4BF' },
    { key: 'tl', label: 'Offer Sent', sub: 'handed off', color: 'var(--accent)' },
  ];

  return (
    <div className="iad-page">
      <DashGreeting user={user} sub={view.todayVisits.length > 0
        ? `${view.todayVisits.length} ${view.todayVisits.length === 1 ? 'visit' : 'visits'} scheduled today`
        : "No visits scheduled today."} />

      {/* Pipeline bar — Meeting Set → Attended → Visit Scheduled → Visit Done → Offer Sent */}
      <div className="mpipe">
        {STAGES.map((s, i) => (
          <button key={s.key} className="mpipe-seg" onClick={() => setDetail({ title: s.label, query: cardQ[s.key], total: counts[s.key] })}>
            <span className="mpipe-step">Step {i + 1}</span>
            <span className="mpipe-num" style={counts[s.key] && s.color ? { color: s.color } : undefined}>
              {counts[s.key] == null ? <Spinner size={16} /> : counts[s.key]}
            </span>
            <span className="mpipe-lbl">{s.label}</span>
            <span className="mpipe-bar" style={{ background: s.color || 'var(--t3)' }} />
          </button>
        ))}
      </div>

      <div className="grid-2">
        <StatCard val={n('overdue')} label="Overdue Visits" tone={counts.overdue ? 'danger' : ''} sub="past due" onClick={() => setDetail({ title: 'Overdue Visits', query: cardQ.overdue, total: counts.overdue })} />
        <StatCard val={n('unqualified')} label="Unqualified" tone={counts.unqualified ? 'danger' : ''} sub="not interested" onClick={() => setDetail({ title: 'Unqualified', query: cardQ.unqualified, total: counts.unqualified })} />
      </div>

      {/* Starts at Meeting Set: a Meeting Agent only ever receives leads that far along. */}
      {(() => {
        const cfg = panelConfigFor(user.role);
        return (
          <ConversionPanel
            leads={[]}
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
            {visitRows === null ? (
              <LoadingBlock label="Loading today's visits…" />
            ) : view.todayVisits.length === 0 ? (
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
