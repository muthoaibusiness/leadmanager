// ── Projects data module (storefront model) ──────────────────────────────────
// Single source for the Project (Property) variant/storefront model:
//   Project { name, location, handover, listing, approval, fastClosePct,
//             fastCloseDays, media:{images,docs,links}, variants[], addons[] }
//   Variant { id, name, beds, baths, size, listRate, floorRate, unitPrefix, units[] }
//   Unit    { id, status: 'available'|'hold'|'sold', size?, price? }
//           size (sqft) and price (৳ total) are optional per-unit overrides —
//           shops on one floor share a type but not a size. Without them the
//           unit takes its type's size and list rate × size (unitSize/unitPrice).
//   AddOn   { id, name, amount, icon }
//   Media   { name?, label?, url }
//   FloorPlan { id, name, order, image: { url, width, height, mime, fileName,
//               source, pdfPage }, boxes: [{ id, unitId, x, y, w, h }],
//               updatedAt, updatedBy } — Projects → Available Units. A box
//               points at a unit by code; x/y/w/h are 0–1 fractions of the image.
//
// Backed today by the in-memory + localStorage + Supabase store (via db.js).
// Everything goes through this module, so swapping to a real API = change the
// bodies here only — the UI never touches the store directly.

import { getProperty, getProperties, addPropertyFn, updatePropertyFn, deletePropertyFn, insertPropertyChecked, updatePropertyChecked, patchPropertyChecked, unitsFromCodes } from './db.js';
import { sbGetPropertyRow, uploadProjectMedia } from './supabase.js';
import { uid } from './helpers.js';
import { PROJECT_TYPES } from './constants.js';

const nowISO = () => new Date().toISOString();

// A project's type (Residential / Commercial) is kept in the property's
// existing `purpose` column, so it needs no schema change. Anything else there
// (empty, or the old edit form's 'Sale') means none has been chosen yet.
export const projectTypeOf = (p) => (PROJECT_TYPES.includes(p?.purpose) ? p.purpose : null);
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
    floorPlans: Array.isArray(p.floorPlans) ? p.floorPlans : [],
  };
}

// ── units: per-unit size / price ─────────────────────────────────────────────
export const unitSize = (u, v) => (u?.size > 0 ? u.size : (v?.size || 0));
export const unitPrice = (u, v) => (u?.price > 0 ? u.price : (v?.listRate || 0) * unitSize(u, v));
// A unit on hold or sold is referenced by holds and deals by type + code, so
// its code and type must not change under them.
export const isUnitLocked = (u) => !!u && u.status !== 'available';

// The unit with this code anywhere in the project. Codes are unique project-wide.
export function findUnit(project, unitId) {
  for (const v of project?.variants || []) {
    const u = (v.units || []).find(x => x.id === unitId);
    if (u) return { variant: v, unit: u };
  }
  return null;
}

// The type as one unit sees it: its own size, and its own price expressed as a
// list rate, for the deal math and the console's price boxes.
export function pricedVariant(variant, unitId) {
  const u = variant?.units?.find(x => x.id === unitId);
  if (!u || !(u.size > 0 || u.price > 0)) return variant;
  const size = unitSize(u, variant);
  const listRate = u.price > 0 && size > 0 ? u.price / size : variant.listRate;
  return { ...variant, size, listRate };
}

// Codes of units that have a box on any of the project's floor plans.
export function placedUnitIds(project) {
  const ids = new Set();
  (project?.floorPlans || []).forEach(fp => (fp.boxes || []).forEach(b => { if (b.unitId) ids.add(b.unitId); }));
  return ids;
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
// Projects in Available Units order: those with floor plans first, then by name.
const nameOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function planProjects() {
  return listProjects().sort((a, b) => (b.floorPlans.length > 0) - (a.floorPlans.length > 0) || nameOrder.compare(a.name || '', b.name || ''));
}
export function getProjectById(id) { return toProject(getProperty(id)); }

// ── inventory summary (Projects list, its KPI strip, the page subtitle) ──────
// Counted from the blocks (variants) and their units — what the catalog edits
// and the project console sells from. The old flat fields (totalUnits,
// unitsAvailable, totalSft, pricePerSqft, status) are not kept up to date by
// the catalog; they only seed toProject()'s default block for legacy rows.
//   total / available / hold / sold   units by status
//   area                              Σ unit size (a unit's own, else its block's), in sqft
//   rateMin / rateMax, sizeMin / sizeMax   over blocks that have one, plus units
//            with their own size / price (else null)
//   status   SOLD_OUT when every unit is sold, FEW_LEFT at ≤ 20% left (at least
//            1), else AVAILABLE; an UPCOMING flag set on the project wins;
//            null when the project has no units yet
export function projectInventory(raw) {
  const p = toProject(raw);
  let total = 0, available = 0, hold = 0, sold = 0, area = 0;
  const rates = [], sizes = [];
  (p?.variants || []).forEach(v => {
    const units = v.units || [];
    total += units.length;
    units.forEach(u => {
      if (u.status === 'available') available++; else if (u.status === 'sold') sold++; else hold++;
      area += unitSize(u, v);
      if (u.size > 0) sizes.push(u.size);
      if (u.price > 0 && unitSize(u, v) > 0) rates.push(Math.round(u.price / unitSize(u, v)));
    });
    if (v.size > 0) sizes.push(v.size);
    if (v.listRate > 0) rates.push(v.listRate);
  });
  const status = p?.status === 'UPCOMING' ? 'UPCOMING'
    : !total ? null
    : sold === total ? 'SOLD_OUT'
    : available <= Math.max(1, Math.floor(total * 0.2)) ? 'FEW_LEFT'
    : 'AVAILABLE';
  const span = (xs) => (xs.length ? [Math.min(...xs), Math.max(...xs)] : [null, null]);
  const [rateMin, rateMax] = span(rates);
  const [sizeMin, sizeMax] = span(sizes);
  return { total, available, hold, sold, area, rateMin, rateMax, sizeMin, sizeMax, status };
}

// ── project CRUD ─────────────────────────────────────────────────────────────
export function createProject(data) { return addPropertyFn({ variants: [], addons: [], media: { images: [], docs: [], links: [] }, fastClosePct: 2, fastCloseDays: 5, ...data }); }
export function updateProject(id, patch) { updatePropertyFn(id, patch); }
export function removeProject(id) { deletePropertyFn(id); }

// Add Property starts from a draft that only the editor holds — nothing reaches
// the store or the cloud until the first successful save. Same starting shape
// createProject stores.
export function newProjectDraft(companyId) {
  return { id: 'p' + uid(), name: '', companyId: companyId || null, variants: [], addons: [], media: { images: [], docs: [], links: [] }, fastClosePct: 2, fastCloseDays: 5 };
}

// The catalog editor's saves. They wait for the cloud and resolve to
// { ok, id } or { ok: false, error }, so a failed save can keep the draft open.
export function saveNewProject(draft) { return insertPropertyChecked(draft); }
export function saveProject(id, patch) { return updatePropertyChecked(id, patch); }

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
  const base = p.variants && p.variants.length ? p.variants : defaultVariants(p);
  // The type the unit is in now. A hold request names the type it was made
  // under; the floor plan editor can move an available unit to another type
  // since, so fall back to finding the code (unique in the project).
  const has = (v) => (v.units || []).some(u => u.id === unitId);
  const target = (base.find(v => v.id === vid && has(v)) || base.find(has) || {}).id;
  const variants = base.map(v => {
    if (v.id !== target) return v;
    return {
      ...v,
      units: v.units.map(u => {
        if (u.id !== unitId) return u;
        // A unit's own size and price (set on the floor plan) outlive its status.
        const own = { ...(u.size > 0 ? { size: u.size } : {}), ...(u.price > 0 ? { price: u.price } : {}) };
        if (status === 'available') return { id: u.id, status: 'available', ...own };
        return { id: u.id, status, ...own, heldBy: user?.id || null, heldByName: user?.name || '', clientId: client?.id || null, clientName: client?.name || '', holdUntil: holdUntil || null, note: note || '', at: nowISO() };
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

// ── floor plans (Projects → Available Units) ─────────────────────────────────
const round4 = (n) => Math.round(n * 10000) / 10000;
const IMG_EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const newTypeShape = (id, name) => ({ id, name, beds: 0, baths: 0, size: 0, listRate: 0, floorRate: 0, unitPrefix: '', units: [] });

// The editor's save. It never writes from the editor's own copy of the project:
// the row is fetched fresh, the plan and the unit changes are merged onto it,
// and only floor_plans + variants are written back, so a hold or a sale placed
// while the editor was open survives.
//
//   plan     { id, name, order, image (stored image or null), boxes: [{ id, unitKey, x, y, w, h }] }
//   pending  { blob, width, height, mime, fileName, source, pdfPage } — a new image to upload, or null
//   units    { [unitKey]: { code, variantId, size, price, orig: { code } | null } }
//   types    [{ id, name, isNew }] — the editor's list, new ones included
//
// Resolves { ok, plan, skipped, recreated } or { ok: false, error }.
// `skipped`: units whose rename / type change was not applied because the unit
// went on hold or was sold meanwhile. `recreated`: units deleted meanwhile.
export async function saveFloorPlan({ projectId, companyId, plan, pending, units, types, user }) {
  let image = plan.image;
  if (pending) {
    const ext = IMG_EXT[pending.blob.type] || 'jpg';
    const path = `${companyId || 'company'}/${projectId}/plans/${plan.id}-${Date.now()}.${ext}`;
    const up = await uploadProjectMedia(pending.blob, path);
    if (!up.ok) return { ok: false, error: up.error };
    image = { url: up.url, width: pending.width, height: pending.height, mime: pending.blob.type,
      fileName: pending.fileName || '', source: pending.source || 'image', pdfPage: pending.pdfPage || null };
  }
  if (!image?.url) return { ok: false, error: 'the plan has no image' };

  const got = await sbGetPropertyRow(projectId);
  if (!got.ok) return { ok: false, error: got.error };
  if (!got.row) return { ok: false, error: 'this project no longer exists' };
  const p = toProject(got.row);
  const variants = p.variants.map(v => ({ ...v, units: (v.units || []).map(u => ({ ...u })) }));
  const proj = { ...p, variants };

  const typeOf = (vid) => {
    let v = variants.find(x => x.id === vid);
    if (v) return v;
    const t = (types || []).find(x => x.id === vid);
    if (!t || !t.isNew) return null;
    v = newTypeShape(t.id, t.name || 'New type');
    variants.push(v);
    return v;
  };
  const setDetails = (u, d) => {
    if (d.size > 0) u.size = d.size; else delete u.size;
    if (d.price > 0) u.price = d.price; else delete u.price;
  };

  const skipped = [], recreated = [];
  const finalCode = {};
  if (plan.boxes.some(b => !b.unitKey)) return { ok: false, error: 'a box is not linked to a unit' };
  const usedKeys = [...new Set(plan.boxes.map(b => b.unitKey).filter(Boolean))];
  // First decide what happens to each unit, then check the codes as they will
  // all end up (so a swap A↔B, or A→B plus a new A, is fine), then apply.
  const steps = [];
  for (const key of usedKeys) {
    const d = units[key];
    if (!d || !d.code) return { ok: false, error: 'a box is not linked to a unit' };
    const target = typeOf(d.variantId);
    if (!target) return { ok: false, error: `the type for ${d.code} was removed from this project` };
    const loc = d.orig ? findUnit(proj, d.orig.code) : null;
    if (loc) {
      setDetails(loc.unit, d);
      const moving = d.code !== d.orig.code || target.id !== loc.variant.id;
      if (moving && isUnitLocked(loc.unit)) { skipped.push(d.orig.code); finalCode[key] = d.orig.code; continue; }
      steps.push(moving ? { key, kind: 'move', loc, target, code: d.code } : { key, kind: 'stay', code: d.code });
    } else {
      const u = { id: d.code, status: 'available' };
      setDetails(u, d);
      if (d.orig) recreated.push(d.code);
      steps.push({ key, kind: 'new', unit: u, target, code: d.code });
    }
  }
  const leaving = new Set(steps.filter(s => s.kind === 'move').map(s => s.loc.unit.id));
  const taken = new Set(variants.flatMap(v => v.units.map(u => u.id)).filter(c => !leaving.has(c)));
  for (const s of steps) {
    if (s.kind === 'stay') continue;
    if (taken.has(s.code)) {
      return { ok: false, error: s.kind === 'new' && !recreated.includes(s.code)
        ? `${s.code} was just added by someone else — pick another name`
        : `${s.code} is already used by another unit` };
    }
    taken.add(s.code);
  }
  for (const s of steps) {
    finalCode[s.key] = s.code;
    if (s.kind === 'new') { s.target.units = [...s.target.units, s.unit]; continue; }
    if (s.kind !== 'move') continue;
    const { loc, target } = s;
    const moved = { ...loc.unit, id: s.code };
    if (target === loc.variant) loc.variant.units = loc.variant.units.map(u => (u === loc.unit ? moved : u));
    else { loc.variant.units = loc.variant.units.filter(u => u !== loc.unit); target.units = [...target.units, moved]; }
  }

  const boxes = plan.boxes.map(b => ({ id: b.id, unitId: finalCode[b.unitKey], x: round4(b.x), y: round4(b.y), w: round4(b.w), h: round4(b.h) }));
  const mine = new Set(boxes.map(b => b.unitId));
  const clash = p.floorPlans.filter(fp => fp.id !== plan.id).flatMap(fp => fp.boxes || []).find(b => mine.has(b.unitId));
  if (clash) return { ok: false, error: `${clash.unitId} is already on another floor plan` };

  const saved = {
    id: plan.id, name: (plan.name || '').trim() || 'Floor plan', order: Number(plan.order) || 0,
    image, boxes, updatedAt: nowISO(), updatedBy: user?.id || null,
  };
  const exists = p.floorPlans.some(fp => fp.id === plan.id);
  const floorPlans = exists ? p.floorPlans.map(fp => (fp.id === plan.id ? saved : fp)) : [...p.floorPlans, saved];
  const res = await patchPropertyChecked(projectId, { floorPlans, variants });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, plan: saved, skipped, recreated };
}

// Removes the plan only. Its units stay in the inventory, and its image stays
// in Storage (the anon key cannot delete files).
export async function deleteFloorPlan(projectId, planId) {
  const got = await sbGetPropertyRow(projectId);
  if (!got.ok) return { ok: false, error: got.error };
  if (!got.row) return { ok: false, error: 'this project no longer exists' };
  const plans = toProject(got.row).floorPlans;
  return patchPropertyChecked(projectId, { floorPlans: plans.filter(fp => fp.id !== planId) });
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
