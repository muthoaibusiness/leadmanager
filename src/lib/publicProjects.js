// Public project pages: the shareable, unauthenticated portfolio (#/p) and
// project page (#/p/<id>).
//
// Source of truth: the CRM's `properties` table, but never read directly. The
// two RPCs from migration 0060 (public_projects, public_project) return
// published projects only, with a fixed whitelist of fields. Unit statuses
// arrive already resolved to the three public states, custom statuses folded
// into their base:
//   available -> Available, hold -> Booked, sold -> Sold
// Hold metadata (client, holder, expiry, note), rates, prices and company ids
// never leave the database, so nothing here can show them by mistake.
//
// The two Admin > Public Project helpers at the bottom (normalizeStatus,
// projectCounts) work on the full CRM project an admin already has in memory.
//
// Kept free of store imports (supabase.js is loaded lazily) so it is
// node-testable.

// The public project route, #/p/<propertyId>. Lives outside the app's view
// routing: it renders unauthenticated, above the login/shell gate (App.jsx).
export const matchPublicRoute = (hash) => {
  const m = /^#\/p\/([^/?#]+)$/.exec(hash || '');
  return m ? { id: decodeURIComponent(m[1]) } : null;
};

// The public portfolio landing route: bare #/p (or #/p/). Lists published
// projects; the detail route #/p/<id> is handled by matchPublicRoute.
export const isPortfolioRoute = (hash) => /^#\/p\/?$/.test(hash || '');

// Brand for the public pages. Static on purpose: the CRM has no per-company
// brand settings yet.
// shortcut: one company's brand, hard-coded. Move to a company profile row
// when a second company publishes projects.
export const PUBLIC_BRAND = {
  name: 'WECON',
  sub: 'PROPERTIES',
  full: 'WECON Properties',
  tagline: 'Residential and commercial projects. Unit availability on these pages comes straight from our sales inventory.',
  office: '687 Mehedibag, Chattogram 4203',
};

// Project names are stored in capitals ("WECON SOUTHDALE"); show them in title case.
export const displayName = (s = '') => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s);

export const STATUS_LABEL = { available: 'Available', booked: 'Booked', sold: 'Sold' };
const CANVAS_OF = { available: 'available', booked: 'hold', sold: 'sold' };

export const sft = (n) => (n > 0 ? `${Math.round(n).toLocaleString('en-IN')} sft` : '');

// "2,800 sft", or "70 - 1,678 sft" for a range; '' when there are no sizes.
export function sizeRange(min, max) {
  if (!(min > 0)) return '';
  return max > min ? `${Math.round(min).toLocaleString('en-IN')} - ${sft(max)}` : sft(min);
}

// Every unit of a public project, flattened, with its variant.
export function allUnits(project) {
  return (project?.variants || []).flatMap(v => (v.units || []).map(u => ({ unit: u, variant: v })));
}

export function countUnits(project) {
  const c = { available: 0, booked: 0, sold: 0 };
  for (const { unit } of allUnits(project)) c[unit.status] = (c[unit.status] || 0) + 1;
  return c;
}

export const findPublicUnit = (project, id) => allUnits(project).find(x => x.unit.id === id) || null;

// The unit detail card. Only an available unit opens one: booked and sold are
// visibly unavailable and never open the detail flow.
export function unitDetail(project, id) {
  const hit = findPublicUnit(project, id);
  if (!hit || hit.unit.status !== 'available') return null;
  const { unit, variant } = hit;
  return {
    code: unit.id, status: unit.status, statusLabel: STATUS_LABEL[unit.status],
    type: variant.name || '', size: unit.size > 0 ? unit.size : null,
    beds: variant.beds > 0 ? variant.beds : null, baths: variant.baths > 0 ? variant.baths : null,
  };
}

// "At a Glance" rows, only those with a value.
export function glanceRows(project) {
  const c = countUnits(project);
  const total = c.available + c.booked + c.sold;
  return [
    ['Project type', project.type], ['Location', project.address], ['Handover', project.handover],
    ['Floors', project.storeys], ['Land area', project.landArea],
    ['Unit sizes', sizeRange(project.counts?.minSize, project.counts?.maxSize) || project.sizeText],
    ['Facing', project.facing], ['Total units', total ? String(total) : ''],
  ].filter(([, v]) => v);
}

// Floor plans in their saved order.
export const sortPlans = (plans) => [...(plans || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const byCode = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

// The floor list of the Units block, top floor first, as on Available Units:
// one entry per floor plan with the units boxed on it (code order), then
// "Other units" for units on no plan ("All units" when there are no plans).
// A unit boxed on two plans is listed once, on the lower one.
export function floorStack(project) {
  const plans = sortPlans(project?.plans);
  const byId = new Map(allUnits(project).map(x => [x.unit.id, x]));
  const placed = new Set();
  const floors = plans.map(f => {
    const units = [];
    for (const b of f.boxes || []) {
      const hit = byId.get(b.unitId);
      if (hit && !placed.has(hit.unit.id)) { placed.add(hit.unit.id); units.push(hit); }
    }
    units.sort((a, b) => byCode(a.unit.id, b.unit.id));
    return { id: f.id, name: f.name || 'Floor plan', plan: f, units };
  }).reverse();
  const rest = [...byId.values()].filter(x => !placed.has(x.unit.id)).sort((a, b) => byCode(a.unit.id, b.unit.id));
  if (rest.length) floors.push({ id: 'other', name: plans.length ? 'Other units' : 'All units', plan: null, units: rest });
  return floors;
}

// The box list FloorPlanCanvas expects for one plan. Status is the canvas base
// (available/hold/sold/unlinked); the public label rides in `aria`.
export function planBoxes(project, fp) {
  const W = fp?.image?.width || 1, H = fp?.image?.height || 1;
  return (fp?.boxes || []).map(b => {
    const hit = findPublicUnit(project, b.unitId);
    const base = { id: b.id, x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H, color: null, dim: false };
    if (!hit) return { ...base, label: b.unitId || '-', status: 'unlinked', aria: `${b.unitId || 'Area'}, not linked to a unit` };
    const { unit, variant } = hit;
    return {
      ...base, label: unit.id, sub: sft(unit.size), status: CANVAS_OF[unit.status],
      aria: `${unit.id}, ${variant.name || 'unit'}${unit.size > 0 ? ', ' + sft(unit.size) : ''}, ${STATUS_LABEL[unit.status].toLowerCase()}`,
    };
  });
}

// A Catalog link is the project's map when it is labelled "Map" or points at Google Maps.
export const isMapLink = (l) => /^map$/i.test((l?.label || '').trim()) || /^https:\/\/(www\.)?google\.[a-z.]+\/maps|^https:\/\/maps\.(google\.[a-z.]+|app\.goo\.gl)\//i.test(l?.url || '');

// The embeddable form of a Google Maps link: its place query (?q=) through the
// keyless /maps?output=embed endpoint. '' when the link carries no query.
export function mapEmbedUrl(url) {
  let q;
  try { q = new URL(url).searchParams.get('q') || ''; } catch { return ''; }
  return q ? `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : '';
}

// Only https links may reach an <img>, <a href> or <image href>.
export const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');

// ── loading ──────────────────────────────────────────────────────────────────
export async function loadPublicPortfolio() {
  const { sbPublicProjects } = await import('./supabase.js');
  const res = await sbPublicProjects();
  if (!res.ok) return { error: res.error };
  return { projects: Array.isArray(res.data) ? res.data : [] };
}

// opts.preview: the admin preview of an unpublished project. It reads the
// admin's own cached copy, reduced to the same public fields, so the preview
// never needs publishing first and never shows more than the public would.
export async function loadPublicProject(id, opts = {}) {
  if (opts.preview && opts.source) return { project: toPublic(opts.source) };
  const { sbPublicProject } = await import('./supabase.js');
  const res = await sbPublicProject(id);
  if (!res.ok) return { error: res.error };
  if (!res.data) return { error: 'unpublished' };
  return { project: { ...res.data, plans: sortPlans(res.data.plans) } };
}

// A full CRM project reduced to the public shape the RPC returns. The single
// client-side twin of public_project() (migration 0060); keep the two in step.
export function toPublic(p) {
  const url = (m) => safeUrl(typeof m === 'string' ? m : m?.url);
  const variants = (p.variants || []).map(v => ({
    id: v.id, name: v.name || '', size: v.size > 0 ? v.size : null,
    beds: v.beds > 0 ? v.beds : null, baths: v.baths > 0 ? v.baths : null,
    units: (v.units || []).map(u => ({ id: u.id, size: u.size > 0 ? u.size : (v.size > 0 ? v.size : null), status: normalizeStatus(p, u) })),
  }));
  const sizes = variants.flatMap(v => v.units.map(u => u.size)).filter(n => n > 0);
  const photos = (p.media?.images || []).map(url).filter(Boolean);
  return {
    id: p.id, name: p.name || '', type: p.purpose || '', address: p.address || '', handover: p.handover || '',
    sizeText: p.sizeText || '', storeys: p.storeys || '', landArea: p.landArea || '', facing: p.facing || '',
    details: p.details || '', facts: Array.isArray(p.publicFacts) ? p.publicFacts : [], cover: photos[0] || null, photos,
    brochures: (p.media?.docs || []).map(d => ({ label: d.label || 'Brochure', url: url(d) })).filter(d => d.url),
    links: (p.media?.links || []).map(l => ({ label: l.label || 'Link', url: url(l) })).filter(l => l.url),
    counts: { minSize: sizes.length ? Math.min(...sizes) : null, maxSize: sizes.length ? Math.max(...sizes) : null },
    variants,
    plans: sortPlans(p.floorPlans).filter(f => safeUrl(f.image?.url)).map(f => ({
      id: f.id, name: f.name || 'Floor plan', order: f.order ?? 0,
      image: { url: f.image.url, width: f.image.width, height: f.image.height },
      boxes: (f.boxes || []).map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, unitId: b.unitId })),
    })),
  };
}

// ── Admin helpers (full CRM project in memory) ──────────────────────────────
const BASE_OF = { available: 'available', hold: 'booked', sold: 'sold' };

// The public status of a CRM unit: custom statuses resolve to their base first.
export function normalizeStatus(project, unit) {
  const c = unit?.tag ? (project?.unitStatuses || []).find(s => s.id === unit.tag) : null;
  const base = c ? c.base : (unit?.status === 'sold' ? 'sold' : unit?.status === 'hold' ? 'hold' : 'available');
  return BASE_OF[base] || 'sold';
}

// Public count buckets for a CRM project (all variants).
export function projectCounts(project) {
  const counts = { available: 0, booked: 0, sold: 0 };
  for (const v of project?.variants || []) {
    for (const u of v.units || []) counts[normalizeStatus(project, u)]++;
  }
  return counts;
}
