import { useState } from 'react';
import Mi from '../Mi.jsx';
import { projectInventory } from '../../lib/projects.js';

// Booking, step one: every project as a card. A project opens on its floors
// (and then its shops); one with no floor plan yet cannot be booked from here
// and says so.
export default function ProjectList({ projects, onPick }) {
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
          {projects.length > 6 && (
            <label className="bk-search bkp-search">
              <Mi>search</Mi>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
            </label>
          )}
        </header>

        {!projects.length ? (
          <div className="bk-empty bk-empty-lg"><Mi>apartment</Mi><b>No projects yet</b><span>Add one from Projects → Add property.</span></div>
        ) : !shown.length ? (
          <div className="bk-empty bk-empty-lg"><Mi>search_off</Mi><b>No project matches</b><span>Try another word.</span></div>
        ) : (
          <div className="bkp-grid">
            {shown.map(p => {
              const inv = projectInventory(p);
              const floors = p.floorPlans.length;
              const cover = p.media?.images?.[0]?.url || p.images?.[0] || '';
              const ready = floors > 0;
              return (
                <button key={p.id} type="button" className="bkp-card" disabled={!ready} onClick={() => onPick(p.id)}
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
                        <span><i className="bk-sw s-sold" />{inv.sold} sold</span>
                      </span>
                    ) : null}
                    <span className="bkp-foot">
                      {ready ? <>{floors} floor{floors > 1 ? 's' : ''}<span className="bkp-go">Choose a floor <Mi>arrow_forward</Mi></span></> : 'No floor plan yet. Add one in Projects → Available Units.'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
