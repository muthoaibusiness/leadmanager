import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { canSee } from '../../lib/constants.js';
import { bulkDeleteLeads } from '../../lib/db.js';
import { capiCall, canDeleteLeads } from '../../lib/metaCapi.js';
import MetaCapiPanel from '../metacapi/MetaCapiPanel.jsx';
import useIsPhone from '../../hooks/useIsPhone.js';
import BackButton from '../BackButton.jsx';
import RefreshButton from '../RefreshButton.jsx';

// Admin › Meta CAPI. canSee only decides what is shown; the meta-capi Edge
// Function checks the user's role or grant on every call.
//
// Delete reuses the CRM's own path (db.js bulkDeleteLeads: deletion log, local
// cache, then the cloud rows, as Prospects does) and its rule: Management or
// Master only. Other accounts never get the button.
export default function MetaCapiView() {
  const { user, showToast, refreshDB, setPageRefresh } = useApp();
  const phone = useIsPhone();
  const [busy, setBusy] = useState(false); // the phone header's Refresh spins while the panel loads
  // Stable across renders: the panel loads data in effects keyed on `api`.
  const api = useCallback((action, payload) => capiCall(user, action, payload), [user]);
  const onDelete = useCallback(async (ids) => { bulkDeleteLeads(ids, user); refreshDB(); }, [user, refreshDB]);
  // The header's Refresh button runs the panel's reload and spins while it loads.
  const run = useRef(null);
  const reload = useCallback(() => run.current?.(), []);
  const onBusy = useCallback((b) => { setBusy(b); setPageRefresh({ run: reload, busy: b }); }, [setPageRefresh, reload]);
  useEffect(() => () => setPageRefresh(null), [setPageRefresh]);
  if (!canSee(user, 'metacapi')) return <div className="ea-count" style={{ padding: 18 }}>Only Management can use Meta CAPI.</div>;
  return (
    <>
      {/* Phones: the Prospects header, as is (LeadsView): Back, the page
          name, Refresh at the end. The hero and header bar do not mount here
          (App.jsx OWN_PHONE_HEADER); the bottom bar stays. */}
      {phone && (
        <div className="fpv-ph lv-ph">
          <div className="fpv-ph-top">
            <BackButton />
            <h1>Meta CAPI</h1>
            <RefreshButton onClick={reload} busy={busy} label="Refresh Meta CAPI" />
          </div>
        </div>
      )}
      <MetaCapiPanel api={api} showToast={showToast} onDelete={canDeleteLeads(user) ? onDelete : undefined} refreshRef={run} onBusy={onBusy} />
    </>
  );
}
