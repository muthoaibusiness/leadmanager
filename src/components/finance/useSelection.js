import { useState } from 'react';

// Row selection for a finance list. Ids that have left the list (deleted,
// filtered out by search) drop out of the selection, so bulk actions only
// ever touch rows the user can see.
export default function useSelection(rows) {
  const [picked, setPicked] = useState(() => new Set());
  const visible = new Set(rows.map(r => r.id));
  const selected = [...picked].filter(id => visible.has(id));
  const has = (id) => picked.has(id) && visible.has(id);
  const allOn = rows.length > 0 && selected.length === rows.length;
  return {
    selected, has, allOn,
    someOn: selected.length > 0 && !allOn,
    toggle: (id) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    toggleAll: () => setPicked(allOn ? new Set() : new Set(rows.map(r => r.id))),
    clear: () => setPicked(new Set()),
  };
}
