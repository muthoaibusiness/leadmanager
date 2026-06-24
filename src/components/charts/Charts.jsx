// Lightweight dependency-free SVG charts — Kitdrop dark + volt palette.
// Donut, Ring, Sparkline, MiniBars, HBars, Funnel.

export const CHART_COLORS = ['#54B848', '#A1A1AA', '#71717A', '#D4D4D8', '#52525B', '#34D399', '#F87171', '#3F3F46'];

export function Donut({ data, size = 150, thickness = 20, centerVal, centerSub }) {
  const items = (data || []).filter(d => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="chart-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="cd-svg">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surf2)" strokeWidth={thickness} />
          {items.map((d, i) => {
            const len = c * d.value / total;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={d.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} />
            );
            off += len;
            return el;
          })}
        </g>
        {centerVal !== undefined && <text x="50%" y="49%" textAnchor="middle" dominantBaseline="middle" className="cd-val">{centerVal}</text>}
        {centerSub && <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" className="cd-sub">{centerSub}</text>}
      </svg>
      <div className="chart-legend">
        {items.map((d, i) => (
          <div key={i} className="cl-row">
            <span className="cl-dot" style={{ background: d.color }} />
            <span className="cl-lbl">{d.label}</span>
            <span className="cl-val">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Ring({ pct, size = 116, thickness = 12, color = 'var(--volt)', label, sub }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const len = c * p / 100;
  return (
    <div className="chart-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surf2)" strokeWidth={thickness} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: color }} strokeWidth={thickness}
            strokeLinecap="round" strokeDasharray={`${len} ${c - len}`} />
        </g>
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="cr-val">{p}%</text>
        {label && <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" className="cr-lbl">{label}</text>}
      </svg>
      {sub && <div className="cr-sub">{sub}</div>}
    </div>
  );
}

export function Sparkline({ points, width = 240, height = 48, color = 'var(--volt)', fill = true }) {
  let pts = (points && points.length ? points : [0]).slice();
  if (pts.length === 1) pts = [pts[0], pts[0]];
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const span = max - min || 1;
  const stepX = width / (pts.length - 1);
  const coords = pts.map((p, i) => `${(i * stepX).toFixed(1)},${(height - ((p - min) / span) * (height - 4) - 2).toFixed(1)}`);
  const line = 'M' + coords.join(' L');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="chart-spark">
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MiniBars({ data, height = 60, color = 'var(--volt)' }) {
  const max = Math.max(...(data || []).map(d => d.value), 1);
  return (
    <div className="chart-mbars" style={{ height }}>
      {(data || []).map((d, i) => (
        <div key={i} className="cmb-col" title={`${d.label}: ${d.value}`}>
          <div className="cmb-bar" style={{ height: `${Math.max(3, (d.value / max) * 100)}%`, background: color }} />
        </div>
      ))}
    </div>
  );
}

export function HBars({ data, total }) {
  const t = total || (data || []).reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="chart-hbars">
      {(data || []).map((d, i) => {
        const pct = Math.round(d.value / t * 100);
        return (
          <div key={i} className="chb-row">
            <div className="chb-lbl">{d.label}</div>
            <div className="chb-track"><div className="chb-fill" style={{ width: pct + '%', background: d.color }} /></div>
            <div className="chb-ct">{d.value} <span className="chb-pct">{pct}%</span></div>
          </div>
        );
      })}
    </div>
  );
}

export function Funnel({ stages }) {
  const items = stages || [];
  const top = items.length ? items[0].value || 1 : 1;
  const max = Math.max(...items.map(s => s.value), 1);
  return (
    <div className="chart-funnel">
      {items.map((s, i) => {
        const w = Math.max(6, (s.value / max) * 100);
        const conv = Math.round((s.value / top) * 100);
        return (
          <div key={i} className="cf-row">
            <div className="cf-lbl">{s.label}</div>
            <div className="cf-track">
              <div className="cf-bar" style={{ width: w + '%', background: s.color }}>
                <span className="cf-v">{s.value}</span>
              </div>
            </div>
            <div className="cf-conv">{conv}%</div>
          </div>
        );
      })}
    </div>
  );
}
