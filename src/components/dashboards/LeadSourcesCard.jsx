import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { loadNewLeads } from '../../lib/db.js';
import { SRC_LABELS } from '../../lib/constants.js';
import { srclabel } from '../../lib/helpers.js';
import { periodSince } from '../../lib/contactPerf.js';
import { SOURCE_PERIODS, leadSourceMix } from '../../lib/sourceMix.js';
import { CHART_COLORS } from '../charts/chartColors.js';
import DonutCard from '../ui/donut-card.jsx';

// Home › Performance Reports: where leads came from (lib/sourceMix.js), with
// the same header as the contact tracker: the change against the previous
// period and a period picker (past 24 hours by default, up to all time).
//
// Live like the tracker: each period loads its own leads (loadNewLeads: one
// light query) and re-loads every minute, so the card never waits on the whole
// lead book and also catches leads realtime does not stream (no company_id);
// new leads realtime delivers into the lead book (`leads`, which
// ManagementDash loads with useLeadBook) show at once. All time reads the
// lead book alone.

// Each source keeps one colour (its slot in SRC_LABELS), so Meta is the same
// colour on every visit; sources past the palette, or not in SRC_LABELS, share
// the neutral one.
const SRC_KEYS = Object.keys(SRC_LABELS);
const sourceColor = (key) => { const slot = SRC_KEYS.indexOf(key); return slot >= 0 && slot < CHART_COLORS.length ? CHART_COLORS[slot] : 'var(--t3)'; };

export default function LeadSourcesCard({ leads }) {
  const { user } = useApp();
  const [period, setPeriod] = useState(SOURCE_PERIODS[0]);
  const [loaded, setLoaded] = useState({}); // period label → leads from the cloud
  const cloud = loaded[period.label];

  // Once a minute: the 24-hour window rolls, and the period re-loads.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (period.all) return undefined;
    let alive = true;
    loadNewLeads(user, periodSince(period, now)).then(rows => {
      if (alive && rows) setLoaded(l => ({ ...l, [period.label]: rows }));
    });
    return () => { alive = false; };
  }, [period, user, now]);

  // The lead book first: its copy of a lead is the freshest (realtime edits).
  const { counts, total, prevTotal } = useMemo(
    () => leadSourceMix(cloud ? leads.concat(cloud) : leads, period, { now, companyId: user.companyId }),
    [leads, cloud, period, now, user.companyId],
  );
  const data = Object.entries(counts)
    .map(([key, value]) => ({ key, label: key === 'UNKNOWN' ? 'Unknown' : srclabel(key), value, color: sourceColor(key) }))
    .sort((a, b) => b.value - a.value);

  const diff = prevTotal == null ? 0 : total - prevTotal;
  const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const percent = prevTotal == null ? null : prevTotal ? `${Math.abs((diff / prevTotal) * 100).toFixed(1)}%` : total ? 'New' : '0.0%';

  return (
    <DonutCard
      title="Lead sources"
      description={period.all ? 'Where your leads came from' : 'Where new leads came from'}
      data={data}
      centerLabel="Leads"
      emptyText={period.all ? 'No leads yet.' : `No new leads in the ${period.label.toLowerCase()}.`}
      percent={percent}
      trend={trend}
      period={period.label}
      periodOptions={SOURCE_PERIODS}
      onPeriodChange={setPeriod}
      loading={!period.all && !cloud}
    />
  );
}
