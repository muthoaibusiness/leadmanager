import { useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { DESIGNS, LAYOUTS, useDesign, useLayout, useTheme, setTheme } from '../lib/theme.js';
import { saveCompanyDesign, saveCompanyLayout } from '../lib/companyDesign.js';

// Users › Appearance (admins): pick how the whole company's app is built and painted.
//   Layout  where the navigation sits and how pages, lists and a lead's record are laid out
//           (layouts.css); each option is a wireframe of it.
//   Style   colours and shapes (designs.css); each option is a small drawing of the app painted
//           from the .dsg-prev tokens, in the theme (dark/light) that is on now.
// The two are independent, so any layout works with any style. Picking one applies it at once and
// saves it for the company (lib/companyDesign.js); the dark/light switch stays each person's own.
export default function DesignPicker() {
  const { user, showToast } = useApp();
  const design = useDesign();
  const layout = useLayout();
  const isDark = useTheme() === 'dark';
  const [busy, setBusy] = useState('');

  const pick = async (kind, opt, current, saveFn) => {
    if (busy || opt.id === current) return;
    setBusy(kind + opt.id);
    const r = await saveFn(user, opt.id);
    setBusy('');
    if (r.error) showToast(r.error, 'err');
    else showToast(`${opt.name} ${kind} is on for ${r.shared ? 'everyone in the company' : 'this device'}`, 'ok');
  };

  const meta = (kind, o, on) => (
    <span className="dsg-meta">
      <span className="dsg-name">{o.name}{on && <span className="dsg-on"><Mi>check</Mi>In use</span>}{busy === kind + o.id && <span className="dsg-on">Saving…</span>}</span>
      <span className="dsg-note">{o.note}</span>
    </span>
  );

  return (
    <section className="rqi-card dsg" aria-labelledby="dsg-h">
      <header className="dsg-hd">
        <div>
          <h3 id="dsg-h">App appearance</h3>
          <span className="bk-cap">Choose how the app is laid out and styled for everyone in your company, on computers and phones. Nothing else changes: pages, data and permissions stay as they are.</span>
        </div>
        <div className="dsg-mode" role="group" aria-label="Your own colour mode">
          <button type="button" className="bk-chip" aria-pressed={isDark} onClick={() => setTheme('dark')}><Mi>dark_mode</Mi>Dark</button>
          <button type="button" className="bk-chip" aria-pressed={!isDark} onClick={() => setTheme('light')}><Mi>light_mode</Mi>Light</button>
        </div>
      </header>

      <div className="dsg-sec">
        <h4 id="dsg-lh">Layout<span>where the navigation sits and how pages are built</span></h4>
        <div className="dsg-grid" role="radiogroup" aria-labelledby="dsg-lh">
          {LAYOUTS.map(l => {
            const on = l.id === layout;
            return (
              <button key={l.id} type="button" role="radio" aria-checked={on} disabled={!!busy && busy !== 'layout' + l.id}
                className={`dsg-opt${on ? ' on' : ''}`} onClick={() => pick('layout', l, layout, saveCompanyLayout)}>
                <span className="lyt-prev" data-l={l.id} aria-hidden="true">
                  <i className="nav" /><i className="n1 on" /><i className="n2" /><i className="n3" />
                  <i className="card c1" /><i className="card c2" /><i className="card c3" /><i className="card c4" /><i className="card rec" />
                </span>
                {meta('layout', l, on)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dsg-sec">
        <h4 id="dsg-sh">Style<span>colours, corners and type</span></h4>
        <div className="dsg-grid" role="radiogroup" aria-labelledby="dsg-sh">
          {DESIGNS.map(d => {
            const on = d.id === design;
            return (
              <button key={d.id} type="button" role="radio" aria-checked={on} disabled={!!busy && busy !== 'design' + d.id}
                className={`dsg-opt${on ? ' on' : ''}`} onClick={() => pick('design', d, design, saveCompanyDesign)}>
                <span className="dsg-prev" data-d={d.id} aria-hidden="true">
                  <span className="dsg-p-side"><i /><i className="on" /><i /><i /></span>
                  <span className="dsg-p-main">
                    <span className="dsg-p-title" />
                    <span className="dsg-p-row"><span className="dsg-p-card"><b /><i /></span><span className="dsg-p-card"><b /><i /></span></span>
                    <span className="dsg-p-table"><i /><i /><i /></span>
                    <span className="dsg-p-btn" />
                  </span>
                </span>
                {meta('design', d, on)}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
