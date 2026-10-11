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
