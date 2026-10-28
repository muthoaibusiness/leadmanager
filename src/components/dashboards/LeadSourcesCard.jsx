import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { loadNewLeads } from '../../lib/db.js';
import { SRC_LABELS } from '../../lib/constants.js';
import { srclabel } from '../../lib/helpers.js';
import { periodSince } from '../../lib/contactPerf.js';
import { SOURCE_PERIODS, leadSourceMix } from '../../lib/sourceMix.js';
import { CHART_COLORS } from '../charts/chartColors.js';
import DonutCard from '../ui/donut-card.jsx';
import { PeriodSelect } from '../ui/metric-controls.jsx';
import Mi from '../Mi.jsx';
import LeadSourcesPage from './LeadSourcesPage.jsx';

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

// `variant="soft"` (the phone Home): a half-width overview (small ring, top
// three sources) beside Prospects contacted, on the same data and period, plus
// "View all", which opens the full phone page (LeadSourcesPage) starting on
// All time; back on Home the card returns to Past 24 hours.
//
// `period` (optional) sets the card's period from outside — the phone Home's
// Performance Overview picks one for both its cards — and hides the card's own
// picker; the full page still keeps its own.
export default function LeadSourcesCard({ leads, variant, period: fixed }) {
  const { user } = useApp();
  const [picked, setPeriod] = useState(SOURCE_PERIODS[0]);
  const [pageOpen, setPageOpen] = useState(false); // phone: the full Lead sources page
  const period = fixed && !pageOpen ? fixed : picked;
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

  const loading = !period.all && !cloud;
  const emptyText = period.all ? 'No leads yet.' : `No new leads in the ${period.label.toLowerCase()}.`;
  const soft = variant === 'soft';
  // The full page opens on All time; leaving it (any way) puts the card back on
  // its default, Past 24 hours, whatever was picked on the page.
  const openPage = () => { setPeriod(SOURCE_PERIODS.find(p => p.all) || SOURCE_PERIODS[0]); setPageOpen(true); };
  const closePage = () => { setPageOpen(false); setPeriod(SOURCE_PERIODS[0]); };

  const page = soft && pageOpen && (
    <LeadSourcesPage data={data} period={period} periods={SOURCE_PERIODS} onPeriodChange={setPeriod}
      loading={loading} emptyText={emptyText} percent={percent} trend={trend} now={now}
      onClose={closePage} />
  );

  // Phone Home: a half-width overview beside Prospects contacted — title and
  // subtitle, the period menu, a small ring with the total, the top three
  // sources, and View all.
  if (soft) {
    const sum = data.reduce((s, d) => s + d.value, 0);
    const segs = ringSegs(data, sum);
    return (
      <>
        <section className="mh-card mh-ls" aria-label="Lead sources">
          <span className="mh-card-hd">
            <span className="mh-card-t">Lead Sources</span>
            <span className="mh-card-s">{period.all ? 'Where your leads came from' : 'Where new leads came from'}</span>
          </span>
          {!fixed && <PeriodSelect value={period.label} options={SOURCE_PERIODS} onChange={setPeriod} />}
          {loading ? <p className="mh-note mh-ls-note">Loading…</p>
            : !data.length ? <p className="mh-note mh-ls-note">{emptyText}</p>
            : (
              <>
                <div className="mh-ls-ring">
                  <svg viewBox="0 0 100 100" role="img" aria-label={`Lead sources: ${data.map(d => `${d.label} ${d.value}`).join(', ')}`}>
                    <circle cx="50" cy="50" r="40" className="mh-ls-track" />
                    <g transform="rotate(-90 50 50)">
                      {segs.map(s => (
                        <circle key={s.key} cx="50" cy="50" r="40" pathLength="100" className="mh-ls-seg"
                          style={{ stroke: s.color }} strokeDasharray={`${s.len} 100`} strokeDashoffset={-s.start} />
                      ))}
                    </g>
                  </svg>
                  <div className="mh-ls-center"><b>{sum.toLocaleString('en-US')}</b><span>Leads</span></div>
                </div>
                <ul className="mh-ls-top">
                  {data.slice(0, 3).map(d => (
                    <li key={d.key}>
                      <i style={{ background: d.color }} aria-hidden="true" />
                      <span>{d.label}</span>
                      <b>{sum ? Math.round(d.value / sum * 100) : 0}%</b>
                    </li>
                  ))}
                </ul>
              </>
            )}
          <button type="button" className="mh-more" onClick={openPage}>View all<Mi aria-hidden="true">chevron_right</Mi></button>
        </section>
        {page}
      </>
    );
  }

  return (
    <>
    <DonutCard
      title="Lead sources"
      description={period.all ? 'Where your leads came from' : 'Where new leads came from'}
      data={data}
      centerLabel="Leads"
      emptyText={emptyText}
      percent={percent}
      trend={trend}
      period={period.label}
      periodOptions={SOURCE_PERIODS}
      onPeriodChange={setPeriod}
      loading={loading}
    />
    {page}
    </>
  );
}

// The small ring's segments, as dash runs on one circle (pathLength 100), in
// order from 12 o'clock; a thin gap between segments when there are several.
function ringSegs(data, sum) {
  const gap = data.length > 1 ? 1.2 : 0;
  const out = [];
  let start = 0;
  for (const d of data) {
    const p = sum ? (d.value / sum) * 100 : 0;
    out.push({ key: d.key, color: d.color, start, len: Math.max(p - gap, 0.01) });
    start += p;
  }
  return out;
}
