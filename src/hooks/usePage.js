import { useState } from 'react';

// A list shown `size` rows a page (the booking tables: 10). `reset`: a value (a search
// term) that sends the list back to its first page when it changes.
export default function usePage(list, reset = null, size = 10) {
  const [state, setState] = useState({ page: 0, reset });
  if (state.reset !== reset) setState({ page: 0, reset });
  const page = state.reset === reset ? state.page : 0;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(page, pages - 1);
  return {
    rows: list.slice(at * size, at * size + size),
    page: at, pages, size, total: list.length,
    go: (p) => setState({ page: Math.max(0, Math.min(pages - 1, p)), reset }),
  };
}
