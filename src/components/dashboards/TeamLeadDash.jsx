import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getDB, calcPipelineValue, getHoldRequests, hasOffer, hasOfferCol } from '../../lib/db.js';
import StatCard from '../StatCard.jsx';
import KpiSheet from '../KpiSheet.jsx';
import TargetCard from './TargetCard.jsx';
import DashGreeting from './DashGreeting.jsx';
import SuccessGauge from '../SuccessGauge.jsx';
import ConversionPanel from './ConversionPanel.jsx';
import Mi from '../Mi.jsx';
import { LoadingBlock } from '../Spinner.jsx';
import { fmtBDT, scoreLead, scoreLabel, fmtAgo, leadDisplayStatus } from '../../lib/helpers.js';
import { SRC_LABELS, ROLES } from '../../lib/constants.js';
import { panelConfigFor } from '../../lib/funnel.js';
import { Donut, Ring } from '../charts/Charts.jsx';
import useActWindow from '../../hooks/useActWindow.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import useRollup from '../../hooks/useRollup.js';
import { useEffect, useMemo } from 'react';
import { queryLeads } from '../../lib/db.js';
import { eq, or, notNull } from '../../lib/leadQuery.js';

function ScoredPipeline({ leads, db, onOpen, loading }) {
  if (loading) return <LoadingBlock label="Loading deals…" />;
  if (!leads.length) return <div className="iad-q-empty"><Mi>check_circle</Mi><b>Nothing to close</b><span>No deals with an offer waiting to close.</span></div>;
  const scored = leads
    .map(l => ({ l, score: scoreLead(l, db.activities?.[l.id] || []) }))
    .sort((a, b) => b.score - a.score);
  return (
    <div className="iad-q-list">
      {scored.map(({ l, score }) => {
        const sl = scoreLabel(score);
        const pipe = calcPipelineValue(l.id, db);
        return (
          <div key={l.id} className="iad-q-row" onClick={() => onOpen(l.id)}>
            <div className="iad-q-info">
              <div className="iad-q-name">{l.name}</div>
              {/* Every row here carries an offer by construction, so the badge says so. */}
              <div className="iad-q-meta">{leadDisplayStatus(l, { hasOffer: true }).label}{pipe > 0 ? ' · ' + fmtBDT(pipe) : ''} · {fmtAgo(l.updatedAt)}</div>
            </div>
            <span className="iad-q-score" style={{ color: sl.color }}>{sl.label}</span>
            <a className="iad-q-call" href={`tel:${l.phone}`} title="Call" onClick={e => e.stopPropagation()}><Mi>call</Mi></a>
          </div>
        );
      })}
    </div>
  );
}

export default function TeamLeadDash() {
  useActWindow(); // pull the recent-activity window; activities are not in the boot load
  const { user, dateRange, setPanLead } = useApp();
  const db = getDB();
  const [detail, setDetail] = useState(null);

  const hasRange = !!dateRange?.range;
  // Both bounds have to be STABLE across renders: they are stringified into
  // useRollup's effect key, so a `new Date()` recomputed on every render made
  // that key change every time — fetch, setState, re-render, fetch again. With
  // the default filter ("All time", range null) the fallback is always the one
  // in use, so the panel locked up on mount. The month-to-date meaning is
  // unchanged; the open end is just pinned to the end of today.
  const rangeStart = useMemo(
    () => dateRange?.range?.start || (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })(),
    [dateRange?.range?.start]);
  const rangeEnd = useMemo(
    () => dateRange?.range?.end || (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; })(),
    [dateRange?.range?.end]);
  const inRange = iso => { const d = new Date(iso); return d >= rangeStart && d <= rangeEnd; };

  const teamUsers = db.users.filter(u => u.teamId === user.teamId);
  const teamUserIds = teamUsers.map(u => u.id);

  // Every number on this page is a SUM or a GROUP BY — revenue, pipeline value,
  // talk time, the source mix, the leaderboard — none of which PostgREST can
  // express here. They come from the rollup functions (migration 0011) in three
  // requests instead of a whole-book download.
  //
  // `needBook` is the fallback switch: until the migration is applied the
  // rollup is null and the page reduces over ensureLeadBook()'s data exactly as
  // it used to. Nothing downloads the book while the rollup is answering.
  const rollOpts = useMemo(() => ({
    teamId: user.teamId || null,
    userIds: teamUserIds,
    start: rangeStart, end: rangeEnd,
    monthStart: (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })(),
  }), [user.teamId, teamUserIds.join(), rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rollup, agents, acts, needBook } = useRollup(rollOpts);
  useLeadBook(needBook);
  const leads = getLeads(user);

  // The two lists this page renders are rows, not numbers, so they are fetched
  // as a bounded page rather than filtered out of the book. 50 is well past
  // what the panel shows and keeps the request small.
  // Is the offer gate expressible server-side? null while the answer is in
  // flight. Everything below asks this ONE flag, so the list, the card and the
  // sheet behind it can never disagree about which leads are in the pipeline.
  const [offerCol, setOfferCol] = useState(null);
  useEffect(() => { let alive = true; hasOfferCol().then(v => { if (alive) setOfferCol(v); }); return () => { alive = false; }; }, []);

  const [closingRows, setClosingRows] = useState(null);
  useEffect(() => {
    if (needBook || offerCol === null) { setClosingRows(null); return; }
    let alive = true;
    // Only leads that carry an offer: forwarding to a Team Lead requires one
    // (fwdLead), so anything else in these statuses is not theirs to close.
    const statuses = or(eq('status', 'NEGOTIATING'), eq('status', 'SITE_VISIT_DONE'));
    const extra = offerCol ? [statuses, notNull('offer_sent_at')] : [statuses];
    queryLeads({ user, involved: true, extra }, { page: 0, size: 50, sort: 'updated' })
      .then(res => { if (alive && res) setClosingRows(offerCol ? res.rows : res.rows.filter(l => hasOffer(l, db))); });
    return () => { alive = false; };
  }, [user, needBook, offerCol]); // eslint-disable-line react-hooks/exhaustive-deps

  const allActs = Object.values(db.activities || {}).flat();

  // Book-derived values. When the rollup answered, only the lists still come
  // from here — every headline number is overridden a few lines down.
  const won = leads.filter(l => l.status === 'DEAL_CLOSED_WON' && inRange(l.updatedAt));
  const lost = leads.filter(l => l.status === 'DEAL_CLOSED_LOST' && inRange(l.updatedAt));
  // Same offer gate as the query above, for the pre-0011 book fallback.
  const neg = leads.filter(l => l.status === 'NEGOTIATING' && hasOffer(l, db));
  const toClose = leads.filter(l => l.status === 'SITE_VISIT_DONE' && hasOffer(l, db));
  const bookClosing = [...neg, ...toClose];
  // The primary work list: fetched as a bounded page when the rollup is live,
  // filtered out of the book otherwise.
  const closing = closingRows || bookClosing;
  const teamActs = allActs.filter(a => teamUserIds.includes(a.userId) && inRange(a.timestamp));

  // ── Headline numbers ────────────────────────────────────────────────────
  // Rollup first; the book expression is the pre-0011 fallback. Written as
  // `?? <book>` rather than a branch so the two definitions sit side by side
  // and cannot drift apart unnoticed.
  const rev = rollup ? rollup.revenue : won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = rollup ? rollup.closing_value : bookClosing.reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wonN = rollup ? rollup.won : won.length;
  const lostN = rollup ? rollup.lost : lost.length;
  const wr = wonN + lostN > 0 ? Math.round(wonN / (wonN + lostN) * 100) : 0;
  const siteVisits = rollup ? rollup.site_visits : leads.filter(l => l.siteVisitDoneDate && inRange(l.siteVisitDoneDate)).length;
  const newLeads = rollup ? rollup.total : leads.filter(l => inRange(l.createdAt)).length;
  const talkSecs = acts ? acts.talk_secs : teamActs.filter(a => a.type === 'CALL').reduce((s, a) => s + (a.durationSeconds || 0), 0);
  const talkMins = Math.round(talkSecs / 60);
  const offersSent = acts ? acts.offers : allActs.filter(a => a.type === 'OFFER' && inRange(a.timestamp)).length;

  // Lead/activity lists behind each KPI (for the click-through detail sheet).
  // The lead-shaped ones are queries now, so clicking a card fetches its rows a
  // page at a time instead of slicing a set the page had to hold in full.
  const closedStatuses = `status.in.(DEAL_CLOSED_WON,DEAL_CLOSED_LOST)`;
  const teamQ = { user, involved: true };
  const wonQ = { ...teamQ, extra: [eq('status', 'DEAL_CLOSED_WON')], dateField: 'updated_at', start: rangeStart, end: rangeEnd };
  // Drill-down for the Pipeline Value card. Without offer_sent_at the gate is
  // not a predicate, so the sheet is handed the rows already on screen instead
  // of a query that would either 400 or list leads the panel is hiding.
  const closingQ = { ...teamQ, extra: [or(eq('status', 'NEGOTIATING'), eq('status', 'SITE_VISIT_DONE')), notNull('offer_sent_at')] };
  const closedQ = { ...teamQ, extra: [closedStatuses], dateField: 'updated_at', start: rangeStart, end: rangeEnd };
  const newLeadsQ = { ...teamQ, start: rangeStart, end: rangeEnd };
  const visitsQ = { ...teamQ, extra: ['site_visit_done_date.not.is.null'], dateField: 'site_visit_done_date', start: rangeStart, end: rangeEnd };
  const _ln = {}; db.leads.forEach(l => { _ln[l.id] = l.name; });
  const offerRows = [], callRows = [];
  Object.entries(db.activities || {}).forEach(([lid, arr]) => (arr || []).forEach(a => {
    if (a.type === 'OFFER' && inRange(a.timestamp)) offerRows.push({ leadId: lid, title: _ln[lid] || 'Lead', sub: 'offer', ts: a.timestamp });
    if (a.type === 'CALL' && teamUserIds.includes(a.userId) && inRange(a.timestamp)) callRows.push({ leadId: lid, title: _ln[lid] || 'Lead', sub: 'call', ts: a.timestamp, right: Math.round((a.durationSeconds || 0) / 60) + 'm' });
  }));

  // ── Freshness ───────────────────────────────────────────────────────────
  // When each tile's number last moved. The rollup carries the stamps
  // (migration 0012); the book expression is the fallback, and reduces to null
  // when neither has anything to date — the card then shows no line at all
  // rather than a confident "just now".
  const maxTs = (arr, pick) => (arr || []).reduce((m, x) => {
    const v = typeof pick === 'function' ? pick(x) : x[pick];
    return v && (!m || new Date(v) > new Date(m)) ? v : m;
  }, null);
  const newInRange = leads.filter(l => inRange(l.createdAt));
  const visitedInRange = leads.filter(l => l.siteVisitDoneDate && inRange(l.siteVisitDoneDate));
  const upd = {
    rev: rollup?.last_won_at || maxTs(won, 'updatedAt'),
    pipe: rollup?.last_closing_at || maxTs(closing, 'updatedAt'),
    newLeads: rollup?.last_new_at || maxTs(newInRange, 'createdAt'),
    visits: rollup?.last_visit_at || maxTs(visitedInRange, 'siteVisitDoneDate'),
    offers: acts?.last_offer_at || maxTs(offerRows, 'ts'),
    calls: acts?.last_call_at || maxTs(callRows, 'ts'),
  };

  // Top performers in this team (by deals won, then revenue). Per-agent counts
  // AND a revenue sum, so this is agent_lead_stats when 0011 is present and the
  // same reduction over the book when it is not.
  const byId = {}; (agents || []).forEach(a => { byId[a.userId] = a; });
  const perf = teamUsers
    .filter(u => [ROLES.IA, ROLES.MA, ROLES.TL].includes(u.role))
    .map(u => {
      if (agents) { const a = byId[u.id]; return { u, won: a?.won || 0, rev: a?.revenue || 0 }; }
      const uLeads = leads.filter(l => l.assignedTo === u.id || (l.previousAssignees || []).includes(u.id));
      const uWon = uLeads.filter(l => l.status === 'DEAL_CLOSED_WON');
      return { u, won: uWon.length, rev: uWon.reduce((s, l) => s + (l.dealValue || 0), 0) };
    })
    .filter(p => p.won > 0 || p.rev > 0)
    .sort((a, b) => b.won - a.won || b.rev - a.rev)
    .slice(0, 5);

  // Chart data (team). The old current-status funnel lived here; it's replaced by
  // ConversionPanel's cumulative one, which reads as a real funnel (a Won lead now
  // also counts as Contacted, so the bars only ever descend).
  const panelCfg = panelConfigFor(user.role);
  // Source mix — a GROUP BY, so it comes from the rollup's source_counts when
  // available and from a tally over the book when not.
  const srcC = {};
  if (rollup) Object.assign(srcC, rollup.source_counts || {});
  else leads.forEach(l => { srcC[l.source] = (srcC[l.source] || 0) + 1; });
  const srcColors = { META_ADS: '#FFFFFF', WHATSAPP_ADS: '#34D399', LINKEDIN: '#DDB948', HOTLINE: '#F0A92B', PERSONAL: '#2DD4BF', WEBSITE: '#F87171' };
  const srcData = Object.entries(srcC).sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ label: SRC_LABELS[s] || s, value: c, color: srcColors[s] || '#9CA3AF' }));

  return (
    <div className="iad-page">
      <DashGreeting user={user} sub={(() => {
        const holdsSent = getHoldRequests().filter(r => teamUserIds.includes(r.agentId)).length;
        const base = closing.length > 0 ? `${closing.length} ${closing.length === 1 ? 'deal' : 'deals'} to close · ${fmtBDT(pipe)} in pipeline` : 'No deals waiting to close right now.';
        return holdsSent > 0 ? `${base} · ${holdsSent} hold ${holdsSent === 1 ? 'request' : 'requests'} sent` : base;
      })()} />

      <div className="grid-4">
        <StatCard val={fmtBDT(rev)} label={hasRange ? 'Revenue' : 'Revenue This Month'} tone="good" sub="closed won" updated={upd.rev} onClick={() => setDetail({ title: 'Revenue · Deals Won', query: wonQ, total: wonN })} />
        <StatCard val={fmtBDT(pipe)} label="Pipeline Value" tone="accent" sub="to close" updated={upd.pipe} onClick={() => setDetail(offerCol
          ? { title: 'Pipeline · Deals to close', query: closingQ, total: rollup ? rollup.closing_count : closing.length, hasOffer: true }
          : { title: 'Pipeline · Deals to close', leads: closing, hasOffer: true })} />
        <StatCard val={wonN + '/' + (wonN + lostN)} label="Deals Won/Closed" sub="this period" onClick={() => setDetail({ title: 'Deals Closed', query: closedQ, total: wonN + lostN })} />
        <StatCard val={wr + '%'} label="Win Rate" tone={wr >= 50 ? 'good' : ''} sub="closed won" onClick={() => setDetail({ title: 'Closed Deals (Won + Lost)', query: closedQ, total: wonN + lostN })} />
      </div>
      <div className="grid-4">
        <StatCard val={newLeads} label={hasRange ? 'New Customers' : 'New This Month'} sub="leads in" updated={upd.newLeads} onClick={() => setDetail({ title: 'New Customers', query: newLeadsQ, total: newLeads })} />
        <StatCard val={siteVisits} label="Site Visits Done" sub="this period" updated={upd.visits} onClick={() => setDetail({ title: 'Site Visits Done', query: visitsQ, total: siteVisits })} />
        <StatCard val={offersSent} label="Proposals Sent" sub="offers" updated={upd.offers} onClick={() => setDetail({ title: 'Proposals Sent', rows: offerRows })} />
        <StatCard val={talkMins + ' min'} label="Team Talk Time" sub="on calls" updated={upd.calls} onClick={() => setDetail({ title: 'Team Calls', rows: callRows })} />
      </div>

      {/* Where the team's leads drop off, and the last 30 days of stage events */}
      <ConversionPanel
        leads={leads}
        activities={db.activities || {}}
        dateRange={dateRange}
        stages={panelCfg.stages}
        seriesKeys={panelCfg.seriesKeys}
        title={panelCfg.title}
      />

      <div className="iad-layout">
        {/* Primary: deals to close */}
        <div className="iad-main">
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Deals to close</span>
              {closing.length > 0 && <span className="iad-q-ct">{closing.length}</span>}
            </div>
            <ScoredPipeline leads={closing} db={db} onOpen={setPanLead} loading={!needBook && closingRows === null} />
          </div>
        </div>

        {/* Rail: target + top performers */}
        <aside className="iad-rail">
          <TargetCard user={user} />
          <SuccessGauge user={user} />
          <div className="iad-queue">
            <div className="iad-q-hd">
              <span className="iad-q-ttl">Top performers</span>
            </div>
            {perf.length === 0 ? (
              <div className="iad-q-empty iad-q-empty-quiet"><span>No closed deals yet.</span></div>
            ) : (
              <div className="iad-q-list">
                {perf.map((p, i) => (
                  <div key={p.u.id} className="iad-q-row">
                    <div className="iad-mt-time">#{i + 1}</div>
                    <div className="iad-q-info">
                      <div className="iad-q-name">{p.u.name}</div>
                      <div className="iad-q-meta">{p.won} won · {fmtBDT(p.rev)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Team analytics */}
      <div className="grid-2" style={{ marginTop: '4px' }}>
        <div className="analytics-card">
          <div className="ac-hd"><Mi>donut_large</Mi>Leads by Source</div>
          <div className="ac-body"><Donut data={srcData} centerVal={leads.length} centerSub="leads" /></div>
        </div>
        <div className="analytics-card">
          <div className="ac-hd"><Mi>military_tech</Mi>Win Rate</div>
          <div className="ac-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Ring pct={wr} size={120} thickness={12} label="closed won" />
          </div>
        </div>
      </div>
      <KpiSheet detail={detail} onClose={() => setDetail(null)} onLead={(id) => { setDetail(null); setPanLead(id); }} />
    </div>
  );
}
