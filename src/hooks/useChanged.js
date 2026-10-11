import { useState } from 'react';

const UNSET = {};

// True on the render in which `key` differs from the one before, including the
// first render. This is React's "adjust state when a prop changes" pattern:
// a component resets its own state during render instead of in an effect, so
// the stale values never reach the screen and no second commit follows.
//
// Most modals stay mounted while closed, so "the modal just opened" is the
// usual key: `if (useChanged(isOpen) && isOpen) setReason('')`. Fold anything
// else the reset depends on into the key (`isOpen && leadId`). The key must be
// a primitive: a fresh object or array differs every render and never settles.
export default function useChanged(key) {
  const [prev, setPrev] = useState(UNSET);
  if (Object.is(prev, key)) return false;
  setPrev(key);
  return true;
}
