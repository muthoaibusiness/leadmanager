import { useState } from 'react';

// Axis-labelled multi-series line chart with a hover tooltip.
//
// Lives outside Charts.jsx on purpose: everything in there is a pure function of
// props with no state, which is what keeps it renderable without a DOM. This one
// needs hover state and pointer geometry, so it stays separate.
//
// series: [{ key, label, color, points: number[] }] — every points[] must be the
//         same length as labels[].
// labels: string[] — one x label per point (e.g. 'Jul 15').

const W = 560, H = 200;
const padL = 28, padR = 8, padT = 10, padB = 20;
const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;

// Round the axis up to a clean 1/2/5/10 × 10ⁿ. Floors at 4 so an all-zero chart
// still draws a sane axis instead of dividing by zero.
function niceMax(v) {
  const m = Math.max(v, 4);
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  const s = m / p;
  return (s <= 1 ? 1 : s <= 2 ? 2 : s <= 5 ? 5 : 10) * p;
}

export default function TrendChart({ series = [], labels = [], labelEvery = 5 }) {
  const [hover, setHover] = useState(null);

  const n = labels.length;
  if (!n || !series.length) return <div className="ct-empty">No data yet.</div>;

  const all = series.flatMap(s => s.points || []);
  const yMax = niceMax(all.length ? Math.max(...all) : 0);
  const stepX = n > 1 ? (x1 - x0) / (n - 1) : 0; // single point sits at x0
  const X = (i) => x0 + i * stepX;
  const Y = (v) => y1 - (Math.max(0, v) / yMax) * (y1 - y0);

  // Ticks every `labelEvery`, always keep the last, and drop the one before it
  // when they'd collide.
  const ticks = [];
  for (let i = 0; i < n; i += labelEvery) ticks.push(i);
  if (ticks[ticks.length - 1] !== n - 1) {
    if (n - 1 - ticks[ticks.length - 1] < 2) ticks.pop();
    ticks.push(n - 1);
  }

  const yTicks = [0, yMax / 2, yMax];

  const pick = (e, clientX) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    // The wrapper is pinned to the viewBox aspect ratio, so svg-x maps linearly
    // onto client-x with no letterboxing to correct for.
    const svgX = ((clientX - r.left) / r.width) * W;
    const i = stepX ? Math.round((svgX - x0) / stepX) : 0;
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart-trend">
      <div className="ct-plot">
        <svg className="ct-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
          {yTicks.map((v, i) => (
            <g key={i}>
              <line className="ct-grid" x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} />
              <text className="ct-axis" x={x0 - 6} y={Y(v) + 3} textAnchor="end">{Math.round(v)}</text>
            </g>
          ))}

          {ticks.map(i => (
            <text key={i} className="ct-axis" x={X(i)} y={H - 6} textAnchor="middle">{labels[i]}</text>
          ))}

          {hover != null && <line className="ct-vline" x1={X(hover)} x2={X(hover)} y1={y0} y2={y1} />}

          {series.map(s => (
            <polyline
              key={s.key}
              className="ct-line"
              stroke={s.color}
              points={(s.points || []).map((v, i) => `${X(i)},${Y(v)}`).join(' ')}
            />
          ))}

          {hover != null && series.map(s => (
            <circle key={s.key} className="ct-dot" cx={X(hover)} cy={Y((s.points || [])[hover] || 0)} fill={s.color} />
          ))}

          {/* Transparent capture layer — one rect beats 30 per-point hit targets. */}
          <rect
            x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} fill="transparent"
            onMouseMove={e => pick(e, e.clientX)}
            onMouseLeave={() => setHover(null)}
            onTouchMove={e => { if (e.touches[0]) pick(e, e.touches[0].clientX); }}
            onTouchEnd={() => setHover(null)}
          />
        </svg>

        {hover != null && (
          <div className="ct-tip" style={{ left: (X(hover) / W) * 100 + '%', top: (y0 / H) * 100 + '%' }}>
            <div className="ct-tip-d">{labels[hover]}</div>
            {series.map(s => (
              <div key={s.key} className="ct-tip-row">
                <i className="ct-tip-dot" style={{ background: s.color }} />
                <span className="ct-tip-l">{s.label}</span>
                <span className="ct-tip-v">{(s.points || [])[hover] || 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ct-legend">
        {series.map(s => (
          <span key={s.key} className="ct-lg-item">
            <i className="ct-lg-dot" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
