import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Mi from '../Mi.jsx';

// A dropdown in the Booking look, used instead of the browser's own <select>
// list (which cannot be styled). The list opens in a portal under the button, so
// no scrolling card can clip it. Keys: Up / Down / Home / End move, Enter or
// Space picks, Esc closes. `options`: [{ value, label }].
export default function BkSelect({ value, onChange, options, label, className = '', align = 'left', prefix = '' }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null); // { top, left, width, up }
  const [hi, setHi] = useState(0);
  const btn = useRef(null);
  const list = useRef(null);
  const id = useId();
  const cur = options.find(o => String(o.value) === String(value));

  const openList = () => {
    const r = btn.current.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const want = Math.min(320, options.length * 40 + 12);
    setAt({ top: r.bottom + 6, bottom: window.innerHeight - r.top + 6, left: r.left, right: window.innerWidth - r.right, width: r.width, up: room < want && r.top > room });
    setHi(Math.max(0, options.findIndex(o => String(o.value) === String(value))));
    setOpen(true);
  };
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  const pick = (o) => { onChange(o.value); close(); };

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!list.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false); };
    const shut = (e) => { if (!list.current?.contains(e.target)) close(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true); };
  }, [open]);

  useEffect(() => { if (open) list.current?.querySelector('[data-hi="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, hi]);

  const key = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(options.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); }
    else if (e.key === 'End') { e.preventDefault(); setHi(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[hi]) pick(options[hi]); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <>
      <button ref={btn} type="button" className={`bks ${className}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        aria-controls={open ? id : undefined} onClick={() => (open ? close(false) : openList())} onKeyDown={key}>
        <span className="bks-v">{prefix && <i>{prefix}</i>}{cur ? cur.label : '—'}</span>
        <Mi>expand_more</Mi>
      </button>
      {open && at && createPortal(
        <div ref={list} id={id} role="listbox" aria-label={label} className="bk bks-pop"
          style={{ ...(at.up ? { bottom: at.bottom } : { top: at.top }), ...(align === 'right' ? { right: at.right } : { left: at.left }), minWidth: at.width }}>
          {options.map((o, i) => {
            const on = String(o.value) === String(value);
            return (
              <button key={String(o.value)} type="button" role="option" aria-selected={on} data-hi={i === hi}
                className={`bks-o${on ? ' on' : ''}${i === hi ? ' hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                <span>{o.label}</span>{on && <Mi>check</Mi>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
