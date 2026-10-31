import { useState, useRef, useEffect } from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { ACCENTS } from './metric-chart-utils.js';
import { PeriodSelect } from './metric-controls.jsx';
import './donut-card.css';

// DonutCard: a titled card with a donut (the total in its middle) and a legend
// of every slice with its count and share. Adapted from a shadcn/recharts
// "Traffic By Source" block to this project's plain-JSX + CSS stack: the donut
// is hand-drawn SVG, like the rest of components/charts.
//
// Pointing at a slice (or its legend row) lifts it and dims the rest; a slice
// also shows a tooltip at the pointer. Nothing is marked otherwise. Wide cards
// put the legend beside the donut, narrow ones under it (container query).
// Touch (phones, tablets): a tap selects a slice or legend row and it stays
// selected — tooltip above the finger — until it is tapped again or a tap
// lands outside the card. (A touch fires pointer-leave on lift, which would
// otherwise clear it at once.) Mouse behaviour is unchanged.
//
// @example
// <DonutCard title="Lead sources" description="Where your leads came from" centerLabel="Leads"
//   data={[{ key: 'META_ADS', label: 'Meta', value: 812, color: 'var(--chart-1)' }, …]} />
//
// data: [{ key, label, value, color }], drawn in the order given (sort first).
// Optional header controls, as on ProgressMetricCard: `percent` (a change
// label) coloured by `trend` ('up' | 'down' | 'flat'), and a period picker:
// `period` (the current label), `periodOptions` ([{ label }]),
// `onPeriodChange(option)`. The card stays controlled; the caller owns the period.
// `loading`: a placeholder ring and legend instead of the data.
// `footer` (optional): anything to show under the legend, inside the card.

const C = 100, R = 96, RI = 66; // viewBox centre, outer and inner radius
const pt = (rad, a) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
// One ring segment from angle a0 to a1, drawn as two halves so a single slice
// can close the whole ring (a lone arc from a point back to itself draws nothing).
function sector(a0, a1) {
  const m = (a0 + a1) / 2;
  return `M${pt(R, a0)}A${R},${R} 0 0 1 ${pt(R, m)}A${R},${R} 0 0 1 ${pt(R, a1)}`
    + `L${pt(RI, a1)}A${RI},${RI} 0 0 0 ${pt(RI, m)}A${RI},${RI} 0 0 0 ${pt(RI, a0)}Z`;
}

const fmt = (n) => n.toLocaleString('en-US');
const pctOf = (v, sum) => (sum ? `${Math.round((v / sum) * 100)}%` : '0%');

export default function DonutCard({ title, description, data = [], centerLabel, emptyText = 'No data yet.', percent, trend = 'flat', period, periodOptions, onPeriodChange, loading = false, className, footer }) {
  const [hover, setHover] = useState(null); // { i, x, y, touch } — x/y only when over a slice
  const rootRef = useRef(null);
  const lastPointer = useRef('mouse'); // the legend's click handler needs the press's pointer type
  const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

  // A touch selection clears on the next tap outside the card.
  const touchSel = !!hover?.touch;
  useEffect(() => {
    if (!touchSel) return undefined;
    const off = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setHover(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [touchSel]);

  const items = data.filter((d) => d.value > 0);
  const sum = items.reduce((s, d) => s + d.value, 0);

  // Each slice spans [running total before it, running total with it], from
  // 12 o'clock clockwise.
  const ang = (v) => -Math.PI / 2 + (2 * Math.PI * v) / sum;
  const ends = items.map((_, i) => items.slice(0, i + 1).reduce((s, d) => s + d.value, 0));
  const arcs = items.map((d, i) => [ang(ends[i] - d.value), ang(ends[i])]);

  const overSlice = (i) => (e) => {
    const box = e.currentTarget.ownerSVGElement.parentElement.getBoundingClientRect();
    const x = e.clientX - box.left;
    if (isTouch(e)) {
      // Tooltip above the finger, kept off the plot's edges; a second tap on
      // the selected slice clears it.
      if (hover?.touch && hover.i === i && hover.x != null) { setHover(null); return; }
      setHover({ i, x: Math.min(Math.max(x, 64), box.width - 64), y: e.clientY - box.top, touch: true });
      return;
    }
    setHover({ i, x, y: e.clientY - box.top, flip: x > box.width / 2 }); // right half: tooltip opens leftward
  };
  const moveSlice = (i) => (e) => { if (!isTouch(e)) overSlice(i)(e); };
  const tip = hover && hover.x != null ? items[hover.i] : null;

  // Header change and period picker, styled like ProgressMetricCard's.
  const color = ACCENTS[trend === 'up' ? 'emerald' : trend === 'down' ? 'rose' : 'neutral'];
  const TrendIcon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : ArrowRight;

  return (
    <div ref={rootRef} className={cn('dnc', className)}>
      <div className="dnc-hd">
        <div className="dnc-hd-l">
          <h3 className="dnc-title">{title}</h3>
          {description && <p className="dnc-desc">{description}</p>}
        </div>
        {(percent || period) && (
          <div className="dnc-hd-r">
            {percent && (
              <span className="dnc-trend" style={{ color: color.text }}>
                <TrendIcon size={16} strokeWidth={2.5} aria-hidden="true" />{percent}
              </span>
            )}
            {period && <PeriodSelect value={period} options={periodOptions} onChange={onPeriodChange} accentText={color.text} />}
          </div>
        )}
      </div>
      {loading ? (
        <div className="dnc-body" aria-busy="true">
          <div className="dnc-plot"><div className="dnc-sk dnc-sk-ring" /></div>
          <div className="dnc-legend">{[0, 1, 2, 3].map((i) => <div key={i} className="dnc-sk dnc-sk-row" />)}</div>
        </div>
      ) : !items.length ? <div className="dnc-empty">{emptyText}</div> : (
        <div className="dnc-body">
          <div className="dnc-plot" onPointerLeave={(e) => { if (!isTouch(e)) setHover(null); }}>
            <svg className="dnc-svg" viewBox="0 0 200 200" role="img"
              aria-label={`${title}: ${items.map((d) => `${d.label} ${fmt(d.value)}`).join(', ')}`}>
              {items.map((d, i) => (
                <path key={d.key ?? d.label} d={sector(...arcs[i])} className={cn('dnc-slice', hover && hover.i !== i && 'dim')}
                  style={{ fill: d.color }} onPointerMove={moveSlice(i)} onPointerDown={overSlice(i)} />
              ))}
              <text x={C} y={C - 4} className="dnc-total" textAnchor="middle" dominantBaseline="middle">{fmt(sum)}</text>
              {centerLabel && <text x={C} y={C + 18} className="dnc-sub" textAnchor="middle" dominantBaseline="middle">{centerLabel}</text>}
            </svg>
            {tip && (
              <div className={cn('dnc-tip', hover.touch ? 'above' : hover.flip && 'left')} style={{ left: hover.x, top: hover.y }}>
                <i style={{ background: tip.color }} />
                <span className="dnc-tip-l">{tip.label}</span>
                <b>{fmt(tip.value)}</b>
                <span className="dnc-tip-p">{pctOf(tip.value, sum)}</span>
              </div>
            )}
          </div>
          <ul className="dnc-legend">
            {items.map((d, i) => (
              <li key={d.key ?? d.label} className={cn('dnc-row', hover && hover.i !== i && 'dim')}
                onPointerEnter={(e) => { if (!isTouch(e)) setHover({ i }); }}
                onPointerLeave={(e) => { if (!isTouch(e)) setHover(null); }}
                onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
                onClick={() => {
                  if (lastPointer.current !== 'touch' && lastPointer.current !== 'pen') return;
                  setHover((h) => (h?.touch && h.i === i && h.x == null ? null : { i, touch: true }));
                }}>
                <span className="dnc-sw" style={{ background: d.color }} aria-hidden="true" />
                <span className="dnc-lbl">{d.label}</span>
                <span className="dnc-val">{fmt(d.value)}</span>
                <span className="dnc-pct">{pctOf(d.value, sum)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {footer}
    </div>
  );
}
