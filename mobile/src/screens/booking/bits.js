// Shared bits of the Booking screens (the phone version of the web Booking page,
// src/components/booking/). The data comes from the web's own src/lib files:
// projects.js, floorText.js (floors, shops, landmarks), floorPlan.js and shopDocs.js.
import { useEffect, useState } from 'react';
import { useApp } from '../../store';
import { loadShopDocs, libOf, brochureLink, PER_PROJECT, absUrl } from '../../../../src/lib/shopDocs.js';
import { byCode } from '../../../../src/lib/floorPlan.js';

// ShopBookingView sortPlans(): top floor first.
export const sortPlans = (plans) => [...plans].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || byCode(a.name || '', b.name || ''));

// A colour with an alpha, for a custom status fill ('#RRGGBB' + alpha 0–1).
export const withAlpha = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  return m ? `#${m[1]}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex;
};

// A unit tile's fill, outline and text, from the phone theme. The web's colours for the same
// states (ShopBooking.css .bk-cell.s-*): open = brand soft, held = gold, sold = faded and dashed,
// a project status (Landowner, Reserved…) = its own colour.
export function tileColors(t, shop) {
  const c = shop.look?.color;
  if (c) return { fill: withAlpha(c, shop.status === 'sold' ? 0.16 : 0.24), stroke: c, text: t.text, dash: false };
  if (shop.status === 'hold') return { fill: t.warnSoft, stroke: t.warn, text: t.text, dash: false };
  if (shop.status === 'sold') return { fill: t.line, stroke: t.mute, text: t.mute, dash: true };
  return { fill: t.brandSoft, stroke: t.brand, text: t.text, dash: false };
}

// The legend swatch for a base status.
export function swatch(t, status) {
  return status === 'hold' ? { bg: t.warnSoft, border: t.warn } : status === 'sold' ? { bg: t.line, border: t.mute } : { bg: t.brandSoft, border: t.brand };
}

// ShopGrid / ShopBookingView customStatuses(): the project's own statuses a floor uses, with counts.
export const customStatuses = (shops) => {
  const seen = new Map();
  shops.forEach((s) => {
    if (!s.look.color) return;
    const e = seen.get(s.look.label) || { label: s.look.label, color: s.look.color, n: 0 };
    e.n++; seen.set(s.look.label, e);
  });
  return [...seen.values()];
};

export const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// absUrl() resolves a link kept as a path on the web site against window.location, which the
// phone does not have; such a link is passed on as it is.
export const fullUrl = (u) => { try { return absUrl(u); } catch { return u; } };

// Copied from the web hook src/hooks/useShopDocs.js (web hooks cannot be imported here):
// the company's document library and one shop's send log (migration 0071), with the
// project's own floor plans and brochure link filling in where nothing was uploaded.
export function useShopDocs(propertyId, unitId, project) {
  const { user } = useApp();
  const cid = libOf(user?.companyId);
  const [st, setSt] = useState({ lib: {}, log: [], loaded: false, missing: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let dead = false;
    loadShopDocs(cid, propertyId, unitId).then((r) => { if (!dead) setSt(r); }).catch(() => { if (!dead) setSt({ lib: {}, log: [], loaded: true, missing: false }); });
    return () => { dead = true; };
  }, [cid, propertyId, unitId, tick]);
  const base = { ...st.lib };
  PER_PROJECT.forEach((k) => { base[k] = st.lib[`${k}@${propertyId}`]; });
  const plansDoc = (project?.media?.docs || []).find((d) => /floor\s*plans?/i.test(d.label || d.name || '') && d.url);
  const plans = (project?.floorPlans || []).filter((p) => p.image?.url).map((p) => ({ name: p.name, url: p.image.url, mime: p.image.mime || 'image/jpeg', order: p.order ?? 0 }));
  const lib = base.floorplans?.url ? base
    : plansDoc ? { ...base, floorplans: { ...base.floorplans, key: 'floorplans', approved: true, url: plansDoc.url, mime: 'application/pdf', name: plansDoc.label || plansDoc.name || 'Floor plans' } }
      : plans.length ? { ...base, floorplans: { ...base.floorplans, key: 'floorplans', approved: true, auto: true, plans: plans.sort((x, y) => y.order - x.order) } } : base;
  const link = brochureLink(project);
  const withBrochure = !lib.brochure?.url && link ? { ...lib, brochure: { ...lib.brochure, key: 'brochure', approved: true, auto: true, link } } : lib;
  return { ...st, lib: withBrochure, cid, reload: () => setTick((x) => x + 1) };
}

// Ten rows a page, with "Show more" (the web's usePage / Pager, as a growing list).
export function usePaged(rows, size = 10) {
  const [n, setN] = useState(size);
  return { rows: rows.slice(0, n), more: rows.length > n ? () => setN((x) => x + size) : null, left: Math.max(0, rows.length - n) };
}
