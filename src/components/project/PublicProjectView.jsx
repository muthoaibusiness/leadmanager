import { useEffect, useState } from 'react';
import { loadPublicProject, planBoxes, unitCard, sortPlans } from '../../lib/publicProjects.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import './PublicProject.css';

const KIND = { available: 'Available', booked: 'Booked', sold: 'Sold' };

// The public project page: project info, floor plan with an interactive unit
// map, and brochures. No login, no CRM chrome. Available units are selectable;
// Booked and Sold units are visibly unavailable and never open the detail flow.
function PublicProjectLoader({ projectId, homeLabel = '', onExit = null, preview = false }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [planId, setPlanId] = useState(null);
  const [sel, setSel] = useState(null); // selected unit code (available only)

  useEffect(() => {
    let live = true;
    loadPublicProject(projectId, { preview }).then(r => {
      if (!live) return;
      if (r.error) { setState({ phase: 'error', error: r.error }); return; }
      setState({ phase: 'ready', ...r });
    });
    return () => { live = false; };
  }, [projectId, preview]);

  if (state.phase === 'loading') {
    return <div className="pub pg-shell"><div className="pub-muted">Loading project...</div></div>;
  }
  if (state.phase === 'error') {
    return (
      <div className="pub pg-shell">
        <div className="pub-card">
          <h1>{state.error === 'unpublished' ? 'Not published' : 'Project unavailable'}</h1>
          <p className="pub-muted">{state.error === 'unpublished' ? 'This project is not public yet. Publish it from the Public Project admin tab.' : `${state.error}.`}</p>
          {homeLabel && onExit && <button className="btn btn-g" type="button" onClick={onExit}>Back to {homeLabel}</button>}
        </div>
      </div>
    );
  }

  const { project, source } = state;
  const plans = sortPlans(project.floorPlans);
  const fp = plans.find(p => p.id === planId) || plans[0] || null;
  const boxes = fp ? planBoxes(project, fp) : [];

  const onTap = (boxId) => {
    if (!fp) return;
    const box = fp.boxes.find(b => b.id === boxId);
    if (!box) { setSel(null); return; }
    const card = unitCard(project, box.unitId);
    if (card && card.status === 'available') setSel(card.code);
    // booked/sold: no-op, visibly unavailable, never open details
  };

  const selCard = sel ? unitCard(project, sel) : null;

  return (
    <div className="pub pg-shell">
      {source === 'mock' && <div className="pub-mock">Demo data, connect the CRM source to go live.</div>}
      {homeLabel && onExit && (
        <button className="pub-exit" type="button" onClick={onExit}>Back to {homeLabel}</button>
      )}

      <header className="pub-head">
        <h1>{project.name}</h1>
        <div className="pub-facts">
          {project.type && <span className="pub-chip">{project.type}</span>}
          {project.address && <span>{project.address}</span>}
          {project.handover && <span>Handover: {project.handover}</span>}
          {project.listing && <span>Listing: {project.listing}</span>}
        </div>
      </header>

      {/* Brochure */}
      <section className="pub-sec" aria-label="Brochure">
        <h2>Brochure</h2>
        {project.brochures.length ? (
          <ul className="pub-docs">
            {project.brochures.map((d, i) => (
              <li key={i}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">{d.label}</a>
                <a className="pub-dl" href={d.url} download>Download</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pub-muted">No brochure published yet.</p>
        )}
      </section>

      {/* Unit map */}
      <section className="pub-sec" aria-label="Floor plan and units">
        <div className="pub-map-head">
          <h2>Available units</h2>
          <div className="pub-legend" role="list" aria-label="Unit statuses">
            {Object.keys(KIND).map(k => (
              <span key={k} role="listitem" className="pub-lg">
                <i className={`pub-dot st-${k === 'booked' ? 'hold' : k}`} aria-hidden="true" />
                {KIND[k]}
              </span>
            ))}
          </div>
        </div>

        {plans.length > 1 && (
          <div className="pub-floors" role="group" aria-label="Floor">
            {plans.map(p => (
              <button key={p.id} type="button" className={`pub-floor${p.id === fp?.id ? ' on' : ''}`}
                onClick={() => { setPlanId(p.id); setSel(null); }}>{p.name || 'Floor plan'}</button>
            ))}
          </div>
        )}

        {!fp ? (
          <p className="pub-muted">No floor plan published yet.</p>
        ) : (
          <div className="pub-map">
            <FloorPlanCanvas image={fp.image} boxes={boxes} onSelect={onTap} selectedId={selCard ? boxes.find(b => b.label === selCard.code)?.id ?? null : null}
              label={`${fp.name || 'Floor plan'} of ${project.name}`} />
            <aside className="pub-unit" aria-live="polite">
              {selCard ? (
                <>
                  <div className="pub-unit-code">{selCard.code}</div>
                  <div className="pub-status-row">
                    <span className={`pub-status st-${selCard.status === 'booked' ? 'hold' : selCard.status}`}>{selCard.statusLabel}</span>
                  </div>
                  <dl className="pub-facts">
                    {selCard.type && <div><dt>Type</dt><dd>{selCard.type}</dd></div>}
                    {selCard.size != null && <div><dt>Size</dt><dd>{selCard.size.toLocaleString('en-IN')} sqft</dd></div>}
                    {selCard.price != null && <div><dt>Price</dt><dd>{'৳' + selCard.price.toLocaleString('en-IN')}</dd></div>}
                  </dl>
                </>
              ) : (
                <p className="pub-muted">Select an Available unit on the plan to see its details.</p>
              )}
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}

// Outer wrapper remounts the loader when the project or preview mode changes,
// so each new key starts from the loading state (no synchronous setState in an effect).
export default function PublicProjectView(props) {
  return <PublicProjectLoader key={`${props.projectId}|${props.preview}`} {...props} />;
}
