// Public project adapter - the shareable, unauthenticated project page.
//
// Source of truth: the CRM's `properties` table, read through the public anon
// PostgREST key (the same reader the app uses). Only fields that exist on the
// row are surfaced; nothing is invented.
//
// Mock supplement (development/demo only, OFF by default). Set
// VITE_PUBLIC_MOCK=1 to enable it. It only adds demo brochures (real public
// WECON marketing PDFs) so the brochure flow is visible before real brochures
// are uploaded to a project's docs in the Catalog. Swap to live by uploading a
// PDF there; no code change is needed.
//
// Unit statuses are normalized to the three public states:
//   available -> Available, hold -> Booked, sold -> Sold
// Custom project statuses (properties.unit_statuses) resolve to their base
// status first, so internal labels never reach the public page. The floor-plan
// canvas reuses its own hold/sold styling, so a normalized "booked" is handed
// to it as its base "hold" for rendering; selection gating uses the public
// label.

// The public project route, #/p/<propertyId>. Lives outside the app's view
// routing: it renders unauthenticated, above the login/shell gate (App.jsx).
// Kept in this standalone module (no store imports) so it is node-testable.
export const matchPublicRoute = (hash) => {
  const m = /^#\/p\/([^/?#]+)$/.exec(hash || '');
  return m ? { id: decodeURIComponent(m[1]) } : null;
};

// The public portfolio landing route: bare #/p (or #/p/). Lists published
// projects; the detail route #/p/<id> is handled by matchPublicRoute.
export const isPortfolioRoute = (hash) => /^#\/p\/?$/.test(hash || '');

export const PUBLIC_STATUSES = {
  available: { label: 'Available' },
  booked: { label: 'Booked' },
  sold: { label: 'Sold' },
};

const BASE_OF = { available: 'available', hold: 'booked', sold: 'sold' };
const CANVAS_OF = { available: 'available', booked: 'hold', sold: 'sold' };

// The public status of a unit: custom statuses resolve to their base first.
export function normalizeStatus(project, unit) {
  const c = unit?.tag ? (project?.unitStatuses || []).find(s => s.id === unit.tag) : null;
  const base = c ? c.base : (unit?.status === 'sold' ? 'sold' : unit?.status === 'hold' ? 'hold' : 'available');
  return BASE_OF[base] || 'sold';
}

export const unitSizeOf = (u, v) => (u?.size > 0 ? u.size : (v?.size || 0));
export const unitPriceOf = (u, v) => (u?.price > 0 ? u.price : ((v?.listRate || 0) * unitSizeOf(u, v)));

// The unit with this code anywhere in the project.
export function findUnitIn(project, id) {
  for (const v of project?.variants || []) {
    const u = (v.units || []).find(x => x.id === id);
    if (u) return { variant: v, unit: u };
  }
  return null;
}

export const sortPlans = (plans) => [...(plans || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// A summary line for the floor-plan canvas box: code, public status, and size
// when the unit has one.
export function boxAria(project, loc, status, fallbackCode = 'Unit') {
  const label = PUBLIC_STATUSES[status].label;
  if (!loc) return `${fallbackCode}, not linked to a unit`;
  const u = loc.unit, v = loc.variant;
  const size = unitSizeOf(u, v) > 0 ? `${unitSizeOf(u, v).toLocaleString('en-IN')} sqft, ` : '';
  return `${u.id}, ${v.name || 'unit'}, ${size}${label.toLowerCase()}`;
}

export const takaFmt = (n) => (n > 0 ? '৳' + Math.round(n).toLocaleString('en-IN') : '');

// Build the box list FloorPlanCanvas expects for one plan. Status passes the
// canvas base (available/hold/sold/unlinked); the public label rides in `aria`.
export function planBoxes(project, fp) {
  const W = fp?.image?.width || 1, H = fp?.image?.height || 1;
  return (fp?.boxes || []).map(b => {
    const loc = findUnitIn(project, b.unitId);
    if (!loc) {
      return {
        id: b.id, x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H,
        label: b.unitId || '-', status: 'unlinked', color: null, dim: false,
        aria: `${b.unitId || 'Unit'}, not linked to a unit`,
      };
    }
    const st = normalizeStatus(project, loc.unit);
    const size = unitSizeOf(loc.unit, loc.variant);
    const c = loc.unit.tag ? (project?.unitStatuses || []).find(s => s.id === loc.unit.tag) : null;
    return {
      id: b.id, x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H,
      label: loc.unit.id,
      sub: size > 0 ? `${size.toLocaleString('en-IN')} sqft` : '',
      status: CANVAS_OF[st],
      color: c?.color || null,
      dim: false,
      aria: boxAria(project, loc, st, b.unitId),
    };
  });
}

// Public count buckets for the legend, from the whole project (all variants).
export function projectCounts(project) {
  const counts = { available: 0, booked: 0, sold: 0 };
  for (const v of project?.variants || []) {
    for (const u of v.units || []) counts[normalizeStatus(project, u)]++;
  }
  return counts;
}

// A unit card for the detail panel. Only fields that exist are populated.
export function unitCard(project, unitId) {
  const loc = findUnitIn(project, unitId);
  if (!loc) return null;
  const st = normalizeStatus(project, loc.unit);
  const size = unitSizeOf(loc.unit, loc.variant);
  const price = unitPriceOf(loc.unit, loc.variant);
  return {
    code: loc.unit.id,
    type: loc.variant.name || '',
    size: size > 0 ? size : null,
    price: price > 0 ? price : null,
    status: st,
    statusLabel: PUBLIC_STATUSES[st].label,
  };
}

// ── loading ──────────────────────────────────────────────────────────────────
const MOCK = (import.meta.env && import.meta.env.VITE_PUBLIC_MOCK) === '1';
// Real public WECON marketing PDFs, demo-only (never shown unless VITE_PUBLIC_MOCK=1).
const MOCK_BROCHURES = {
  pxz4w57qtmrbz2gvm: ['https://drive.usercontent.google.com/download?id=1DaTRvoqv70yDYYCXzKpf'],
  px45mvl4ymqq7png2: ['https://drive.usercontent.google.com/u/0/uc?id=1QfDkccwseF0Ew3pT8qP5OR'],
};

export async function loadPublicProject(id, opts = {}) {
  const { sbGetPropertyRow } = await import('./supabase.js');
  const res = await sbGetPropertyRow(id);
  if (res.ok && res.row) {
    const r = res.row;
    // The publish toggle gates the live public page. Preview (admin) bypasses it.
    if (!opts.preview && !r.publicPublished) return { error: 'unpublished' };
    return {
      source: 'live',
      project: {
        id: r.id,
        name: r.name,
        type: r.purpose || '',
        address: r.address || '',
        handover: r.handover || '',
        listing: r.listing || '',
        details: r.details || '',
        floorPlans: sortPlans(r.floorPlans),
        brochures: (r.media?.docs || []).map(d => ({ label: d.label || 'Brochure', url: d.url })),
        publicPublished: !!r.publicPublished,
      },
    };
  }
  // Live unreachable or row missing: offer the demo brochure supplement only when
  // mock is enabled; otherwise a clear error. The floor-plan demo needs the live
  // row, so a full offline mock is intentionally not fabricated.
  if (MOCK && id in MOCK_BROCHURES) {
    return {
      source: 'mock',
      project: {
        id, name: 'Demo project', type: '', address: '', handover: '', listing: '',
        details: '', floorPlans: [],
        brochures: MOCK_BROCHURES[id].map(url => ({ label: 'Brochure (demo)', url })),
      },
    };
  }
  return { error: res.ok ? 'project not found' : 'project could not be loaded' };
}

// The public portfolio landing: every published project, projected to card fields.
export async function loadPublicPortfolio() {
  const { sbListPublishedProperties } = await import('./supabase.js');
  const res = await sbListPublishedProperties();
  if (res.ok) return { source: 'live', projects: res.projects };
  return { error: res.error };
}
