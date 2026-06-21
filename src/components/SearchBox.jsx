import { useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';

export default function SearchBox({ placeholder = 'Search...', style }) {
  const { search, setSearch, searchRef: ctxRef } = useApp();
  const ref = useRef(null);

  // register this input as the active search target
  useEffect(() => {
    if (ctxRef) ctxRef.current = ref.current;
    return () => { if (ctxRef) ctxRef.current = null; };
  }, [ctxRef]);

  function onKeyDown(e) {
    if (e.key === 'Escape') { setSearch(''); ref.current?.blur(); }
  }

  return (
    <div className="sbox" style={style} onClick={() => ref.current?.focus()}>
      <Mi>search</Mi>
      <input
        ref={ref}
        placeholder={placeholder}
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {search && (
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', display: 'flex', padding: '0 2px' }}
          onClick={e => { e.stopPropagation(); setSearch(''); ref.current?.focus(); }}
        >
          <Mi>close</Mi>
        </button>
      )}
    </div>
  );
}
