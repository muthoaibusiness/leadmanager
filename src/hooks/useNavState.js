import { useState, useEffect } from 'react';
import { navLocal } from './useNavHistory.js';

// useState for a page's own tabs and filters that should survive leaving the
// page and coming Back (or a reload): the value is kept in the current browser
// history entry (see useNavHistory). Opening the page anew from the sidebar
// starts a new entry, so it starts from `init` as before.
// `key` must be unique across the app ('leads.page'); values must be
// structured-cloneable (primitives, plain objects, arrays, Dates).
export default function useNavState(key, init) {
  const [value, setValue] = useState(() => (navLocal.has(key) ? navLocal.get(key) : typeof init === 'function' ? init() : init));
  useEffect(() => { navLocal.set(key, value); }, [key, value]);
  return [value, setValue];
}
