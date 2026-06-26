import { useState, useEffect } from 'react';
import Mi from './Mi.jsx';

// Floating dark/light theme switch (bottom-right). Persists choice and flips the
// CSS-variable theme by setting data-theme on <html>. Adapted from the shadcn
// reference to this project's plain-JSX + CSS-variable stack (no Tailwind).
export function applyStoredTheme() {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = t;
  return t;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const isDark = theme === 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button
      className={`thtog${isDark ? '' : ' light'}`}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      <span className="thtog-knob"><Mi>{isDark ? 'dark_mode' : 'light_mode'}</Mi></span>
    </button>
  );
}
