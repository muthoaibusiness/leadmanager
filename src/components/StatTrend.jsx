import Mi from './Mi.jsx';
import { DollarSign, TrendingUp, TrendingDown, RefreshCw, Users, Wallet, Trophy } from 'lucide-react';

// thin line icons, top right (the reference uses lucide-style strokes)
const ICONS = { dollar: DollarSign, up: TrendingUp, down: TrendingDown, refresh: RefreshCw, users: Users, wallet: Wallet, trophy: Trophy };

// KPI card: title with a thin icon on the right, the big value, a one-line
// note under it (the delta, or `sub`), and a small visual on the right side:
//   kind 'area'  — an area sparkline of `points`
//   kind 'bars'  — one bar per point, the taller ones in the accent
//   kind 'dots'  — a dot-matrix bar chart of `points`
//   kind 'pill'  — a capsule filled to `pct` (0–100)
// With no kind, 'area' when there are points, else no visual.
export default function StatTrend({ label, value, delta, sub, points, pct, kind, color = '#FB8849', icon, gid, onClick }) {
  const Icon = ICONS[icon];
  const hasGraph = Array.isArray(points) && points.length > 1;
  const up = (delta ?? 0) >= 0;
  const clickable = typeof onClick === 'function';
  const k = kind || (hasGraph ? 'area' : null);
  const id = 'sg-' + (gid || label).replace(/[^a-z0-9]/gi, '');

  let visual = null;
  if (k === 'area' && hasGraph) {
    const w = 120, h = 56, pad = 3;
    const max = Math.max(...points, 1), min = Math.min(...points, 0);
    const span = max - min || 1;
    const stepX = w / (points.length - 1);
    const xy = points.map((p, i) => [i * stepX, h - pad - ((p - min) / span) * (h - pad * 2)]);
    // a smooth curve through the points (Catmull-Rom as cubic Béziers)
    const f = (n) => n.toFixed(1);
    const cy = (y) => Math.min(h - pad, Math.max(pad, y));   // control points stay inside the box, so a spike never overshoots
    let line = `M${f(xy[0][0])},${f(xy[0][1])}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || p2;
      line += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(cy(p1[1] + (p2[1] - p0[1]) / 6))} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(cy(p2[1] - (p3[1] - p1[1]) / 6))} ${f(p2[0])},${f(p2[1])}`;
    }
    const area = `${line} L${w},${h} L0,${h} Z`;
    const [lx, ly] = xy[points.indexOf(Math.max(...points))];   // the dot marks the peak
    visual = (
      <svg className="st-vis st-area" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="70%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 2px ${color})` }} />
        <circle cx={lx} cy={ly} r="5" fill={color} fillOpacity="0.3" />
        <circle cx={lx} cy={ly} r="2.2" fill="#fff" stroke={color} strokeWidth="1" />
      </svg>
    );
  } else if (k === 'bars' && hasGraph) {
    const max = Math.max(...points, 1);
    // the three busiest days light up in the accent, the rest stay grey
    const lit = new Set([...points].map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(([p]) => p > 0).map(([, i]) => i));
    visual = (
      <div className="st-vis st-bars" aria-hidden="true">
        {points.map((p, i) => <i key={i} className={lit.has(i) ? 'on' : ''} style={{ height: `${Math.max(22, Math.round(p / max * 100))}%` }} />)}
      </div>
    );
  } else if (k === 'dots' && hasGraph) {
    const rows = 8, max = Math.max(...points, 1);
    visual = (
      <div className="st-vis st-dots" style={{ '--rows': rows }} aria-hidden="true">
        {points.map((p, i) => {
          const lit = Math.max(p > 0 ? 1 : 0, Math.round(p / max * rows));
          return <b key={i}>{Array.from({ length: rows }, (_, r) => <i key={r} className={r >= rows - lit ? 'on' : ''} />)}</b>;
        })}
      </div>
    );
  } else if (k === 'pill') {
    const fill = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
    visual = (
      <div className="st-vis st-pill" role="img" aria-label={`${fill}%`}>
        <i style={{ width: `${fill}%` }} />
      </div>
    );
  }

  const note = delta != null
    ? <div className={`st-note ${up ? 'up' : 'down'}`}>{up ? '+' : '−'}{Math.abs(delta)}% {sub || 'vs last week'}</div>
    : sub ? <div className="st-note">{sub}</div> : null;

  return (
    <div
      className={`st-card${clickable ? ' mc-click' : ''}`}
      style={{ '--st-accent': color }}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="st-top">
        <span className="st-l">{label}</span>
        {Icon ? <Icon className="st-ico" size={18} strokeWidth={1.6} aria-hidden="true" /> : icon && <Mi className="st-ico" aria-hidden="true">{icon}</Mi>}
      </div>
      <div className="st-body">
        <div className="st-main">
          <div className="st-v">{value}</div>
          {note}
        </div>
        {visual}
      </div>
      {clickable && <span className="mc-go"><Mi>chevron_right</Mi></span>}
    </div>
  );
}
