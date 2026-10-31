import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import Mi from '../Mi.jsx';
import { Menu, MenuRadioGroup, MenuDotRadio } from '../ui/menu.jsx';
import { usePageOverlay } from '../../hooks/useNavHistory.js';
import { periodRange } from '../../lib/contactPerf.js';

// Phone-only "Lead sources" page, opened from the phone Home's Lead sources
// card (LeadSourcesCard variant="soft"). It fits one screen (no page scroll):
// the list shows up to 9 sources and scrolls inside its card past that, and
// the ring takes the height left. Full screen over the app: a round
// Back button and the period pill on top, the title with its date span, a ring
// of rounded segments with each source's name around it, then the list by
// source. Every number comes in from the card (same data, same period);
// nothing is loaded here. Tapping a segment or a row picks that source (the
// rest dim, the middle shows it); tapping it again clears. Back (the button,
// the phone's back gesture, Esc) closes the page.


// viewBox size, centre, ring radius, ring thickness, space between two segments' round ends
const V = 300, C = 150, R = 78, SW = 26, GAP = 6;
// Name chips: beside the ring on the left/right (their inner edge on the
// point, so they grow away from it), centred at the top/bottom. Each starts
// close and steps outward until its nearest corner clears the ring. Chips keep
// their pixel size while the ring scales to the screen, so their size in
// viewBox units is divided by the ring's scale `k` (rendered px / 300).
const LR_SIDE = R + SW / 2 + 8, LR_MID = R + SW / 2 + 16;
const CHIP_H = 20, CHIP_HW = 38; // chip height; half the widest chip (max-width 76px), in px
const CLEAR = R + SW / 2 + 6;
function clearRadius(mid, side, k) {
  const h = CHIP_H / k / 2, hw = CHIP_HW / k;
  for (let rad = side === 'mid' ? LR_MID : LR_SIDE; rad < C * 1.4; rad += 2) {
    const [x, y] = polar(rad, mid);
    const nx = side !== 'mid' ? x : Math.abs(x - C) <= hw ? C : x - Math.sign(x - C) * hw;
    const ny = Math.abs(y - C) <= h ? C : y - Math.sign(y - C) * h;
    if (Math.hypot(nx - C, ny - C) >= CLEAR) return rad;
  }
  return C * 1.4;
}
// Motion, following the Users tab (AccountsView): rows rise in, staggered, on a
// spring (the same variants); the ring's segments grow from a dot in the same
// rhythm, then the names rise in and the % fade in. It all replays when the
// period changes, and none of it runs with reduced motion.
const LIST_V = { visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } };
const ROW_V = {
  hidden: { opacity: 0, y: 20, scale: 0.98, filter: 'blur(4px)' },
  visible: {
    opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 400, damping: 25, mass: 0.7 },
    transitionEnd: { filter: 'none' },   // a leftover blur(0px) would keep each row on its own layer
  },
};
const SEG_V = {
  hidden: { pathLength: 0 },
  visible: (i) => ({ pathLength: 1, transition: { type: 'spring', stiffness: 140, damping: 22, mass: 0.8, delay: 0.1 + i * 0.05 } }),
};
const CHIP_V = {
  hidden: ROW_V.hidden,
  visible: (i) => ({ ...ROW_V.visible, transition: { ...ROW_V.visible.transition, delay: 0.25 + i * 0.04 } }),
};
const PCT_V = { hidden: { opacity: 0 }, visible: (i) => ({ opacity: 1, transition: { duration: 0.25, delay: 0.35 + i * 0.05 } }) };
const CENTER_V = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 24, delay: 0.15 } },
};

const fmt = (n) => n.toLocaleString('en-US');
const pctOf = (v, sum) => (sum ? Math.round((v / sum) * 100) : 0);
const polar = (rad, a) => [C + rad * Math.cos(a), C + rad * Math.sin(a)];
function arcPath(a0, a1) {
  const [x0, y0] = polar(R, a0);
  const [x1, y1] = polar(R, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

// Segments clockwise from 12 o'clock. Each round end reaches SW/2 past its arc,
// so every segment also gives up (SW + GAP) / R of angle; a tiny share still
// shows as a dot. Names sit on a ring outside; one too close to the last moves
// out a step.
function ringLayout(items, sum, k) {
  const capAng = (SW + GAP) / R;
  const avail = Math.max(0, 2 * Math.PI - items.length * capAng);
  let a = -Math.PI / 2 + capAng / 2;
  const segs = [];
  for (const d of items) {
    const len = Math.max(0.002, (avail * d.value) / sum);
    segs.push({ a0: a, a1: a + len, mid: a + len / 2 });
    a += len + capAng;
  }
  const spots = segs.map((s) => {
    const c = Math.cos(s.mid);
    const side = c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'mid';
    const [x, y] = polar(clearRadius(s.mid, side, k), s.mid);
    return { x, y, side };
  });
  // Chips on the same side keep at least one chip-height apart (the lower one
  // moves down), so a run of small slices does not stack its names.
  const step = (CHIP_H + 2) / k;
  for (const side of ['start', 'end']) {
    const col = spots.filter((p) => p.side === side).sort((p, q) => p.y - q.y);
    for (let i = 1; i < col.length; i++) if (col[i].y - col[i - 1].y < step) col[i].y = col[i - 1].y + step;
  }
  const labels = spots.map(({ x, y, side }) => ({
    left: `${(x / V) * 100}%`, top: `${(y / V) * 100}%`,
    transform: side === 'start' ? 'translate(0, -50%)' : side === 'end' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)',
  }));
  return { segs, labels };
}

function rangeText(period, now) {
  if (period.all) return 'All time';
  const { start } = periodRange(period, now);
  const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (period.hours) return `${day(start)}, ${new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – now`;
  return `${day(start)} – ${day(now)} ${new Date(now).getFullYear()}`;
}

export default function LeadSourcesPage({ data, period, periods, onPeriodChange, loading, emptyText, percent, trend, now, onClose }) {
  usePageOverlay(true, onClose);
  return createPortal(
    <SourcesPage data={data} period={period} periods={periods} onPeriodChange={onPeriodChange} loading={loading}
      emptyText={emptyText} percent={percent} trend={trend} now={now} onClose={onClose} />,
    document.body,
  );
}

function SourcesPage({ data, period, periods, onPeriodChange, loading, emptyText, percent, trend, now, onClose }) {
  const [sel, setSel] = useState(null); // picked source key
  const backRef = useRef(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  // The ring's rendered scale (px / 300), measured, so the fixed-size name
  // chips and % labels are placed and sized for the ring that fits the screen.
  const [scale, setScale] = useState(1);
  const roRef = useRef(null);
  const donutRef = useCallback((node) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setScale(Math.round((w / V) * 100) / 100);
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);
  // A very small ring (short screens) drops the names and % around/in it;
  // the list below still has every name and share.
  const showChips = scale >= 0.6;
  // Reduced motion: no variants and no initial state, so everything is simply there.
  const reduce = useReducedMotion();
  const play = reduce ? {} : { initial: 'hidden', animate: 'visible' };
  const vars = (v) => (reduce ? {} : { variants: v });

  const items = data.filter((d) => d.value > 0);
  const sum = items.reduce((s, d) => s + d.value, 0);
  const picked = items.find((d) => d.key === sel) || null;
  const toggle = (key) => setSel((k) => (k === key ? null : key));

  const n = items.length;
  const { segs, labels } = ringLayout(items, sum, scale);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); onClose(); }
  };

  return (
    <div className="lsp" role="dialog" aria-modal="true" aria-labelledby="lsp-title" onKeyDown={onKeyDown}>
      <div className="lsp-top">
        <button ref={backRef} type="button" className="lsp-back" onClick={onClose} aria-label="Back to Home">
          <Mi aria-hidden="true">chevron_left</Mi>
        </button>
        <Menu label={`Period: ${period.label}`} align="end" className="mh-period-menu"
          trigger={<button type="button" className="lsp-pill">{period.label}</button>}>
          <MenuRadioGroup value={period.label} onChange={(label) => { const p = periods.find((x) => x.label === label); if (p) onPeriodChange(p); }}>
            {periods.map((p) => <MenuDotRadio key={p.label} value={p.label}>{p.label}</MenuDotRadio>)}
          </MenuRadioGroup>
        </Menu>
      </div>

      <div className="lsp-body">
        <h1 id="lsp-title" className="lsp-title">Lead sources</h1>
        <p className="lsp-sub">{rangeText(period, now)}</p>

        {loading ? (
          <div className="lsp-chart">
            <div className="lsp-donut" aria-busy="true">
              <svg viewBox={`0 0 ${V} ${V}`} aria-hidden="true"><circle cx={C} cy={C} r={R} className="lsp-track" /></svg>
              <div className="lsp-center"><span>Loading…</span></div>
            </div>
          </div>
        ) : !items.length ? (
          <p className="lsp-note">{emptyText}</p>
        ) : (
          <>
            {/* The ring takes the height the list leaves (no page scroll). */}
            <div className="lsp-chart">
            <div className="lsp-donut" ref={donutRef}>
              <svg viewBox={`0 0 ${V} ${V}`} role="img"
                aria-label={`Lead sources: ${items.map((d) => `${d.label} ${fmt(d.value)}`).join(', ')}`}>
                <motion.g key={`segs-${period.label}`} {...play}>
                  {n === 1 ? (
                    <motion.circle cx={C} cy={C} r={R} className="lsp-seg" style={{ stroke: items[0].color }} onClick={() => toggle(items[0].key)}
                      {...vars(SEG_V)} custom={0} />
                  ) : items.map((d, i) => (
                    <motion.path key={d.key} d={arcPath(segs[i].a0, segs[i].a1)} className={`lsp-seg${picked && picked.key !== d.key ? ' dim' : ''}`}
                      style={{ stroke: d.color }} onClick={() => toggle(d.key)} {...vars(SEG_V)} custom={i} />
                  ))}
                </motion.g>
                <motion.g key={`pcts-${period.label}`} {...play}>
                  {items.map((d, i) => {
                    // A % inside a segment only when the segment can hold it.
                    const arcPx = n === 1 ? Infinity : ((segs[i].a1 - segs[i].a0) * R + SW) * scale;
                    if (d.value / sum < 0.1 || arcPx < 40 || SW * scale < 18) return null;
                    const [x, y] = n === 1 ? polar(R, -Math.PI / 2) : polar(R, segs[i].mid);
                    return (
                      <motion.text key={d.key} x={x} y={y} className="lsp-seg-pct" style={{ fontSize: 10.5 / scale }} textAnchor="middle" dominantBaseline="central"
                        {...vars(PCT_V)} custom={i}>{pctOf(d.value, sum)}%</motion.text>
                    );
                  })}
                </motion.g>
              </svg>
              {/* The outer span places the chip (and dims it); the inner one animates. */}
              {showChips && items.map((d, i) => (
                <span key={`${period.label}-${d.key}`} className={`lsp-chip-pos${picked && picked.key !== d.key ? ' dim' : ''}`} style={labels[i]} aria-hidden="true">
                  <motion.span className="lsp-chip" style={{ color: `color-mix(in srgb, ${d.color} 78%, var(--mh-ink, currentColor))` }}
                    {...play} {...vars(CHIP_V)} custom={i}>
                    {d.label}
                  </motion.span>
                </span>
              ))}
              <motion.div key={`center-${period.label}`} className="lsp-center" aria-live="polite" {...play} {...vars(CENTER_V)}>
                <b>{fmt(picked ? picked.value : sum)}</b>
                <span>{picked ? `${picked.label} · ${pctOf(picked.value, sum)}%` : 'Leads'}</span>
              </motion.div>
            </div>
            </div>

            <div className="lsp-sec-hd">
              <div>
                <h2>Leads by source</h2>
                <p>
                  {fmt(sum)} {sum === 1 ? 'lead' : 'leads'}
                  {percent != null && (
                    <> · <span className={trend === 'up' ? 'lsp-up' : 'lsp-down'}>{trend === 'up' ? '+' : trend === 'down' ? '−' : ''}{percent}</span> vs previous {period.span}</>
                  )}
                </p>
              </div>
            </div>
            <motion.ul key={`list-${period.label}`} className="lsp-list" {...play} {...vars(LIST_V)}>
              {items.map((d) => (
                <motion.li key={d.key} {...vars(ROW_V)}>
                  <button type="button" className={`lsp-row${picked && picked.key !== d.key ? ' dim' : ''}`} aria-pressed={picked?.key === d.key} onClick={() => toggle(d.key)}>
                    <span className="lsp-dot" style={{ background: d.color }} aria-hidden="true" />                    <span className="lsp-name">{d.label}</span>
                    <span className="lsp-val">{fmt(d.value)}</span>
                    <span className="lsp-pct">{pctOf(d.value, sum)}%</span>
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          </>
        )}
      </div>
    </div>
  );
}
