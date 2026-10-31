import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getBookings, bookingPaid } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import useLeadBook from '../../hooks/useLeadBook.js';
import StatTrend from '../StatTrend.jsx';
import { Ring, Meter, PeriodSelect, CustomRange } from './MobileBits.jsx';

// The four headline KPIs — Revenue, New Customers, Collected, Win Rate — as
// one row of StatTrend cards on the Management Home. The row scopes itself to
// the signed-in account through getLeads(), and bookings count when they
// belong to a lead in that scope. The cards are read-only: no click, no
// detail sheet.
//
// Each graph needs shape. It tries its daily series first; when that has
// activity on fewer than 2 days (say, no deal closed this fortnight) it widens
// to the last 12 weeks, then the last 12 months, and the note under the value
// names the window it ended up with.

const alive = (arr) => arr.filter(v => v > 0).length >= 2;

// `variant="hero"` (the phone Home): the same numbers as one summary card —
// revenue won with the card's change line, collected / booked / new, and the
// win rate as a ring. Nothing is counted differently.
export default function KpiRow({ variant }) {
  useLeadBook(); // the row reduces over the scope's leads; they are not in the boot load
  const { user, dateRange, dbVersion } = useApp();
  void dbVersion; // re-read the store when a save or realtime changes it

  const leads = getLeads(user, { involved: true });
  const leadIds = new Set(leads.map(l => l.id));
  const inRange = (arr) => {
    if (!dateRange?.range) return arr;
    const { start, end } = dateRange.range;
    return arr.filter(l => { const d = new Date(l.createdAt); return d >= start && d <= end; });
  };
  const scoped = inRange(leads);
  const won = scoped.filter(l => l.status === 'DEAL_CLOSED_WON');
  const lost = scoped.filter(l => l.status === 'DEAL_CLOSED_LOST');
  const closedList = [...won, ...lost];
  const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const wr = closedList.length ? Math.round(won.length / closedList.length * 100) : 0;

  // Bookings on this scope's leads, minus the dead ones.
  const bookings = getBookings().filter(b => leadIds.has(b.leadId) && !['EXPIRED', 'CANCELLED'].includes(b.status));
  const collected = bookings.reduce((s, b) => s + bookingPaid(b), 0);
  const booked = bookings.reduce((s, b) => s + (b.total || 0), 0);
  const paidPct = booked ? Math.round(collected / booked * 100) : 0;

  // ── time buckets ──
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const bucketsOf = (n, unit) => Array.from({ length: n }, (_, i) => {
    const d = new Date(today0);
    if (unit === 'month') { d.setDate(1); d.setMonth(d.getMonth() - (n - 1 - i)); }
    else d.setDate(d.getDate() - (n - 1 - i) * (unit === 'week' ? 7 : 1));
    const nx = new Date(d);
    if (unit === 'month') nx.setMonth(nx.getMonth() + 1); else nx.setDate(nx.getDate() + (unit === 'week' ? 7 : 1));
    return [d, nx];
  });
  const sumIn = (rows, at, val) => ([d, nx]) => rows.filter(r => { const t = at(r); return t && t >= d && t < nx; }).reduce((s, r) => s + val(r), 0);
  const sDelta = (arr) => { const a = arr.slice(7).reduce((x, y) => x + y, 0), b = arr.slice(0, 7).reduce((x, y) => x + y, 0); return b ? Math.round((a - b) / b * 100) : (a ? 100 : 0); };
  // daily (14 days, or the last 7 for bars) → weekly → monthly
  const withShape = (days, rows, at, val) => {
    const daily = bucketsOf(14, 'day').map(sumIn(rows, at, val));
    if (alive(daily)) return { points: daily.slice(-days), delta: sDelta(daily) };
    const weeks = bucketsOf(12, 'week').map(sumIn(rows, at, val));
    if (alive(weeks)) return { points: weeks, window: '12-week trend' };
    return { points: bucketsOf(12, 'month').map(sumIn(rows, at, val)), window: '12-month trend' };
  };
  const at = (k) => (r) => (r[k] ? new Date(r[k]) : null);
  const revGraph = withShape(14, leads.filter(l => l.status === 'DEAL_CLOSED_WON'), at('updatedAt'), l => l.dealValue || 0);
  const leadGraph = withShape(7, leads, at('createdAt'), () => 1);
  const closedGraph = withShape(14, leads.filter(l => l.status === 'DEAL_CLOSED_WON' || l.status === 'DEAL_CLOSED_LOST'), at('updatedAt'), () => 1);
  const newCount = bucketsOf(14, 'day').map(sumIn(leads, at('createdAt'), () => 1)).reduce((s, v) => s + v, 0);

  const cards = [
    { label: 'Revenue', value: fmtBDT(rev), points: revGraph.points, kind: 'area', icon: 'dollar',
      ...(revGraph.window ? { sub: `Won, ${revGraph.window}` } : { delta: revGraph.delta }) },
    { label: 'New Customers', value: newCount, points: leadGraph.points, kind: 'bars', icon: 'up',
      ...(leadGraph.window ? { sub: `New, ${leadGraph.window}` } : { delta: leadGraph.delta }) },
    { label: 'Collected', value: fmtBDT(collected), sub: booked ? `${paidPct}% of ${fmtBDT(booked)} booked` : 'Nothing booked yet', pct: paidPct, kind: 'pill', icon: 'down' },
    { label: 'Win Rate', value: wr + '%', sub: `${won.length} won · ${lost.length} lost${closedGraph.window ? ' · ' + closedGraph.window.replace('-', '').replace('week trend', 'w').replace('month trend', 'm') : ''}`, points: closedGraph.points, kind: 'dots', icon: 'refresh' },
  ];

  if (variant === 'hero') {
    const delta = revGraph.window ? null : revGraph.delta;
    return (
      <section className="mh-card mh-hero" aria-label="Overview">
        <div className="mh-hero-top">
          <span className="mh-ttl">Overview</span>
          <PeriodSelect />
        </div>
        <CustomRange />
        <div className="mh-big">
          <span className="mh-lbl">Revenue won</span>
          <span className="mh-num">{fmtBDT(rev)}</span>
          {delta != null && (
            <span className={`mh-delta ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '+' : '−'}{Math.abs(delta)}% vs last week</span>
          )}
        </div>
        <div className="mh-trio">
          <div><span className="mh-lbl">Collected</span><b>{fmtBDT(collected)}</b></div>
          <div><span className="mh-lbl">Booked</span><b>{fmtBDT(booked)}</b></div>
          <div><span className="mh-lbl">New · 14 days</span><b>{newCount}</b></div>
        </div>
        <div className="mh-hero-foot">
          <Ring pct={wr} label={`Win rate ${wr} percent`} />
          {/* Win rate | Collected of booked, side by side */}
          <div className="mh-meters mh-meters-row">
            <Meter label="Win rate" value={`${won.length} won · ${lost.length} lost`} pct={wr} />
            <Meter label="Collected of booked" value={booked ? `${paidPct}%` : 'Nothing booked yet'} pct={paidPct} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="grid-4 kpi-cards">
      {cards.map((c, i) => <StatTrend key={i} {...c} />)}
    </div>
  );
}
