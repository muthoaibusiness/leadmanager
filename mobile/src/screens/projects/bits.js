// Small display helpers shared by the two project screens. The numbers
// themselves come from src/lib/projects.js; these only word them.
import { PROPERTY_STATUS } from '../../../../src/lib/constants.js';

// A project's availability status (projectInventory().status) as a Badge tone.
export const PROJECT_STATUS_TONE = { AVAILABLE: 'brand', FEW_LEFT: 'warn', SOLD_OUT: 'danger', UPCOMING: 'info' };
export const projectStatusLabel = (s) => PROPERTY_STATUS[s] || s;

// A unit's base status as a tone.
export const UNIT_TONE = { available: 'brand', hold: 'warn', sold: 'danger' };
const UNIT_LABEL = { available: 'Available', hold: 'On hold', sold: 'Sold' };

// A unit's look: its custom status (the project's own unitStatuses, by the
// unit's tag) or its base. Copied from statusLook() in src/lib/floorPlan.js
// (importable now that metro.config.js stubs pdf.js; this copy predates that).
export function unitLook(statuses, unit) {
  const base = unit?.status || 'available';
  const c = unit?.tag ? (statuses || []).find((s) => s.id === unit.tag) : null;
  return c ? { status: base, label: c.name, color: c.color } : { status: base, label: UNIT_LABEL[base] || base, color: null };
}

// The legend key a unit counts under, as ProjectConsole's legend counts: a unit
// with a project status counts there, not in its base, so the counts add up.
export const unitKey = (statuses, u) => (u.tag && (statuses || []).some((st) => st.id === u.tag) ? 'c:' + u.tag : u.status);

// "৳9,500" or "৳9,500 – 12,500" (PropertiesView span()).
export const span = (min, max, pre = '', post = '') => (min == null ? '—'
  : min === max ? `${pre}${min.toLocaleString()}${post}` : `${pre}${min.toLocaleString()} – ${max.toLocaleString()}${post}`);

// 1,250 · 12.5k · 1.4M (PropertiesView fmtSft()).
export const fmtSft = (n) => {
  const short = (v, s) => (v >= 100 ? Math.round(v) : +v.toFixed(1)) + s;
  return n >= 1e6 ? short(n / 1e6, 'M') : n >= 1e4 ? short(n / 1e3, 'k') : Math.round(n).toLocaleString('en-IN');
};

// Short taka: crore / lakh (ProjectConsole crShort(), with the ৳ sign).
const taka = (n) => '৳' + Math.round(n || 0).toLocaleString('en-IN');
export const crShort = (n) => (n >= 1e7 ? '৳' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '৳' + (n / 1e5).toFixed(1) + ' L' : taka(n));
export { taka };

export const coverOf = (p) => p?.media?.images?.[0]?.url || p?.images?.[0] || '';
export const dayMonth = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
