import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { getProperties } from '../lib/db.js';

// Multi-select project-interest field — works like a search box: type to filter the
// project catalog, click a match (or Enter) to add it as a tag. Stored back as a
// comma-joined string in `propertyInterest` so the rest of the app stays unchanged.
export default function ProjectInterestPicker({ value, onChange, placeholder = 'Search projects to add…' }) {
  const tags = (value || '').split(',').map(s => s.trim()).filter(Boolean);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const projects = getProperties();

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const set = (arr) => onChange(arr.join(', '));
  const has = (n) => tags.some(t => t.toLowerCase() === n.trim().toLowerCase());
  const add = (n) => { const v = (n || '').trim(); if (!v || has(v)) { setQ(''); return; } set([...tags, v]); setQ(''); };
  const remove = (t) => set(tags.filter(x => x !== t));

  const ql = q.trim().toLowerCase();
  const matches = projects
    .filter(p => p.name && !has(p.name))
    .filter(p => !ql || (p.name + ' ' + (p.district || '') + ' ' + (p.area || '')).toLowerCase().includes(ql))
    .slice(0, 8);

  return (
    <div className="pip" ref={ref}>
      <div className={`pip-box${open ? ' open' : ''}`} onClick={() => { setOpen(true); }}>
        {tags.map(t => (
          <span key={t} className="pip-tag">
            {t}
            <button type="button" className="pip-x" onClick={(e) => { e.stopPropagation(); remove(t); }} title="Remove"><Mi>close</Mi></button>
          </span>
        ))}
        <input
          className="pip-input"
          value={q}
          placeholder={tags.length ? 'Add another…' : placeholder}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) add(matches[0].name); else if (q.trim()) add(q); }
            else if (e.key === 'Backspace' && !q && tags.length) remove(tags[tags.length - 1]);
          }}
        />
      </div>

      {open && (matches.length > 0 || ql) && (
        <div className="pip-menu">
          {matches.map(p => (
            <button type="button" key={p.id} className="pip-opt" onClick={() => add(p.name)}>
              <Mi>apartment</Mi>
              <span className="pip-opt-tx">
                <span className="pip-opt-n">{p.name}</span>
                {(p.area || p.district) && <span className="pip-opt-sub">{[p.area, p.district].filter(Boolean).join(' · ')}</span>}
              </span>
            </button>
          ))}
          {ql && !matches.some(p => p.name.toLowerCase() === ql) && (
            <button type="button" className="pip-opt pip-opt-add" onClick={() => add(q)}>
              <Mi>add</Mi><span>Add “{q.trim()}”</span>
            </button>
          )}
          {!matches.length && !ql && <div className="pip-empty">Type to search projects</div>}
        </div>
      )}
    </div>
  );
}
