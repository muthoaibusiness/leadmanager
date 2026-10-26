import { useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getPresetRange, DATE_PRESETS } from '../../lib/datePresets.js';
import { Menu, MenuRadioGroup, MenuDotRadio } from '../ui/menu.jsx';

// Small building blocks of the phone Home (ManagementDash / AgentDash below
// 768px). Presentation only: every value comes in through props or the
// existing date filter in AppContext.

// The page's date filter as a small pill + menu. It sets the same `dateRange`
// the header's DateRangePicker sets, so the two always agree. A preset picked
// in the header that is not offered here shows by its own name on the pill
// (no option checked). Custom starts from the range on screen (else the last
// 7 days); CustomRange below then edits its dates.
const PERIOD_OPTIONS = [
  { key: 'allTime', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'thisMonth', label: 'Month' },
  { key: 'thisYear', label: 'Year' },
  { key: 'custom', label: 'Custom' },
];

export function PeriodSelect() {
  const { dateRange, setDateRange } = useApp();
  const active = dateRange?.preset || 'allTime';
  const current = PERIOD_OPTIONS.find(o => o.key === active)?.label || DATE_PRESETS.find(p => p.key === active)?.label || 'All';
  const choose = (key) => {
    if (key === 'custom') {
      const r = dateRange?.range || getPresetRange('last7');
      setDateRange({ preset: 'custom', range: { start: r.start, end: r.end } });
    } else {
      setDateRange({ preset: key, range: getPresetRange(key) });
    }
  };
  // The pill opens a small menu (ui/menu.jsx); the picked option carries a
  // dot. With All picked the pill reads "All projects".
  // Focus goes back to the pill on close only when the menu was opened from
  // the keyboard (so its focus ring shows then, and not after a tap).
  const all = active === 'allTime';
  const byKeyboard = useRef(false);
  return (
    <Menu label={`Date filter: ${all ? 'All time' : current}`} align="end" className="mh-period-menu"
      onCloseAutoFocus={(e) => { if (!byKeyboard.current) e.preventDefault(); }}
      trigger={(
        <button type="button" className="mh-period-btn"
          onPointerDown={() => { byKeyboard.current = false; }} onKeyDown={() => { byKeyboard.current = true; }}>
          <span className="mh-period-tx">{all ? 'All projects' : current}</span>
        </button>
      )}>
      <MenuRadioGroup value={active} onChange={choose}>
        {PERIOD_OPTIONS.map(o => <MenuDotRadio key={o.key} value={o.key}>{o.label}</MenuDotRadio>)}
      </MenuRadioGroup>
    </Menu>
  );
}

// From / To dates for a Custom period, shown only while Custom is picked. The
// phone's own date picker opens on tap. Dates are whole local days: From at
// 00:00, To at 23:59:59.999, like the header picker's ranges.
const toInput = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const fromInput = (s, endOfDay) => { const [y, m, dd] = s.split('-').map(Number); const d = new Date(y, m - 1, dd); if (endOfDay) d.setHours(23, 59, 59, 999); return d; };

export function CustomRange() {
  const { dateRange, setDateRange } = useApp();
  if (dateRange?.preset !== 'custom' || !dateRange.range) return null;
  const { start, end } = dateRange.range;
  const setStart = (v) => { if (v) { const s = fromInput(v); setDateRange({ preset: 'custom', range: { start: s, end: s > end ? fromInput(v, true) : end } }); } };
  const setEnd = (v) => { if (v) { const e = fromInput(v, true); setDateRange({ preset: 'custom', range: { start: e < start ? fromInput(v) : start, end: e } }); } };
  return (
    <div className="mh-range">
      <label><span>From</span><input type="date" value={toInput(start)} max={toInput(end)} onChange={e => setStart(e.target.value)} /></label>
      <label><span>To</span><input type="date" value={toInput(end)} min={toInput(start)} onChange={e => setEnd(e.target.value)} /></label>
    </div>
  );
}

// A progress ring with the percentage in its middle. `pct` is clamped to 0–100.
export function Ring({ pct, label }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const C = 2 * Math.PI * 24;
  return (
    <div className="mh-ring">
      <svg width="58" height="58" viewBox="0 0 58 58" role="img" aria-label={label}>
        <circle cx="29" cy="29" r="24" className="mh-ring-track" />
        {p > 0 && <circle cx="29" cy="29" r="24" className="mh-ring-fill" strokeDasharray={`${(p / 100) * C} ${C}`} transform="rotate(-90 29 29)" />}
      </svg>
      <span aria-hidden="true">{p}%</span>
    </div>
  );
}

// One labelled bar: label left, value right, a thin track under them.
export function Meter({ label, value, pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="mh-meter">
      <div className="mh-meter-hd"><span>{label}</span><b>{value}</b></div>
      <div className="mh-track"><div className="mh-fill" style={{ width: p + '%' }} /></div>
    </div>
  );
}

// A section title with an optional "See all ›" action on the right.
export function SecHead({ title, action, onAction, count, children }) {
  return (
    <div className="mh-sec-hd">
      <h2>{title}</h2>
      {count > 0 && <span className="mh-count">{count}</span>}
      {children}
      {action && <button type="button" className="mh-link" onClick={onAction}>{action} ›</button>}
    </div>
  );
}
