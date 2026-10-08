// Puts the saved theme (default dark) on <html> as data-theme. main.jsx runs
// it before the first render, so the page never flashes the wrong theme. Kept
// out of ThemeToggle.jsx so that file exports only its component (Fast Refresh).
export function applyStoredTheme() {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = t;
  return t;
}
