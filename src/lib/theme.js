import { useSyncExternalStore } from 'react';

// Puts the saved theme (default dark) on <html> as data-theme. main.jsx runs
// it before the first render, so the page never flashes the wrong theme. Kept
// out of ThemeToggle.jsx so that file exports only its component (Fast Refresh).
export function applyStoredTheme() {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = t;
  return t;
}

// One shared theme value: the header's theme button (wide screens) and the
// account menu's theme item (phones) both read and flip it, so they never
// disagree about which theme is on.
const subs = new Set();
const read = () => document.documentElement.dataset.theme || 'dark';

export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('theme', t);
  subs.forEach(f => f());
}

export function useTheme() {
  return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, read);
}

// ── Design ────────────────────────────────────────────────────────────────────────────────────────
// The second axis beside dark/light: which visual design the app wears. "classic" is the look in
// theme.css and sets no attribute; every other design is <html data-design="…">, styled by
// src/designs.css on top of theme.css. An admin picks it (components/DesignPicker.jsx); the choice
// is cached in localStorage so the first paint already wears it, and stored per company in
// companies.ui_design (migration 0073) so every account of the company gets the same design.
export const DESIGNS = [
  { id: 'classic', name: 'Classic', note: 'The original look. Deep green, rounded cards.' },
  { id: 'blueprint', name: 'Blueprint', note: 'A drafting sheet. Square corners, fine blue lines, a drawing grid.' },
  { id: 'pebble', name: 'Pebble', note: 'Soft and borderless. Round controls on calm, tinted surfaces.' },
  { id: 'ink', name: 'Ink', note: 'Black on white. Solid outlines and a marker-yellow highlight.' },
];
const DESIGN_IDS = DESIGNS.map(d => d.id);
export const isDesign = (id) => DESIGN_IDS.includes(id);

// Each design's own typefaces, fetched only when that design is on. Hind Siliguri (loaded in
// index.html) stays last in every stack for Bangla text.
const DESIGN_FONTS = {
  blueprint: 'family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500',
  pebble: 'family=Figtree:wght@400;500;600;700',
  ink: 'family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600',
};
function loadDesignFonts(id) {
  const q = DESIGN_FONTS[id];
  if (!q || document.getElementById('design-font-' + id)) return;
  const l = document.createElement('link');
  l.id = 'design-font-' + id; l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?${q}&display=swap`;
  document.head.appendChild(l);
}

const designSubs = new Set();
const readDesign = () => document.documentElement.dataset.design || 'classic';

function putDesign(id) {
  const el = document.documentElement;
  if (id === 'classic') delete el.dataset.design; else { el.dataset.design = id; loadDesignFonts(id); }
}

// Before first paint (main.jsx), like applyStoredTheme.
export function applyStoredDesign() {
  const saved = localStorage.getItem('design');
  const id = isDesign(saved) ? saved : 'classic';
  putDesign(id);
  return id;
}

export function setDesign(id) {
  if (!isDesign(id)) return;
  putDesign(id);
  localStorage.setItem('design', id);
  designSubs.forEach(f => f());
}

export function useDesign() {
  return useSyncExternalStore(cb => { designSubs.add(cb); return () => designSubs.delete(cb); }, readDesign);
}

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────
// The third switch: how the app is laid out. "sidebar" is the original shell and sets no attribute;
// the others are <html data-layout="…">, built by src/layouts.css from the same markup: where the
// navigation sits, how a page is headed, how lists and the lead record are presented. It is
// independent of the design (colours and shapes) and of dark/light, and is stored the same way as
// the design (localStorage for first paint, companies.ui_layout for the company).
export const LAYOUTS = [
  { id: 'sidebar', name: 'Sidebar', note: 'The original layout. Navigation down the left, a lead opens in a side panel.' },
  { id: 'rail', name: 'Rail', note: 'A slim icon rail that opens on hover. Compact toolbars, dense lists, a lead opens as an inspector.' },
  { id: 'topbar', name: 'Topbar', note: 'Navigation as tabs across the top. A header band on each page, a lead opens as a full record.' },
  { id: 'dock', name: 'Dock', note: 'A floating dock at the bottom. A bento Home, lists as row cards, a lead rises as a sheet.' },
];
const LAYOUT_IDS = LAYOUTS.map(l => l.id);
export const isLayout = (id) => LAYOUT_IDS.includes(id);

const layoutSubs = new Set();
const readLayout = () => document.documentElement.dataset.layout || 'sidebar';
function putLayout(id) {
  const el = document.documentElement;
  if (id === 'sidebar') delete el.dataset.layout; else el.dataset.layout = id;
}
export function applyStoredLayout() {
  const saved = localStorage.getItem('layout');
  const id = isLayout(saved) ? saved : 'sidebar';
  putLayout(id);
  return id;
}
export function setLayout(id) {
  if (!isLayout(id)) return;
  putLayout(id);
  localStorage.setItem('layout', id);
  layoutSubs.forEach(f => f());
}
export function useLayout() {
  return useSyncExternalStore(cb => { layoutSubs.add(cb); return () => layoutSubs.delete(cb); }, readLayout);
}
