// vite-node scripts/nav-back-menu.test.mjs
// The header's Back (useNavHistory): on a page opened from the menu drawer it
// reopens the drawer over that same page; on a page opened directly it goes
// to the previous page with the drawer shut.
import { Window } from 'happy-dom';

const w = new Window({ url: 'http://localhost/' });
for (const k of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'matchMedia']) {
  if (w[k]) Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'window', { value: w, configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const React = await import(`${R}/node_modules/react/index.js`);
const { createRoot } = await import(`${R}/node_modules/react-dom/client.js`);
const { default: useNavHistory } = await import(`${R}/src/hooks/useNavHistory.js`);
const { DEFAULT_SNAP } = await import(`${R}/src/lib/navHistory.js`);
const { act, useState, createElement } = React;

const ok = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); process.exitCode = 1; } else console.log('ok:', msg); };
const tick = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

// What AppContext gives the hook, cut down to the page and the drawer.
const user = { id: 'u1', role: 'MANAGEMENT' };
const boot = { snap: { ...DEFAULT_SNAP, view: 'dashboard' }, entry: { id: null, idx: 0, snap: { ...DEFAULT_SNAP, view: 'dashboard' }, local: {}, scroll: 0, prev: null }, reload: false };
const app = { drawerLayout: true }; // phones: the menu is the overlay drawer
function Harness() {
  const [view, setView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { back } = useNavHistory({
    boot, user, db: { users: [] },
    snap: { ...DEFAULT_SNAP, view },
    apply: (s) => { setView(s.view); setSidebarOpen(false); },
    closeAll: () => setSidebarOpen(false), closeNotif: () => {},
    openMenu: () => { if (app.drawerLayout) setSidebarOpen(true); return app.drawerLayout; },
    overlays: { modal: null, panLead: null, notifOpen: false, sidebarOpen },
  });
  // nav(): the page changes and the drawer shuts in one update, as AppContext.nav does.
  Object.assign(app, { view, sidebarOpen, back, setSidebarOpen, nav: (v) => { setView(v); setSidebarOpen(false); } });
  return null;
}

document.body.innerHTML = '<div id="root"></div>';
await act(async () => { createRoot(document.getElementById('root')).render(createElement(Harness)); });
await tick();
ok(app.view === 'dashboard' && app.back === null, 'home has no Back');

// From the menu drawer: Back reopens the drawer and the page stays.
await act(async () => { app.setSidebarOpen(true); });
await tick();
await act(async () => { app.nav('aitrainer'); });
await tick();
ok(app.view === 'aitrainer' && !app.sidebarOpen, 'a drawer item opens its page and shuts the drawer');
ok(app.back?.label === 'menu', 'Back is labelled for the menu');
await act(async () => { app.back.go(); });
await tick();
ok(app.view === 'aitrainer' && app.sidebarOpen, 'Back opens the menu drawer and stays on the current page');

// Another page picked from the reopened drawer.
await act(async () => { app.nav('leads'); });
await tick();
ok(app.view === 'leads' && !app.sidebarOpen && app.back?.label === 'menu', 'a second drawer item opens its page, and its Back is the menu too');

// Opened directly (no drawer): Back is the previous page, drawer shut.
await act(async () => { app.nav('metacapi'); });
await tick();
ok(app.view === 'metacapi' && app.back?.label === 'Prospects', 'a page opened directly is labelled with the previous page, not home');
await act(async () => { app.back.go(); });
await tick();
ok(app.view === 'leads' && !app.sidebarOpen, 'Back returns to the previous page with the drawer shut');

// The browser's own Back is a plain step back, drawer shut.
await act(async () => { window.history.back(); });
await tick();
ok(app.view === 'aitrainer' && !app.sidebarOpen, "the browser's Back goes to the previous page");
ok(app.back?.label === 'menu', 'a restored page keeps its menu Back');

// Where the drawer is not the layout (desktop), the menu Back is a step back.
app.drawerLayout = false;
await act(async () => { app.back.go(); });
await tick();
ok(app.view === 'dashboard' && !app.sidebarOpen, 'without a drawer, Back goes to the previous page');

console.log(process.exitCode ? 'nav-back-menu: FAILED' : 'nav-back-menu: ok');
process.exit(process.exitCode || 0);
