import { useState, useEffect } from 'react';
import Mi from './Mi.jsx';

// Dark/light theme switch, docked at the header's right end (.thtog). Persists choice and flips the
// CSS-variable theme by setting data-theme on <html>. Adapted from the shadcn
// reference to this project's plain-JSX + CSS-variable stack (no Tailwind).

// `inert`: set while the mobile sidebar drawer is open, so Tab cannot reach it.
export default function ThemeToggle({ inert }) {
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
      inert={inert}
    >
      <span className="thtog-knob"><Mi>{isDark ? 'dark_mode' : 'light_mode'}</Mi></span>
    </button>
  );
}
