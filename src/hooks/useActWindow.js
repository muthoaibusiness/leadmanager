import { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { ensureActWindow } from '../lib/db.js';

// Activities are no longer in the boot snapshot (see ensureLeadActs / sbLoad).
// The lead detail panel pulls one lead's full history; every view that
// AGGREGATES activity instead — funnel stages, per-agent call and talk-time
// rollups, the activity feeds — calls this on mount to pull the recent window.
//
// ensureActWindow dedupes to one request per account, so calling it from every
// such view is free: whichever renders first pays, the rest await the same
// promise. Re-renders the caller once the rows land.
export default function useActWindow() {
  const { user, refreshDB } = useApp();
  useEffect(() => {
    let alive = true;
    ensureActWindow(user).then(changed => { if (alive && changed) refreshDB(); });
    return () => { alive = false; };
  }, [user, refreshDB]);
}
