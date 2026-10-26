// The date-filter presets as { start, end } ranges (null = all time). Shared by
// the header's DateRangePicker and the phone Home's period menu, so both list
// the same presets and set exactly the same `dateRange` for the same key.

export const DATE_PRESETS = [
  { key: 'custom',    label: 'Custom' },
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7',     label: 'Last 7 days' },
  { key: 'last28',    label: 'Last 28 days' },
  { key: 'last30',    label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last90',    label: 'Last 90 days' },
  { key: 'qtd',       label: 'Quarter to date' },
  { key: 'thisYear',  label: 'This year (Jan – Today)' },
  { key: 'lastYear',  label: 'Last calendar year' },
  { key: 'allTime',   label: 'All time' },
];

function startOf(d) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOf(d)   { const x=new Date(d); x.setHours(23,59,59,999); return x; }

export function getPresetRange(key) {
  const t = startOf(new Date());
  switch(key) {
    case 'today':     return { start: startOf(t), end: endOf(t) };
    case 'yesterday': { const d=new Date(t); d.setDate(d.getDate()-1); return { start: startOf(d), end: endOf(d) }; }
    case 'last7':     { const s=new Date(t); s.setDate(s.getDate()-6); return { start: startOf(s), end: endOf(t) }; }
    case 'last28':    { const s=new Date(t); s.setDate(s.getDate()-27); return { start: startOf(s), end: endOf(t) }; }
    case 'last30':    { const s=new Date(t); s.setDate(s.getDate()-29); return { start: startOf(s), end: endOf(t) }; }
    case 'thisMonth': { const s=new Date(t); s.setDate(1); return { start: startOf(s), end: endOf(t) }; }
    case 'lastMonth': { const s=new Date(t); s.setDate(1); s.setMonth(s.getMonth()-1); const e=new Date(t); e.setDate(0); return { start: startOf(s), end: endOf(e) }; }
    case 'last90':    { const s=new Date(t); s.setDate(s.getDate()-89); return { start: startOf(s), end: endOf(t) }; }
    case 'qtd':       { const s=new Date(t); s.setMonth(Math.floor(s.getMonth()/3)*3); s.setDate(1); return { start: startOf(s), end: endOf(t) }; }
    case 'thisYear':  { const s=new Date(t); s.setMonth(0); s.setDate(1); return { start: startOf(s), end: endOf(t) }; }
    case 'lastYear':  { const s=new Date(t); s.setFullYear(s.getFullYear()-1); s.setMonth(0); s.setDate(1); const e=new Date(t); e.setMonth(0); e.setDate(0); return { start: startOf(s), end: endOf(e) }; }
    case 'allTime':   return null;
    default:          return null;
  }
}
