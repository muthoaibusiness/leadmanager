import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { canSee } from '../../lib/constants.js';
import { bulkDeleteLeads } from '../../lib/db.js';
import { capiCall, canDeleteLeads } from '../../lib/metaCapi.js';
import MetaCapiPanel from '../metacapi/MetaCapiPanel.jsx';

// Admin › Meta CAPI. canSee only decides what is shown; the meta-capi Edge
// Function checks the user's role or grant on every call.
//
// Delete reuses the CRM's own path (db.js bulkDeleteLeads: deletion log, local
// cache, then the cloud rows, as Prospects does) and its rule: Management or
// Master only. Other accounts never get the button.
export default function MetaCapiView() {
  const { user, showToast, refreshDB, setPageRefresh } = useApp();
  // Stable across renders: the panel loads data in effects keyed on `api`.
  const api = useCallback((action, payload) => capiCall(user, action, payload), [user]);
  const onDelete = useCallback(async (ids) => { bulkDeleteLeads(ids, user); refreshDB(); }, [user, refreshDB]);
  // The header's Refresh button runs the panel's reload and spins while it loads.
  const run = useRef(null);
  const reload = useCallback(() => run.current?.(), []);
  const onBusy = useCallback((busy) => setPageRefresh({ run: reload, busy }), [setPageRefresh, reload]);
  useEffect(() => () => setPageRefresh(null), [setPageRefresh]);
  if (!canSee(user, 'metacapi')) return <div className="ea-count" style={{ padding: 18 }}>Only Management can use Meta CAPI.</div>;
  return <MetaCapiPanel api={api} showToast={showToast} onDelete={canDeleteLeads(user) ? onDelete : undefined} refreshRef={run} onBusy={onBusy} />;
}
