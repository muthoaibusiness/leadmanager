// The period chips on the Analytics page. A key picks the first moment that counts; the end is always now.
export const PERIODS = [
  { key: '1', label: 'Today', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: 0 },
];

// → the start of the period in ms, or null for all time. "Today" starts at midnight.
export function periodStart(key, now = Date.now()) {
  const p = PERIODS.find(x => x.key === key);
  if (!p || !p.days) return null;
  if (p.days === 1) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return now - p.days * 864e5;
}
