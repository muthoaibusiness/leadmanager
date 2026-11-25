import { useState } from 'react';
import Mi from '../Mi.jsx';
import { projectInventory } from '../../lib/projects.js';
import { getProperty } from '../../lib/db.js';
import { canSee } from '../../lib/constants.js';
import { useApp } from '../../context/AppContext.jsx';
import useProjectNav from '../../hooks/useProjectNav.js';

// Booking, step one: every project as a card. A project opens on its floors
// (and then its shops); one with no floor plan yet cannot be booked from here
// and says so. Whoever manages projects can also add one here, edit its details, or
// open its floor plans and units.
export default function ProjectList({ projects, onPick }) {
  const { user, setPropEdit, openModal } = useApp();
  const pnav = useProjectNav();
  const manage = canSee(user, 'properties');
  const edit = (id) => { const p = getProperty(id); if (p) { setPropEdit(p); openModal('property-edit'); } };
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = projects.filter(p => !term || `${p.name || ''} ${p.address || ''} ${p.purpose || ''}`.toLowerCase().includes(term));

  return (
    <div className="bk">
      <div className="bkp">
        <header className="bkp-head">
          <div>
            <span className="bk-eyebrow">Booking</span>
            <h2>Choose a project</h2>
          </div>
          <div className="bkp-tools">
          {projects.length > 6 && (
            <label className="bk-search bkp-search">
              <Mi>search</Mi>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
            </label>
          )}
          {manage && <button type="button" className="bk-btn primary bkp-add" onClick={pnav.addProperty}><Mi>add</Mi>Add project</button>}
          </div>
        </header>

        {!projects.length ? (
          <div className="bk-empty bk-empty-lg"><Mi>apartment</Mi><b>No projects yet</b><span>{manage ? 'Use Add project to create one.' : 'Ask a manager to add one.'}</span></div>
        ) : !shown.length ? (
          <div className="bk-empty bk-empty-lg"><Mi>search_off</Mi><b>No project matches</b><span>Try another word.</span></div>
        ) : (
          <div className="bkp-grid">
            {shown.map(p => {
              const inv = projectInventory(p);
              const cover = p.media?.images?.[0]?.url || p.images?.[0] || '';
              const ready = p.floorPlans.length > 0;
              return (
                <div key={p.id} className="bkp-item">
                <button type="button" className="bkp-card" disabled={!ready} onClick={() => onPick(p.id)}
                  aria-label={ready ? `Open ${p.name}` : `${p.name}, no floor plan yet`}>
                  <span className="bkp-cover">
                    {cover ? <img src={cover} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}
                    <Mi>apartment</Mi>
                    {p.purpose && <i className="bk-pill">{p.purpose}</i>}
                  </span>
                  <span className="bkp-body">
                    <b>{p.name}</b>
                    <span className="bkp-addr">{p.address || 'No address yet'}</span>
                    {ready ? (
                      <span className="bkp-stats">
                        <span><i className="bk-sw s-available" />{inv.available} open</span>
                        <span><i className="bk-sw s-hold" />{inv.hold} held</span>
                        <span><i className="bk-sw s-sold" />{inv.soldOnly} sold</span>
                        {inv.landowner > 0 && <span><i className="bk-sw s-land" />{inv.landowner} landowner</span>}
                      </span>
                    ) : null}
                    <span className="bkp-foot">
                      {ready ? <span className="bkp-go">Choose a unit <Mi>arrow_forward</Mi></span> : (manage ? 'No floor plan yet. Use Plans & units to add one.' : 'No floor plan yet.')}
                    </span>
                  </span>
                </button>
                {manage && (
                  <span className="bkp-act">
                    <button type="button" onClick={() => edit(p.id)} aria-label={`Edit ${p.name}`} title="Edit details"><Mi>edit</Mi></button>
                  </span>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
