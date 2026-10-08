import { useSyncExternalStore } from 'react';

// The wall clock as an external store, so a render that needs "now" reads a
// value React tracks instead of calling Date.now() (which the hooks lint rules
// reject as impure: two renders would disagree). One timer per interval,
// shared by every subscriber and stopped when the last one goes.
const clocks = new Map();

function clockFor(ms) {
  let c = clocks.get(ms);
  if (c) return c;
  const subs = new Set();
  let timer = null;
  c = {
    now: Date.now(),
    read: () => c.now,
    subscribe: (onTick) => {
      subs.add(onTick);
      if (!timer) {
        // The first subscriber may follow a long idle spell; start fresh.
        c.now = Date.now();
        onTick();
        timer = setInterval(() => { c.now = Date.now(); subs.forEach(f => f()); }, ms);
      }
      return () => {
        subs.delete(onTick);
        if (!subs.size) { clearInterval(timer); timer = null; }
      };
    },
  };
  clocks.set(ms, c);
  return c;
}

const idle = () => () => {};

// Milliseconds since the epoch, refreshed every `ms` while `active`. When
// inactive the value is frozen at the last tick.
export default function useNow(ms, active = true) {
  const c = clockFor(ms);
  return useSyncExternalStore(active ? c.subscribe : idle, c.read);
}
