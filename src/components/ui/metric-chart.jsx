import { useId, useLayoutEffect, useRef, useState } from 'react';
import './metric-chart.css';

// The chart behind a ProgressMetricCard (ui/progress-metric-card.jsx): one or
// more series drawn as a smooth curve or as bars, filling its positioned
// parent. Nothing is marked until the pointer (or a finger) is over it; then
// the point under it gets a guide line, a dot and a tooltip.
//
// series: [{ name, color, data: [{ value, date }] }], every data[] the same
//         length. color may be a CSS var (inline styles resolve it).
// view:   'curve' | 'bars'
// topInset: px kept clear at the top for what sits over the chart (the card's
//         header, which wraps on narrow cards). Default 56.

// Monotone cubic through the points (the curve never overshoots a data
// point, so a run of zeros stays flat on the baseline).
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : '';
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0; }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) { t[i] = 0; continue; }
    const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
    t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
  }
  t[n - 1] = m[n - 2];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function MetricChart({ series = [], view = 'curve', topInset = 56, valueFormatter = String, dateFormatter = (d) => d }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState(null);
  const gid = `mtc-${useId().replace(/:/g, '')}`;

  // The observer reports the first size as soon as it starts observing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = series[0]?.data.length || 0;
  const { w, h } = size;
  // The top band stays clear for the card's header (title, period, legend).
  const padT = Math.max(topInset, h * 0.36), padB = 10, padL = 6, padR = 18;
  const innerW = Math.max(0, w - padL - padR);
  const max = Math.max(1, ...series.flatMap((s) => s.data.map((d) => d.value)));
  const bars = view === 'bars';
  const band = n ? innerW / n : 0;
  const X = (i) => (bars ? padL + band * (i + 0.5) : padL + (n > 1 ? (i * innerW) / (n - 1) : innerW / 2));
  const Y = (v) => h - padB - (Math.max(0, v) / max) * (h - padT - padB);
  // The point under the pointer, or null: nothing is marked until then.
  const active = hover != null && n ? clamp(hover, 0, n - 1) : null;

  const pick = (e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !n) return;
    const x = e.clientX - r.left - padL;
    const i = bars ? Math.floor(x / (band || 1)) : Math.round(x / (n > 1 ? innerW / (n - 1) : 1));
    setHover(clamp(i, 0, n - 1));
  };
  // The mark goes when the pointer leaves, a finger lifts, or the page takes
  // over a touch to scroll.
  const leave = () => setHover(null);

  const multi = series.length > 1;
  const ax = active == null ? 0 : X(active);
  const ay = active == null ? 0 : Y(series[0]?.data[active]?.value ?? 0);
  const bw = Math.max(2, Math.min(22, band * 0.62));
  const tipLeft = ax > w - 150;
  // The tooltip is centred on its point, but never rides up into the header
  // band or below the chart (half its height: padding + date + one row each).
  const tipHalf = (24 + 18 * series.length) / 2;
  const tipTop = clamp(ay, topInset - 4 + tipHalf, h - tipHalf);

  return (
    <div ref={ref} className="mtc" onPointerMove={pick} onPointerDown={pick} onPointerLeave={leave} onPointerCancel={leave}>
      {/* Nothing until there is room to plot: with no inner width every point
          shares one x, and the curve's slopes would be 0/0. */}
      {innerW > 0 && h > padT + padB && n > 0 && (
        <>
          <svg className="mtc-svg" width={w} height={h} aria-hidden="true">
            <defs>
              {series.map((s, k) => (
                <linearGradient key={k} id={`${gid}-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: s.color, stopOpacity: multi ? 0.12 : 0.28 }} />
                  <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>

            {active != null && <line className="mtc-guide" x1={ax} x2={ax} y1={padT - 8} y2={h - padB} />}

            {bars
              ? series.map((s, k) => s.data.map((d, i) => {
                  const each = bw / series.length;
                  const y = Y(d.value);
                  return (
                    <rect key={`${k}-${i}`} x={X(i) - bw / 2 + k * each} y={y} width={Math.max(1, each - (multi ? 1 : 0))} height={Math.max(0, h - padB - y)}
                      rx={Math.min(3, each / 2)} style={{ fill: s.color, opacity: active == null || i === active ? 1 : 0.38 }} />
                  );
                }))
              : series.map((s, k) => {
                  const pts = s.data.map((d, i) => [X(i), Y(d.value)]);
                  const line = smoothPath(pts);
                  return (
                    <g key={k}>
                      <path d={`${line}L${pts[pts.length - 1][0]},${h}L${pts[0][0]},${h}Z`} style={{ fill: `url(#${gid}-${k})` }} />
                      <path className="mtc-line" d={line} style={{ stroke: s.color }} />
                    </g>
                  );
                })}

            {active != null && !bars && series.map((s, k) => (
              <circle key={k} className="mtc-dot" cx={ax} cy={Y(s.data[active]?.value ?? 0)} r="4.5" style={{ fill: s.color }} />
            ))}
          </svg>

          {active != null && (
            <div className={`mtc-tip${tipLeft ? ' left' : ''}`} style={{ left: ax, top: tipTop }}>
              <div className="mtc-tip-d">{dateFormatter(series[0].data[active]?.date ?? '')}</div>
              {series.map((s, k) => (
                <div key={k} className="mtc-tip-row">
                  <i className="mtc-tip-dot" style={{ background: s.color }} />
                  {multi && <span className="mtc-tip-l">{s.name}</span>}
                  <span className="mtc-tip-v">{valueFormatter(s.data[active]?.value ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
