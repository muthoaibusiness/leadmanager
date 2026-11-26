import { useEffect, useState } from 'react';
import { countLeads, ensureLeadBook, ensureActWindow, leadBookReady } from '../../src/lib/db.js';
import { useApp } from './store';

// A batch of server-side counts: specs = { name: leadQueryOpts } -> { name: number | null }.
// null = not answered yet, or the request failed (show a placeholder, not a zero).
// Pass specs memoised; a new object every render would recount every render.
export function useLeadCounts(specs) {
  const { dbVersion } = useApp();
  const [counts, setCounts] = useState({});
  useEffect(() => {
    let alive = true;
    const names = Object.keys(specs || {});
    if (!names.length) return undefined;
    Promise.all(names.map((n) => countLeads(specs[n]).then((v) => [n, v]))).then((pairs) => {
      if (alive) setCounts(Object.fromEntries(pairs));
    });
    return () => { alive = false; };
  }, [specs, dbVersion]);
  return counts;
}

// The whole lead book, for screens that aggregate over it (pipeline, calendar,
// reports). Loaded once per account and shared; returns true when it is in.
export function useLeadBook(enabled = true) {
  const { user, refresh } = useApp();
  const [ready, setReady] = useState(() => leadBookReady());
  useEffect(() => {
    if (!enabled || !user) return undefined;
    let alive = true;
    ensureLeadBook(user).then(() => { if (alive) { setReady(true); refresh(); } });
    return () => { alive = false; };
  }, [enabled, user, refresh]);
  return ready;
}

// The recent-activity window (activities are not part of the boot load).
export function useActWindow() {
  const { user, refresh } = useApp();
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    Promise.resolve(ensureActWindow(user)).then((changed) => { if (alive && changed) refresh(); });
    return () => { alive = false; };
  }, [user, refresh]);
}

// Debounced copy of a value (search boxes).
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}
