import { useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { canSee } from '../../lib/constants.js';
import { capiCall } from '../../lib/metaCapi.js';
import MetaCapiPanel from '../metacapi/MetaCapiPanel.jsx';

// Admin › Meta CAPI. canSee only decides what is shown; the meta-capi Edge
// Function checks the user's role or grant on every call.
export default function MetaCapiView() {
  const { user, showToast } = useApp();
  // Stable across renders: the panel loads data in effects keyed on `api`.
  const api = useCallback((action, payload) => capiCall(user, action, payload), [user]);
  if (!canSee(user, 'metacapi')) return <div className="ea-count" style={{ padding: 18 }}>Only Management can use Meta CAPI.</div>;
  return <MetaCapiPanel api={api} showToast={showToast} />;
}
