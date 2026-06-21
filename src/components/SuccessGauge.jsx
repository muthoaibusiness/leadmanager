import { getLeads } from '../lib/db.js';
import { successRate } from '../lib/successRate.js';

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

// Role-aware success-rate card for dashboards — same metric as the pipeline strip.
export default function SuccessGauge({ user }) {
  const mine = getLeads(user);
  const involved = getLeads(user, { involved: true });
  const s = successRate(user, mine, involved);
  return (
    <div className="sg-card">
      <div className="sg-hd">Success rate</div>
      <TickGauge pct={s.pct} label={`${s.label} · ${s.n}/${s.d}`} />
    </div>
  );
}
