import { ChartColumn, ChartSpline, ChevronDown } from 'lucide-react';
import { Menu, MenuRadioGroup, MenuRadio } from './menu.jsx';
import './metric-chart.css';

// ProgressMetricCard's header controls. They sit on a layer that lets the
// pointer through to the chart, so each one takes the pointer back (CSS).

const VIEWS = [['curve', ChartSpline, 'Curve'], ['bars', ChartColumn, 'Bars']];

// Curve / bars switch.
export function ViewToggle({ value, onChange }) {
  return (
    <div className="mtc-view" role="group" aria-label="Chart type">
      {VIEWS.map(([v, Icon, label]) => (
        <button key={v} type="button" className="mtc-view-b" aria-pressed={value === v} aria-label={label} title={label} onClick={() => onChange(v)}>
          <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// Period picker: the current label, opening a pick-one menu.
// options: [{ label, points? }]; onChange gets the whole option.
export function PeriodSelect({ value, options = [], onChange, accentText }) {
  const pick = (label) => { const o = options.find((x) => x.label === label); if (o) onChange?.(o); };
  return (
    <Menu label={`Period: ${value}`} trigger={(
      <button type="button" className="mtc-period" style={{ color: accentText }}>
        {value}<ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
      </button>
    )}>
      <MenuRadioGroup value={value} onChange={pick}>
        {options.map((o) => <MenuRadio key={o.label} value={o.label}>{o.label}</MenuRadio>)}
      </MenuRadioGroup>
    </Menu>
  );
}
