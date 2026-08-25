import { useEffect, useState } from 'react';
import { countLeads } from '../lib/db.js';
import { useApp } from '../context/AppContext.jsx';

// KPI cards show a NUMBER, not a list — so they cost a count query, not a lead
// download. This runs a batch of them in parallel and hands back
// { name: number|null }, where null means "not answered yet or the request
// failed" so a card can show a placeholder instead of a confident wrong zero.
//
// `specs` is { name: leadQueryOpts }. Pass it memoised (useMemo) — a fresh
// object every render would refetch every render. `deps` is anything outside
// the specs that should retrigger the batch, typically dbVersion.
export default function useLeadCounts(specs, deps = []) {
  const { dbVersion } = useApp();
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let alive = true;
    const names = Object.keys(specs || {});
    if (!names.length) return;
    Promise.all(names.map(n => countLeads(specs[n]).then(v => [n, v]))).then(pairs => {
      if (!alive) return;
      setCounts(Object.fromEntries(pairs));
    });
    return () => { alive = false; };
    // specs is memoised by the caller; dbVersion re-counts after any local write.
  }, [specs, dbVersion, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return counts;
}
