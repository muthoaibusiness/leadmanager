import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { ensureLeadBook, leadBookReady } from '../lib/db.js';

// Leads are no longer in the boot snapshot (see the leads note in sbLoad).
// Lists page through them and KPI cards count them server-side, so neither
// needs the whole book — but the views that AGGREGATE over every lead do: the
// pipeline board, reports, the calendar, agent performance, the team and
// profile roll-ups.
//
// Those views call this on mount. ensureLeadBook dedupes to one request per
// account, so whichever view renders first pays and the rest await it.
//
// Returns `ready` — false while the first load is still in flight. Use it to
// render a loading state: with an empty cache these views would otherwise show
// a confident "0 leads" that is really "not fetched yet".
// `enabled` lets a dashboard hold the download back while it waits to learn
// whether the server-side rollups (migration 0011) are available. Pass false
// and nothing is fetched; flip it to true and the book loads as before. Callers
// with no rollup path simply omit it.
export default function useLeadBook(enabled = true) {
  const { user, refreshDB } = useApp();
  const [ready, setReady] = useState(leadBookReady);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    ensureLeadBook(user).then(changed => {
      if (!alive) return;
      setReady(true);
      if (changed) refreshDB();
    });
    return () => { alive = false; };
  }, [enabled, user, refreshDB]);
  return ready;
}
