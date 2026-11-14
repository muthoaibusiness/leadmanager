import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/components/project/AvailableUnitsTab.css'; // the phone --bnav override, as App.jsx loads it
import AvailableUnitsView from '../src/components/project/AvailableUnitsView.jsx';
import PropertiesView from '../src/components/views/PropertiesView.jsx'; // ?view=list: the Projects list instead
import RefreshButton from '../src/components/RefreshButton.jsx'; // ?view=leads: the Prospects phone header only (hx-leads; LeadsView itself needs the network)
import Mi from '../src/components/Mi.jsx';
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
    user, leadCounts: { total: 1 }, dbVersion: ver, refreshDB: () => setVer(v => v + 1), planSel, setPlanSel,
    setPlanEdit: noop, openModal: noop, setPropSel: noop, setConsoleAdmin: noop, setConsoleUnit: noop,
    setPanLead: noop, setPropDraft: noop, setProjTab: noop, nav: noop,
  };
  const list = new URLSearchParams(location.search).get('view') === 'list';
  const leads = new URLSearchParams(location.search).get('view') === 'leads';
  // ?view=home: the phone Home header bar markup (App.jsx PageHeader order), static stubs for the measure (hx-home)
  const home = new URLSearchParams(location.search).get('view') === 'home';
  // ?view=sub: a phone sub-page header (Team: Back, title, the hero's Add Agent as an icon) (hx-sub)
  const sub = new URLSearchParams(location.search).get('view') === 'sub';
  // ?view=capi: the Meta CAPI phone header: its action is the Refresh ring (hx-capi)
  const capi = new URLSearchParams(location.search).get('view') === 'capi';
  const capiHead = <header className="pg-head pg-head-sub"><h1 className="hd-ttl">Meta CAPI</h1><div className="hd-acts"><RefreshButton label="Refresh Meta CAPI" busy={false} onClick={() => {}} /></div><button className="ham">m</button><button className="hd-back" aria-label="Back"><Mi className="hd-back-arrow">arrow_back</Mi><Mi className="hd-back-chev">chevron_left</Mi></button><nav className="hd-crumb">crumb</nav><button className="hd-ic thtog">t</button><div className="hd-grp"><button className="hd-ic notif-btn"><Mi>notifications</Mi></button><div className="hd-um"><button className="ag-av" /></div></div></header>;
  const subHead = <div className="fpv-ph lv-ph"><div className="fpv-ph-top"><button type="button" className="hd-back" aria-label="Back to home"><Mi aria-hidden="true" className="hd-back-chev">chevron_left</Mi></button><h1>My Team</h1><div className="hd-acts" id="hd-acts"><button className="btn btn-p"><Mi>person_add</Mi>Add Agent</button></div></div></div>;
  const homeHead = <header className="pg-head"><button className="ham" aria-label="Show sidebar"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5.4" width="18" height="13.2" rx="3" /><path d="M9 5.4v13.2" /></svg><svg className="ham-bars" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 7h10M4 12h16M4 17h10" /></svg></button><button className="hd-back">b</button><nav className="hd-crumb">crumb</nav><button className="hd-ic thtog">t</button><div className="hd-grp"><button className="hd-ic hd-srch"><Mi>search</Mi></button><div className="hd-ai-wrap"><button className="hd-ic hd-ai"><svg className="hd-ai-ico" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="8" fill="currentColor" /></svg></button></div><div className="drp-wrap"><button className="hd-ic drp-trigger"><Mi>date_range</Mi></button></div><button className="hd-ic notif-btn"><Mi>notifications</Mi></button>{new URLSearchParams(location.search).get('pop') === 'notif' && <div className="notif-panel on"><div className="np-hd"><div><div className="np-ttl">Notifications</div><div className="np-sub">2 unread</div></div><button className="btn btn-g btn-sm">Mark all read</button></div><div className="np-body">{[1,2,3].map(i => <div key={i} className={'ni' + (i < 3 ? ' unread' : '')}><div className="ni-ico" style={{ background: '#9CA3AF' }}><Mi>event</Mi></div><div className="ni-bd"><div className="ni-msg">Site visit with Karim at 4 pm</div><div className="ni-sub">{i}h ago</div></div>{i < 3 && <div className="ni-dot" />}</div>)}</div></div>} {/* hx-popups */}<div className="hd-um open"><button className="ag-av" aria-label="account" style={{ background: '#888', borderRadius: '50%', border: 0 }} />{new URLSearchParams(location.search).get('pop') === 'user' && <div className="umenu"><div className="um-me"><span className="umenu-av" style={{ width: 28, height: 28, borderRadius: '50%', background: '#888', display: 'inline-block' }} /><span className="umenu-itx"><span className="umenu-in">Noah Rahman</span><span className="umenu-ir">Management</span></span></div><div className="umenu-div" /><button className="umenu-item umenu-theme"><Mi>dark_mode</Mi><span>Dark mode</span></button><button className="umenu-item"><Mi>person</Mi><span>Profile</span></button><button className="umenu-item umenu-danger"><Mi>logout</Mi><span>Sign out</span></button></div>}<span className="hd-um-txt"><span className="hd-um-nm">Noah</span><span className="hd-um-rl">Agent</span></span><Mi className="hd-um-chev">expand_more</Mi></div></div></header>;
  const leadsHead = <><div className="fpv-ph lv-ph"><div className="fpv-ph-top"><button type="button" className="hd-back" aria-label="Back to home"><Mi aria-hidden="true" className="hd-back-chev">chevron_left</Mi></button><h1>Prospects</h1><RefreshButton /></div></div><div className="lv-tabs" role="tablist"><button className="asw-btn asw-md asw-primary" role="tab">My Leads</button><button className="asw-btn asw-md asw-secondary" role="tab">Forwarded (3)</button><button type="button" className="lv-act"><Mi>upload</Mi>Import</button><button type="button" className="lv-act lv-act-p"><Mi>person_add</Mi>Add</button></div><div className="fbar"><div className="sbox">search stub</div></div><div className="bnav" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 56 }}>bottom bar stub (hx-leads-acts)</div></>;
  return <Ctx.Provider value={value}><div id="app" className={home || sub || capi ? undefined : 'is-projects'}><div className="page" style={{ marginLeft: 0 }}>
      {/* the app's header (72px) and Projects hero, so the screen-fit sees the real room;
          on phones the app hides both for this page (AvailableUnitsTab.css), so the harness does too */}
      <style>{'@media (max-width: 767px) { .hx-chrome { display: none } }'}</style>
      {sub ? subHead : home ? homeHead : capi ? null : <header className="hx-chrome" style={{ height: 72, flex: 'none' }} />}
      <main className="pg-body"><div className="pg-inner">
        <div className="hx-chrome" style={{ height: 70 }}><h1 style={{ margin: 0, fontSize: 28 }}>AVAILABLE UNITS</h1><p style={{ margin: 0 }}>335 units available</p></div>
        {capi ? <><div className="fpv-ph lv-ph"><div className="fpv-ph-top"><button type="button" className="hd-back" aria-label="Back to home"><Mi aria-hidden="true" className="hd-back-chev">chevron_left</Mi></button><h1>Meta CAPI</h1><RefreshButton onClick={() => {}} busy={false} label="Refresh Meta CAPI" /></div></div><div className="mcx">panel stub</div></> : sub ? <div className="hero hero-acts-only" /> : home ? <div className="hero"><div className="hero-main"><h1 className="hero-title">Hello, Noah</h1></div></div> : leads ? leadsHead : list ? <PropertiesView /> : <AvailableUnitsView />}
      </div></main>
    </div></div></Ctx.Provider>;
}
// ?many=9: clone the seeded project before mount, so the phone list is long enough to scroll (hx-many)
const many = Number(new URLSearchParams(location.search).get('many') || 0);
if (many) { const db = JSON.parse(localStorage.getItem('propcrm_v2')); if (db.properties.length < many) { const base = db.properties[0]; for (let i = db.properties.length; i < many; i++) db.properties.push({ ...structuredClone(base), id: base.id + '-' + i, name: base.name + ' ' + (i + 1) }); localStorage.setItem('propcrm_v2', JSON.stringify(db)); } }
createRoot(document.getElementById('root')).render(<Host />);
