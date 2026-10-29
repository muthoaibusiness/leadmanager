import { useState, useRef, useEffect, useId } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { canSee } from '../lib/constants.js';
import GlobalSearch from './GlobalSearch.jsx';

// Phones only (CSS hides both at 768px and up): the header's search and AI
// buttons, which sit with the date filter in one pill on the right.

// Search: opens the global search sheet (GlobalSearch.jsx) over the page.
export function HeaderSearch() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <>
      <button type="button" className={`hd-ic hd-srch${open ? ' open' : ''}`} onClick={() => setOpen(true)}
        aria-label="Search" title="Search" aria-haspopup="dialog" aria-expanded={open}>
        <Mi aria-hidden="true">search</Mi>
      </button>
      <GlobalSearch open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Four-point sparkle in the Gemini style: concave sides, blue → violet → rose.
function Sparkle() {
  const id = useId();
  return (
    <svg className="hd-ai-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset=".55" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`}
        d="M12 1.5C12.6 7 17 11.4 22.5 12C17 12.6 12.6 17 12 22.5C11.4 17 7 12.6 1.5 12C7 11.4 11.4 7 12 1.5Z" />
    </svg>
  );
}

// AI: a dropdown to the AI Trainer and the WhatsApp conversations, each under
// the same gate as its sidebar entry (AI Trainer by canSee, chat by the
// allow-list). Hidden when the account may open neither.
export function AiMenu() {
  const { user, view, nav, chatOk } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!user) return null;
  const items = [
    canSee(user, 'aitrainer') && { key: 'aitrainer', ico: 'smart_toy', lbl: 'AI Trainer' },
    chatOk && { key: 'conversations', ico: 'forum', lbl: 'Conversations' },
  ].filter(Boolean);
  if (!items.length) return null;

  // Escape with focus in the menu shuts just this menu and returns focus to
  // the button; stopping it keeps App's Escape order out (as BottomNav does).
  const onEsc = (e) => {
    if (e.key !== 'Escape' || !open || e.nativeEvent.isComposing) return;
    e.stopPropagation();
    setOpen(false);
    ref.current?.querySelector('.hd-ai')?.focus();
  };

  return (
    <div className="hd-ai-wrap" ref={ref} onKeyDown={onEsc}>
      <button type="button" className={`hd-ic hd-ai${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}
        aria-label="AI" title="AI" aria-haspopup="menu" aria-expanded={open}>
        <Sparkle />
      </button>
      {open && (
        <div className="umenu hd-ai-menu" role="menu">
          {items.map(it => (
            <button key={it.key} type="button" role="menuitem"
              className={`umenu-item${view === it.key ? ' on' : ''}`}
              onClick={() => { setOpen(false); nav(it.key); }}>
              <Mi aria-hidden="true">{it.ico}</Mi><span>{it.lbl}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
