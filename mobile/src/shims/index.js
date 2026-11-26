// Must be the first import of the app: the shared web code reads these at module load.
import './storage';

// The realtime code defers its socket with requestIdleCallback where there is one.
if (typeof globalThis.requestIdleCallback !== 'function') {
  globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 0 }), 1);
  globalThis.cancelIdleCallback = (id) => clearTimeout(id);
}
