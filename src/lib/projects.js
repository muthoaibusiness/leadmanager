// ── Projects data module (storefront model) ──────────────────────────────────
// Single source for the Project (Property) variant/storefront model:
//   Project { name, location, handover, listing, approval, fastClosePct,
//             fastCloseDays, media:{images,docs,links}, variants[], addons[] }
//   Variant { id, name, beds, baths, size, listRate, floorRate, unitPrefix, units[] }
//   Unit    { id, status: 'available'|'hold'|'sold' }
//   AddOn   { id, name, amount, icon }
//   Media   { name?, label?, url }
//
// Backed today by the in-memory + localStorage + Supabase store (via db.js).
// Everything goes through this module, so swapping to a real API = change the
// bodies here only — the UI never touches the store directly.

import { getProperty, getProperties, addPropertyFn, updatePropertyFn, deletePropertyFn, unitsFromCodes } from './db.js';
import { uid } from './helpers.js';

const nowISO = () => new Date().toISOString();
const mapStatus = (s) => (s === 'sold' ? 'sold' : s === 'available' ? 'available' : 'hold'); // locked/booked → hold

// ── shape / migration (legacy property → storefront project) ─────────────────
function defaultVariants(p) {
  const size = p.sizeMin || parseInt(String(p.sizeText || '').replace(/[^0-9]/g, ''), 10) || 0;
  const listRate = p.pricePerSqft || 0;
  const floorRate = p.floorRate || Math.round(listRate * 0.92);
  const base = (p.units && p.units.length) ? p.units : unitsFromCodes(p.saleableUnits, p.totalUnits, []);
  const units = base.map(u => ({
    id: u.no, status: mapStatus(u.status),
    heldByName: u.heldByName || '', clientName: u.clientName || '', clientId: u.clientId || null,
  }));
  return [{ id: 'v-std', name: p.type || 'Standard', beds: 0, baths: 0, size, listRate, floorRate, unitPrefix: '', units }];
}

function defaultMedia(p) {
  return {
    images: (p.images || []).map(u => ({ url: u })),
    docs: (p.documents || []).map(d => ({ label: d.name || d.type || 'Document', url: d.url })),
    links: p.driveLink ? [{ label: 'Drive', url: p.driveLink }] : [],
  };
}

// Present a stored property in the canonical storefront shape (non-destructive).
export function toProject(p) {
  if (!p) return null;
  const media = p.media && (p.media.images || p.media.docs || p.media.links) ? p.media : defaultMedia(p);
  return {
    ...p,
    variants: (p.variants && p.variants.length) ? p.variants : defaultVariants(p),
    addons: p.addons || [],
    media: { images: media.images || [], docs: media.docs || [], links: media.links || [] },
    fastClosePct: p.fastClosePct ?? 2,
    fastCloseDays: p.fastCloseDays ?? 5,
    listing: p.listing || '',
    approval: p.approval || '',
  };
}

// Sensible starter add-ons (admin can edit/delete in the catalog). BDT amounts.
const DEFAULT_ADDONS = [
  { id: 'ao-park', name: 'Car parking', amount: 800000, icon: 'directions_car' },
  { id: 'ao-util', name: 'Utility & connection', amount: 350000, icon: 'bolt' },
  { id: 'ao-corner', name: 'Corner premium', amount: 250000, icon: 'home' },
  { id: 'ao-gas', name: 'Gas line', amount: 150000, icon: 'local_fire_department' },
];

// One-time backfill so existing properties gain the storefront fields (run at load).
export function migrateProjects(db) {
  let changed = false;
  (db.properties || []).forEach(p => {
    if (!p.variants || !p.variants.length) { p.variants = defaultVariants(p); changed = true; }
    if (!p.media || !(p.media.images || p.media.docs || p.media.links)) { p.media = defaultMedia(p); changed = true; }
    if (p.fastClosePct == null) { p.fastClosePct = 2; changed = true; }
    if (p.fastCloseDays == null) { p.fastCloseDays = 5; changed = true; }
    if (!p.addons) { p.addons = []; changed = true; }
    // seed starter add-ons once (so an admin who clears them keeps them cleared)
    if (p.addons.length === 0 && !p._addonsSeeded) { p.addons = DEFAULT_ADDONS.map(a => ({ ...a })); p._addonsSeeded = true; changed = true; }
  });
  return changed;
}

// ── read ─────────────────────────────────────────────────────────────────────
export function listProjects() { return getProperties().map(toProject); }
export function getProjectById(id) { return toProject(getProperty(id)); }

// ── project CRUD ─────────────────────────────────────────────────────────────
export function createProject(data) { return addPropertyFn({ variants: [], addons: [], media: { images: [], docs: [], links: [] }, fastClosePct: 2, fastCloseDays: 5, ...data }); }
export function updateProject(id, patch) { updatePropertyFn(id, patch); }
export function removeProject(id) { deletePropertyFn(id); }

// ── variants ─────────────────────────────────────────────────────────────────
export function addVariant(id) {
  const p = getProjectById(id); if (!p) return null;
  const v = { id: 'v' + uid(), name: 'New type', beds: 0, baths: 0, size: 0, listRate: 0, floorRate: 0, unitPrefix: '', units: [] };
  updateProject(id, { variants: [...p.variants, v] });
  return v.id;
}
export function updateVariant(id, vid, patch) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, { variants: p.variants.map(v => (v.id === vid ? { ...v, ...patch } : v)) });
}
export function removeVariant(id, vid) {
  const p = getProjectById(id); if (!p) return;
  const left = p.variants.filter(v => v.id !== vid);
  updateProject(id, { variants: left.length ? left : p.variants }); // keep at least one
}
// Generate `count` units for a variant, preserving existing statuses by id.
export function regenUnits(id, vid, count) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, {
    variants: p.variants.map(v => {
      if (v.id !== vid) return v;
      const cur = new Map(v.units.map(u => [u.id, u]));
      const units = Array.from({ length: Math.max(0, count | 0) }, (_, i) => {
        const code = (v.unitPrefix || '') + (i + 1);
        return cur.get(code) || { id: code, status: 'available' };
      });
      return { ...v, units };
    }),
  });
}

// Set a unit's status (available|hold|sold); stamps holder/client. Mirrors to the
// flat `units` array too so legacy views + cloud (which stores units) stay in sync.
export function setUnitStatus(id, vid, unitId, status, { user, client, holdUntil, note } = {}) {
  const p = getProperty(id); if (!p) return;
  const variants = (p.variants && p.variants.length ? p.variants : defaultVariants(p)).map(v => {
    if (v.id !== vid) return v;
    return {
      ...v,
      units: v.units.map(u => {
        if (u.id !== unitId) return u;
        if (status === 'available') return { id: u.id, status: 'available' };
        return { id: u.id, status, heldBy: user?.id || null, heldByName: user?.name || '', clientId: client?.id || null, clientName: client?.name || '', holdUntil: holdUntil || null, note: note || '', at: nowISO() };
      }),
    };
  });
  const rev = (s) => (s === 'sold' ? 'sold' : s === 'hold' ? 'locked' : 'available');
  const byId = new Map();
  variants.forEach(v => v.units.forEach(u => byId.set(u.id, u)));
  const flat = (p.units && p.units.length ? p.units : unitsFromCodes(p.saleableUnits, p.totalUnits, [])).map(u => {
    const vu = byId.get(u.no);
    return vu ? { ...u, status: rev(vu.status), heldByName: vu.heldByName || '', clientName: vu.clientName || '', clientId: vu.clientId || null, holdUntil: vu.holdUntil || null, note: vu.note || '' } : u;
  });
  updateProject(id, { variants, units: flat });
}

// ── add-ons ──────────────────────────────────────────────────────────────────
export function addAddon(id) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, { addons: [...(p.addons || []), { id: 'ao' + uid(), name: 'Add-on', amount: 0, icon: 'add' }] });
}
export function updateAddon(id, aid, patch) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, { addons: (p.addons || []).map(a => (a.id === aid ? { ...a, ...patch } : a)) });
}
export function removeAddon(id, aid) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, { addons: (p.addons || []).filter(a => a.id !== aid) });
}

// ── media ────────────────────────────────────────────────────────────────────
export function addMedia(id, kind, item) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, { media: { ...p.media, [kind]: [...(p.media[kind] || []), item] } });
}
export function removeMedia(id, kind, index) {
  const p = getProjectById(id); if (!p) return;
  updateProject(id, { media: { ...p.media, [kind]: (p.media[kind] || []).filter((_, i) => i !== index) } });
}
