import { useMemo } from 'react';
import { ROLES } from '../lib/constants.js';
import { or, eq } from '../lib/leadQuery.js';
import useLeadCounts from '../hooks/useLeadCounts.js';

// Semicircle tick-mark gauge (speedometer style).
export function TickGauge({ pct = 0, label }) {
  const N = 44, cx = 100, cy = 104, rIn = 74, rOut = 96;
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * N);
  const ticks = Array.from({ length: N }, (_, i) => {
    const a = Math.PI - (i / (N - 1)) * Math.PI; // 180° → 0° over the top
    const cos = Math.cos(a), sin = Math.sin(a);
    return { x1: cx + rIn * cos, y1: cy - rIn * sin, x2: cx + rOut * cos, y2: cy - rOut * sin, on: i < filled };
  });
  return (
    <div className="pks-gwrap">
      <svg viewBox="0 0 200 116" className="pks-gsvg">
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.on ? 'var(--accent)' : 'var(--bd2)'} strokeWidth="2.6" strokeLinecap="round" />
        ))}
      </svg>
      <div className="pks-gctr"><div className="pks-gpct">{p}%</div><div className="pks-glbl">{label}</div></div>
    </div>
  );
}

// The status sets successRate() measures each role against. Kept here rather
// than imported from successRate.js because these are now query terms, not
// Array.filter predicates — the numerator and denominator are two counts, so
// the gauge no longer needs a single lead row in memory.
const REACHED_MEETING = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON'];
const REACHED_TL = ['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'];
const inList = (col, vals) => `${col}.in.(${vals.join(',')})`;

// Success rate is role-specific — each role is measured on its own objective,
// as a share of every lead they handled.
//   Initial Agent  → got a meeting set
//   Meeting Agent  → forwarded the lead on to a Team Lead
//   Team Lead      → closed the deal (won) out of the whole team's leads
//   Management/…   → classic win rate on resolved deals
//
// `involved` (IA/MA) is the superset that keeps their credit after a hand-off;
// TL and Management measure their own board scope.
function specFor(user) {
  const involved = { user, involved: true };
  const mine = { user, involved: false };
  if (user.role === ROLES.IA) {
    return {
      label: 'Meetings set',
      num: { ...involved, extra: [or(eq('meeting_set_by', user.id), inList('status', REACHED_MEETING))] },
      den: involved,
    };
  }
  if (user.role === ROLES.MA) {
    return {
      label: 'Forwarded to TL',
      num: { ...involved, extra: [or(eq('assigned_role', ROLES.TL), inList('status', REACHED_TL))] },
      den: involved,
    };
  }
  if (user.role === ROLES.TL) {
    return { label: 'Deals won', num: { ...mine, extra: [eq('status', 'DEAL_CLOSED_WON')] }, den: mine };
  }
  return {
    label: 'Successful deals',
    num: { ...mine, extra: [eq('status', 'DEAL_CLOSED_WON')] },
    den: { ...mine, extra: [inList('status', ['DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST'])] },
  };
}

// Role-aware success-rate card for dashboards — same metric as the pipeline strip.
export default function SuccessGauge({ user }) {
  const spec = useMemo(() => specFor(user), [user]);
  const q = useMemo(() => ({ num: spec.num, den: spec.den }), [spec]);
  const c = useLeadCounts(q);
  const n = c.num, d = c.den;
  const pct = d ? Math.round((n || 0) / d * 100) : 0;
  return (
    <div className="sg-card">
      <div className="sg-hd">Success rate</div>
      <TickGauge pct={pct} label={d == null ? spec.label : `${spec.label} · ${n ?? 0}/${d}`} />
    </div>
  );
}
