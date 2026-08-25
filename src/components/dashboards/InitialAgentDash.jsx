import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, clearFollowup, queryLeads } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import KpiSheet from '../KpiSheet.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import SuccessGauge from '../SuccessGauge.jsx';
import ConversionPanel from './ConversionPanel.jsx';
import Mi from '../Mi.jsx';
import { LoadingBlock } from '../Spinner.jsx';
import { scoreLead, scoreLabel, periodLabel } from '../../lib/helpers.js';
import { STATUS_LABELS, SRC_LABELS, PAST_CONTACT } from '../../lib/constants.js';
import { or, and, KPI } from '../../lib/leadQuery.js';
import { panelConfigFor } from '../../lib/funnel.js';
import useActWindow from '../../hooks/useActWindow.js';
import useLeadCounts from '../../hooks/useLeadCounts.js';

const CLOSED = ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];

// "Contacted" for the conversion rate, as a query term. agentPerf counts a lead
// as contacted when it reached CONTACTED+ or has any logged call — call_count
// includes no-answers there too, so this is the same rule, not a stricter one.
const CONTACTED_TERM = or(`status.in.(${PAST_CONTACT.join(',')})`, 'call_count.gt.0');

// Why a lead needs a touch now + its priority. 0 overdue · 1 never called · 2 due today
function queueReason(lead, touched, todayStart, todayEnd) {
  const fu = lead.nextFollowup ? new Date(lead.nextFollowup) : null;
  if (fu && fu < todayStart) return { label: 'Overdue', cls: 'iad-rs-overdue', prio: 0 };
  if (!touched) return { label: 'Never called', cls: 'iad-rs-new', prio: 1 };
  if (fu && fu >= todayStart && fu <= todayEnd) return { label: 'Due today', cls: 'iad-rs-today', prio: 2 };
  return null;
}

export default function InitialAgentDash() {
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, dbVersion, setPanLead, nav, refreshDB, showToast, dateRange } = useApp();
  const [detail, setDetail] = useState(null);
  void dbVersion; // re-render when DB changes
  const db = getDB();

  // ── KPI cards: counted on the server, listed only when clicked ──────────
  // The window the activity KPIs already follow, reused so a card and its
  // drill-down agree with the date picker.
  const win = dateRange?.range || null;
  // One opts object per card. Memoised because useLeadCounts keys its batch on
  // identity — a new object every render would recount every render.
  const cardQ = useMemo(() => {
    const base = { user, involved: true, start: win?.start, end: win?.end };
    return {
      leads: base,
      connected: { ...base, kpi: 'connected' },
      interested: { ...base, kpi: 'interested' },
      notInterested: { ...base, kpi: 'notInterested' },
      // Workload cards are pipeline-wide (not date-scoped: an untouched lead
      // from last month is still untouched today) and cover only the leads this
      // agent HOLDS — involved:false. A lead they forwarded on is somebody
      // else's follow-up now, and counting it here would inflate their queue.
      untouched: { user, involved: false, kpi: 'untouched' },
      followPending: { user, involved: false, kpi: 'followPending' },
      // Meetings this agent set, dated by when they set them.
      meetings: { user, involved: true, kpi: 'meetingsSet', kpiArg: user.id, dateField: 'meeting_set_date', start: win?.start, end: win?.end },
      // Conversion = contacted ÷ sourced, the same metric the Team Lead sees in
      // Agent Performance. Two counts over the same population.
      sourced: { ...base, kpi: 'sourced', kpiArg: user.id },
      sourcedContacted: { ...base, kpi: 'sourced', kpiArg: user.id, extra: [CONTACTED_TERM] },
    };
  }, [user, win?.start, win?.end]);
  const counts = useLeadCounts(cardQ);
  const contactRate = counts.sourced ? Math.round((counts.sourcedContacted || 0) / counts.sourced * 100) : 0;
  // A card shows the count the moment it lands; until then an em dash, which
  // reads as "still counting" rather than as a real zero.
  const n = (k) => (counts[k] == null ? '—' : counts[k]);

  // -- The work queue ------------------------------------------------------
  // This page no longer downloads the agent's book. The queue is a bounded
  // QUERY: open leads that are either due (a follow-up dated today or earlier)
  // or have never been worked at all -- which is exactly what queueReason()
  // recognises. Ranking still happens here, because lead score reads the
  // activity timeline and cannot be expressed as an ORDER BY.
  //
  // The cap is generous relative to what the panel shows (8) and to the
  // follow-up table beneath it; anything past it is one click away in Leads.
  const QUEUE_FETCH = 120;
  const [queueRows, setQueueRows] = useState(null);
  const [oldestUntouched, setOldestUntouched] = useState(null);
  useEffect(() => {
    let alive = true;
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const due = 'next_followup.lte.' + todayEnd.toISOString();
    queryLeads(
      { user, involved: false, extra: [KPI.active(), or(and('next_followup.not.is.null', due), KPI.untouched())] },
      { page: 0, size: QUEUE_FETCH, sort: 'oldest' },
    ).then(res => { if (alive && res) setQueueRows(res.rows); });
    // The "oldest untouched" sub-label is one row, so it costs one row's worth
    // of request rather than a scan over everything.
    queryLeads({ user, involved: false, kpi: 'untouched' }, { page: 0, size: 1, sort: 'oldest' })
      .then(res => { if (alive && res) setOldestUntouched(res.rows[0] || null); });
    return () => { alive = false; };
  }, [user, dbVersion]);
  const bookReady = queueRows !== null;

  const view = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const acts = db.activities || {};
    const touched = (l) =>
      (l.callCount || 0) > 0 || (l.smsCount || 0) > 0 || (l.whatsappCount || 0) > 0 ||
      (acts[l.id] || []).some(a => ['CALL', 'SMS', 'WHATSAPP', 'VISIT'].includes(a.type));

    const rows = queueRows || [];
    const active = rows.filter(l => !CLOSED.includes(l.status));

    const queue = active
      .map(l => ({ l, r: queueReason(l, touched(l), todayStart, todayEnd), score: scoreLead(l, acts[l.id]) }))
      .filter(x => x.r)
      .sort((a, b) => a.r.prio - b.r.prio || b.score - a.score || new Date(a.l.createdAt) - new Date(b.l.createdAt));

    // ── Follow-ups due today (+ overdue) — the task list ──
    const followToday = active
      .filter(l => l.nextFollowup && new Date(l.nextFollowup) <= todayEnd)
      .sort((a, b) => new Date(a.nextFollowup) - new Date(b.nextFollowup));

    // Oldest never-called lead - one row, fetched above.
    const oldestUntouchedAt = oldestUntouched ? new Date(oldestUntouched.createdAt) : null;

    return { now, todayStart, queue, oldestUntouchedAt, active, followToday };
  }, [queueRows, oldestUntouched, db, dbVersion]);

  const QUEUE_CAP = 8;
  const shown = view.queue.slice(0, QUEUE_CAP);
  const periodSub = periodLabel(dateRange);
  const panelCfg = panelConfigFor(user.role);

  return (
    <>
      <div className="iad-page">
      {/* Greeting */}
      <DashGreeting user={user} sub={view.queue.length > 0
        ? `${view.queue.length} ${view.queue.length === 1 ? 'lead' : 'leads'} to work today`
        : "You're all caught up."} />

      {/* All-time totals — every lead received / actioned.
          Each value is a server-side count and each click fetches that set one
          page at a time (KpiSheet), so none of these rows are downloaded until
          somebody asks to see them. */}
      <div className="grid-4">
        <StatCard val={n('leads')} label="Total Leads" sub={periodSub} onClick={() => setDetail({ title: 'Total Leads', query: cardQ.leads, total: counts.leads })} />
        <StatCard val={n('connected')} label="Connected" tone={counts.connected ? 'accent' : ''} sub="called" onClick={() => setDetail({ title: 'Connected', query: cardQ.connected, total: counts.connected })} />
        <StatCard val={n('interested')} label="Interested" tone={counts.interested ? 'good' : ''} sub="qualified" onClick={() => setDetail({ title: 'Interested', query: cardQ.interested, total: counts.interested })} />
        <StatCard val={n('notInterested')} label="Not Interested" tone={counts.notInterested ? 'danger' : ''} sub="disqualified" onClick={() => setDetail({ title: 'Not Interested', query: cardQ.notInterested, total: counts.notInterested })} />
      </div>

      {/* Performance + workload — every card tells the agent what to do or how they're doing */}
      <div className="grid-4">
        <StatCard val={counts.sourced == null ? '—' : contactRate + '%'} label="Conversion Rate" tone={contactRate >= 50 ? 'good' : contactRate >= 25 ? 'accent' : ''} sub="contacted ÷ sourced" onClick={() => setDetail({ title: 'Conversion · sourced leads', query: cardQ.sourced, total: counts.sourced })} />
        <StatCard
          val={n('untouched')}
          label="Untouched"
          tone={counts.untouched ? 'warn' : ''}
          sub={view.oldestUntouchedAt ? 'oldest ' + view.oldestUntouchedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'all called'}
          onClick={() => setDetail({ title: 'Untouched · oldest first', query: cardQ.untouched, total: counts.untouched, sort: 'oldest' })}
        />
        <StatCard val={n('followPending')} label="Follow-Up Pending" tone={counts.followPending ? 'accent' : ''} sub="scheduled in pipeline" onClick={() => setDetail({ title: 'Follow-Up Pending', query: cardQ.followPending, total: counts.followPending })} />
        <StatCard val={n('meetings')} label="Meetings Set" tone={counts.meetings ? 'good' : ''} sub={periodSub} onClick={() => setDetail({ title: 'Meetings Set', query: cardQ.meetings, total: counts.meetings })} />
      </div>

      {/* Where leads drop off, and the last 30 days of stage events */}
      <ConversionPanel
        leads={[]}
        activities={db.activities || {}}
        dateRange={dateRange}
        stages={panelCfg.stages}
        seriesKeys={panelCfg.seriesKeys}
        title={panelCfg.title}
      />

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
            {!bookReady ? (
              <LoadingBlock label="Building your call list…" />
            ) : shown.length === 0 ? (
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
