import Mi from '../Mi.jsx';
import { Funnel } from '../charts/Charts.jsx';
import TrendChart from '../charts/TrendChart.jsx';
import { buildFunnel, buildStageTrend, FUNNEL_STAGES } from '../../lib/funnel.js';
import { periodLabel } from '../../lib/helpers.js';

// Funnel + 30-day trend, shared by the Initial Agent / Meeting Agent / Team Lead
// dashboards.
//
// Takes leads + activities as props rather than calling getDB() itself: every
// dashboard already holds them, and staying data-free keeps this renderable from
// plain fixtures in a test harness with no localStorage/fetch to stub.
//
// The two cards answer different questions on purpose (see funnel.js):
//   Funnel — the leads CREATED in the selected period, and how far they got.
//   Trend  — stage events BY THE DAY THEY HAPPENED, always the last 30 days.
// Hence the trend deliberately ignores the global date filter, matching how
// ManagementDash's sparklines already behave.
const TREND_DAYS = 30;

// ── Turned off for now (asked for on 2026-07-15) ─────────────────────────────
// Flip to true to bring both cards back on the IA / MA / TL dashboards. The
// panel stays wired into all three, so this switch is the only thing to change.
// Returning early also skips buildFunnel/buildStageTrend entirely, so a disabled
// panel costs nothing.
const ENABLED = false;

export default function ConversionPanel({
  leads = [],
  activities = {},
  dateRange,
  stages = FUNNEL_STAGES,
  seriesKeys = ['connected', 'meetingSet', 'siteVisit'],
  title = 'Conversion Funnel',
}) {
  if (!ENABLED) return null;

  const r = dateRange?.range;
  const cohort = r
    ? leads.filter(l => { const d = new Date(l.createdAt); return d >= r.start && d <= r.end; })
    : leads;

  const funnelData = buildFunnel(cohort, activities, stages);
  const trend = buildStageTrend(leads, activities, { days: TREND_DAYS, keys: seriesKeys });

  return (
    <div className="grid-2 conv-panel">
      <div className="analytics-card">
        <div className="ac-hd"><Mi>filter_alt</Mi>{title}</div>
        <div className="ac-body">
          <div className="cp-note">Leads received {periodLabel(dateRange)} · cumulative, % of all leads</div>
          {cohort.length
            ? <Funnel stages={funnelData} />
            : <div className="cp-empty">No leads in this period.</div>}
        </div>
      </div>

      <div className="analytics-card">
        <div className="ac-hd"><Mi>show_chart</Mi>Last 30 Days</div>
        <div className="ac-body">
          <div className="cp-note">Dated by when each step happened — not affected by the date filter</div>
          <TrendChart series={trend.series} labels={trend.labels} />
        </div>
      </div>
    </div>
  );
}
