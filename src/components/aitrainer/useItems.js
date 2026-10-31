import { useCallback, useEffect, useState } from 'react';

// Loads every trainer item once and reloads after a change. Retiring asks for
// the required reason first.
export function useItems(api, showToast) {
  const [items, setItems] = useState(null);
  const reload = useCallback(() => api('items.list').then(setItems).catch(e => showToast(e.message, 'err')), [api, showToast]);
  useEffect(() => { reload(); }, [reload]);
  const retire = async (i) => {
    const reason = window.prompt('Why retire this item? (required)');
    if (!reason?.trim()) return;
    try { await api('items.retire', { ...i, revision: i.revision, reason }); reload(); }
    catch (e) { showToast(e.message, 'err'); }
  };
  return { items, reload, retire };
}
