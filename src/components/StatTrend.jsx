import Mi from './Mi.jsx';

// Muthoclo-style KPI card: label + delta + big value + full-width area sparkline w/ glow dot.
export default function StatTrend({ label, value, delta, points, color = 'var(--volt)', gid, onClick }) {
  const hasGraph = Array.isArray(points) && points.length > 1;
  const up = (delta ?? 0) >= 0;
  const clickable = typeof onClick === 'function';

  let svg = null;
  if (hasGraph) {
    const w = 300, h = 70, pad = 4;
    const max = Math.max(...points, 1), min = Math.min(...points, 0);
    const span = max - min || 1;
    const stepX = w / (points.length - 1);
    const xy = points.map((p, i) => [i * stepX, h - pad - ((p - min) / span) * (h - pad * 2)]);
    const line = 'M' + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
    const area = `${line} L${w},${h} L0,${h} Z`;
    const [lx, ly] = xy[xy.length - 1];
    const id = 'sg-' + (gid || label).replace(/[^a-z0-9]/gi, '');
    svg = (
      <svg className="st-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={lx} cy={ly} r="6" fill="none" stroke={color} strokeWidth="2" style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
        <circle cx={lx} cy={ly} r="2.5" fill={color} />
      </svg>
    );
  }

  return (
    <div
      className={`st-card${hasGraph ? ' has-graph' : ''}${clickable ? ' mc-click' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="st-top">
        <span className="st-l">{label}</span>
        {delta != null && (
          <span className={`st-d ${up ? 'up' : 'down'}`}>
            <Mi>{up ? 'arrow_upward' : 'arrow_downward'}</Mi>{Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="st-v">{value}</div>
      {svg}
      {clickable && <span className="mc-go"><Mi>chevron_right</Mi></span>}
    </div>
  );
}
