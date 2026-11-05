import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import AvailableUnitsView from '../src/components/project/AvailableUnitsView.jsx';
import { Ctx } from './appContextStub.jsx';

// Preview host for Available Units with a real project seeded in main HTML.
function Host() {
  const [planSel, setPlanSel] = useState({ projectId: null, planId: new URLSearchParams(location.search).get('floor') });
  const [ver, setVer] = useState(0);
  // preview: the grid's bottom edge vs the scroller's (data-gap on <body>; <0 means cut off)
  React.useEffect(() => { const t = setInterval(() => { const g = document.querySelector('.fpv-grid'), sc = document.querySelector('.pg-body'), c = document.querySelector('.fpv-side > .fpv-card'); if (g && sc) document.body.setAttribute('data-gap', String(Math.round(sc.getBoundingClientRect().bottom - g.getBoundingClientRect().bottom))); if (c) document.body.setAttribute('data-card', String(c.scrollHeight - c.clientHeight)); }, 400); return () => clearInterval(t); }, []);
  // ?unit=CODE: pick that unit once mounted (clicks its box on the plan).
  React.useEffect(() => { const c = new URLSearchParams(location.search).get('unit'); if (!c) return; const hov = new URLSearchParams(location.search).get('hover'); if (hov) { const th = setInterval(() => { const g = [...document.querySelectorAll('[data-box]')].find(x => (x.getAttribute('aria-label') || '').startsWith(hov + ',')); if (g) { g.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); clearInterval(th); } }, 200); }
    const t = setInterval(() => { const el = [...document.querySelectorAll('[data-box]')].find(g => (g.getAttribute('aria-label') || '').startsWith(c + ',')); if (el) { const n = Number(new URLSearchParams(location.search).get('times') || 1); for (let i = 0; i < n; i++) setTimeout(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), i * 600); clearInterval(t); } }, 200); return () => clearInterval(t); }, []);
  const user = JSON.parse(localStorage.getItem('propcrm_v2')).users[0];
  const noop = () => {};
  const value = {
    user, dbVersion: ver, refreshDB: () => setVer(v => v + 1), planSel, setPlanSel,
    setPlanEdit: noop, openModal: noop, setPropSel: noop, setConsoleAdmin: noop, setConsoleUnit: noop,
    setPanLead: noop, setPropDraft: noop, setProjTab: noop,
  };
  return <Ctx.Provider value={value}><div id="app"><div className="page" style={{ marginLeft: 0 }}>
      {/* the app's header (72px) and Projects hero, so the screen-fit sees the real room */}
      <header style={{ height: 72, flex: 'none' }} />
      <main className="pg-body"><div className="pg-inner">
        <div style={{ height: 70 }}><h1 style={{ margin: 0, fontSize: 28 }}>AVAILABLE UNITS</h1><p style={{ margin: 0 }}>335 units available</p></div>
        <AvailableUnitsView />
      </div></main>
    </div></div></Ctx.Provider>;
}
createRoot(document.getElementById('root')).render(<Host />);
