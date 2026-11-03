import { useEffect, useState } from 'react';
import { loadPublicProject, loadPublicPortfolio, planBoxes, unitDetail, countUnits, glanceRows, safeUrl, sft, STATUS_LABEL, displayName } from '../../lib/publicProjects.js';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import PublicShell from './PublicShell.jsx';
import './FloorPlan.css';

const ORDER = ['available', 'booked', 'sold'];

// The public project page (#/p/<id>): gallery, At a Glance, unit availability
// grid, floor plan and brochure. No login, no CRM chrome, no forms. Available
// units can be selected to see their details; Booked and Sold units are
// visibly unavailable and never open the detail flow.
//
// `preview` + `source`: the admin preview of a project from the CRM cache,
// reduced to the same public fields (see toPublic).
function PublicProjectLoader({ projectId, homeLabel = '', onExit = null, preview = false, source = null }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [others, setOthers] = useState([]);

  useEffect(() => {
    let live = true;
    loadPublicProject(projectId, { preview, source }).then(r => {
      if (!live) return;
      setState(r.error ? { phase: 'error', error: r.error } : { phase: 'ready', project: r.project });
      if (r.project) document.title = `${displayName(r.project.name)} | WECON Properties`;
    });
    if (!preview) loadPublicPortfolio().then(r => { if (live && r.projects) setOthers(r.projects.map(p => ({ id: p.id, name: displayName(p.name) }))); });
    return () => { live = false; };
  }, [projectId, preview, source]);

  const shell = { homeLabel, onExit, footerProjects: others };
  const back = <a href="#/p">Projects</a>;

  if (state.phase === 'loading') {
    return <PublicShell {...shell} crumbs={back} title="Loading project..."><p className="pub-muted" role="status">Loading project...</p></PublicShell>;
  }
  if (state.phase === 'error') {
    const unpublished = state.error === 'unpublished';
    return (
      <PublicShell {...shell} crumbs={back} title={unpublished ? 'Project not found' : 'Project unavailable'}>
        <div className="pub-card pub-msg" role="alert">
          <p className="pub-muted">{unpublished ? 'This project is not published, or the link is wrong.' : `${state.error}. Please try again later.`}</p>
          <a className="pub-btn" href="#/p">See all projects</a>
        </div>
      </PublicShell>
    );
  }

  const p = state.project;
  const name = displayName(p.name);
  return (
    <PublicShell {...shell}
      crumbs={<>{back}<span aria-hidden="true">/</span><span aria-current="page">{name}</span></>}
      title={name}
      subtitle={[p.handover && `Handover ${p.handover}`, p.address].filter(Boolean).join(' | ')}>
      {preview && <p className="pub-note" role="note">Preview: this is what customers will see once the project is published.</p>}
      <div className="pub-stack">
        <div className="pub-two">
          <Gallery photos={(p.photos || []).map(safeUrl).filter(Boolean)} name={name} />
          <aside className="pub-card" aria-labelledby="pub-glance">
            <h2 id="pub-glance">At a Glance</h2>
            {glanceRows(p).length
              ? <dl className="pub-glance">{glanceRows(p).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              : <p className="pub-muted">Project details are coming soon.</p>}
          </aside>
        </div>
        {p.details && <section className="pub-card" aria-labelledby="pub-overview"><h2 id="pub-overview">Project Overview</h2><p className="pub-prose">{p.details}</p></section>}
        <Units project={p} />
        <Brochures docs={(p.brochures || []).filter(d => safeUrl(d.url))} />
      </div>
    </PublicShell>
  );
}

function Gallery({ photos, name }) {
  const [i, setI] = useState(0);
  const [dead, setDead] = useState(() => new Set());
  const live = photos.filter(u => !dead.has(u));
  const cur = live[Math.min(i, live.length - 1)];
  const kill = (u) => setDead(d => new Set(d).add(u));
  if (!live.length) {
    return <div className="pub-gal-main"><div className="pub-ph">{name}<span>Photos coming soon</span></div></div>;
  }
  return (
    <div>
      <div className="pub-gal-main"><img src={cur} alt={`${name}, photo ${live.indexOf(cur) + 1} of ${live.length}`} onError={() => kill(cur)} /></div>
      {live.length > 1 && (
        <div className="pub-thumbs" role="group" aria-label="Photos">
          {live.map((u, k) => (
            <button key={u} type="button" className="pub-thumb" aria-current={u === cur} aria-label={`Show photo ${k + 1}`} onClick={() => setI(k)}>
              <img src={u} alt="" loading="lazy" onError={() => kill(u)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The unit grid and the floor plan share one selection.
function Units({ project }) {
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(null);
  const [planIdx, setPlanIdx] = useState(0);
  const c = countUnits(project);
  const total = c.available + c.booked + c.sold;
  const groups = (project.variants || []).filter(v => (v.units || []).length);
  const plans = project.plans || [];
  const fp = plans[planIdx] || null;
  const boxes = fp ? planBoxes(project, fp) : [];
  const card = sel ? unitDetail(project, sel) : null;

  // Only an available unit becomes the selection; booked/sold do nothing. The
  // plan follows the pick to the floor that holds the unit, when one does.
  const pick = (id) => {
    if (!unitDetail(project, id)) return;
    setSel(id);
    const k = plans.findIndex(f => f.boxes.some(b => b.unitId === id));
    if (k >= 0) setPlanIdx(k);
  };
  const onBox = (boxId) => { const b = fp?.boxes.find(x => x.id === boxId); if (b) pick(b.unitId); };

  return (
    <>
      <section className="pub-card" aria-labelledby="pub-units">
        <h2 id="pub-units">Unit Availability</h2>
        {total === 0 ? <p className="pub-muted">No units listed for this project yet.</p> : (
          <>
            <div className="pub-chips" role="group" aria-label="Filter units by status">
              <button type="button" className="pub-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All <b>{total}</b></button>
              {ORDER.map(k => (
                <button key={k} type="button" className="pub-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  <i className={`pub-dot is-${k}`} aria-hidden="true" />{STATUS_LABEL[k]} <b>{c[k]}</b>
                </button>
              ))}
            </div>
            {groups.map(v => {
              const units = v.units.filter(u => filter === 'all' || u.status === filter);
              if (!units.length) return null;
              return (
                <div key={v.id || v.name} className="pub-variant">
                  <h3>{v.name || 'Units'}
                    {v.size > 0 && <span> · {sft(v.size)}</span>}
                    {v.beds > 0 && <span> · {v.beds} bed{v.baths > 0 ? `, ${v.baths} bath` : ''}</span>}
                  </h3>
                  <div className="pub-units">
                    {units.map(u => (
                      <button key={u.id} type="button" className={`pub-unit is-${u.status}`} aria-pressed={sel === u.id}
                        aria-disabled={u.status !== 'available'}
                        aria-label={`Unit ${u.id}, ${STATUS_LABEL[u.status]}${u.size > 0 ? ', ' + sft(u.size) : ''}`}
                        onClick={() => pick(u.id)}>
                        <b>{u.id}</b>
                        {u.size > 0 && <span>{sft(u.size)}</span>}
                        <span className="pub-unit-st">{STATUS_LABEL[u.status]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="pub-unit-panel" aria-live="polite">
              {card ? (
                <>
                  <div className="pub-unit-head"><b>Unit {card.code}</b><span className="pub-tag is-available">{card.statusLabel}</span></div>
                  <dl>
                    {card.type && <div><dt>Type</dt><dd>{card.type}</dd></div>}
                    {card.size && <div><dt>Size</dt><dd>{sft(card.size)}</dd></div>}
                    {card.beds && <div><dt>Bedrooms</dt><dd>{card.beds}</dd></div>}
                    {card.baths && <div><dt>Bathrooms</dt><dd>{card.baths}</dd></div>}
                  </dl>
                </>
              ) : <span className="pub-muted">Select an available unit to see its details.</span>}
            </div>
          </>
        )}
      </section>

      <section className="pub-card" aria-labelledby="pub-plan">
        <h2 id="pub-plan">Floor Plan</h2>
        {!fp ? <p className="pub-muted">No floor plan published for this project yet.</p> : (
          <>
            {plans.length > 1 && (
              <div className="pub-chips" role="group" aria-label="Floor">
                {plans.map((f, k) => <button key={f.id} type="button" className="pub-chip" aria-pressed={k === planIdx} onClick={() => setPlanIdx(k)}>{f.name}</button>)}
              </div>
            )}
            <FloorPlanCanvas className="pub-plan" image={fp.image} boxes={boxes} onSelect={onBox}
              selectedId={boxes.find(b => b.label === sel)?.id ?? null}
              label={`${fp.name} of ${displayName(project.name)}`} />
            <p className="pub-muted pub-small">Tap a green unit to see its details. Booked and sold units cannot be selected.</p>
          </>
        )}
      </section>
    </>
  );
}

function Brochures({ docs }) {
  return (
    <section className="pub-card" aria-labelledby="pub-docs">
      <h2 id="pub-docs">Brochure</h2>
      {!docs.length ? <p className="pub-muted">No brochure published for this project yet.</p> : docs.map((d, k) => (
        <div key={k} className="pub-doc">
          <span className="pub-doc-name">{d.label}</span>
          <span className="pub-doc-acts">
            <a className="pub-btn" href={d.url} target="_blank" rel="noopener noreferrer">View</a>
            <a className="pub-btn is-solid" href={d.url} download>Download</a>
          </span>
        </div>
      ))}
    </section>
  );
}

// Remounts the loader when the project or preview mode changes, so each new key
// starts from the loading state (no synchronous setState in an effect).
export default function PublicProjectView(props) {
  return <PublicProjectLoader key={`${props.projectId}|${props.preview}`} {...props} />;
}
