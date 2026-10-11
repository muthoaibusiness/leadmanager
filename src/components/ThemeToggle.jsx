import Mi from './Mi.jsx';
import { useTheme, setTheme } from '../lib/theme.js';

// Dark/light theme switch: a round header icon button, first of the header's
// right-hand controls on wide screens (hidden on phones, where the account
// menu carries the switch). Flips the CSS-variable theme via data-theme on
// <html>; the value lives in lib/theme.js, shared with that menu item.
export default function ThemeToggle() {
  const isDark = useTheme() === 'dark';
  return (
    <button
      type="button"
      className="hd-ic thtog"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Mi aria-hidden="true">{isDark ? 'dark_mode' : 'light_mode'}</Mi>
    </button>
  );
}
