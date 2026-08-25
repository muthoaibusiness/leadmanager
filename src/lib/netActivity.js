// A count of Supabase requests currently in flight, so one indicator can speak
// for the whole app.
//
// Why this exists: after moving leads and activities off the boot load, the app
// fetches constantly and in small pieces — a page of 15, eight KPI counts, one
// lead's timeline. Wiring a loading flag through every one of those call sites
// and into every view means an early return above hooks in components that have
// hooks below, which React does not allow. Counting requests at the transport
// instead gives an honest global signal with no component surgery.
//
// Local spinners (Spinner.jsx) still cover regions that have nothing to show
// yet; this covers everything else, including refreshes of content already on
// screen.

let inFlight = 0;
const subs = new Set();

const emit = () => subs.forEach(fn => { try { fn(inFlight); } catch { /* a bad subscriber must not break the app */ } });

export function begin() { inFlight++; emit(); }

export function end() {
  // Never go negative: a double-end would otherwise leave the counter stuck
  // below zero and the indicator dead for the rest of the session.
  inFlight = Math.max(0, inFlight - 1);
  emit();
}

export function active() { return inFlight; }

export function subscribe(fn) {
  subs.add(fn);
  fn(inFlight);
  return () => subs.delete(fn);
}
