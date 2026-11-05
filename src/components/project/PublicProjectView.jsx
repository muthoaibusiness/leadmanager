import { useEffect, useState } from 'react';
import { loadPublicProject, loadPublicPortfolio, unitDetail, countUnits, glanceRows, safeUrl, sft, STATUS_LABEL, displayName, floorStack, isMapLink, mapEmbedUrl } from '../../lib/publicProjects.js';
import PublicShell from './PublicShell.jsx';

const ORDER = ['available', 'booked', 'sold'];

// The public project page (#/p/<id>): gallery and At a Glance, then the
// overview, the units (floor by floor) and the brochure. No login, no CRM chrome, no forms. Available
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
      {/* Reference layout: gallery, overview and units down the left; At a
          Glance and the Brochure / More Details buttons on the right. */}
      <div className="pub-two">
        <div className="pub-stack">
          <Gallery photos={(p.photos || []).map(safeUrl).filter(Boolean)} name={name} />
          {p.details && (
            <section className="pub-card" aria-labelledby="pub-overview">
              <h2 id="pub-overview">Project Overview</h2>
              <Prose text={p.details} />
            </section>
          )}
          <Units project={p} />
        </div>
        <div className="pub-stack pub-aside">
          <Glance project={p} />
          <ProjectLinks docs={(p.brochures || []).filter(d => safeUrl(d.url))} links={(p.links || []).filter(l => safeUrl(l.url) && !isMapLink(l))} />
          <ProjectMap link={(p.links || []).find(l => safeUrl(l.url) && isMapLink(l))} name={name} />
          <RequestCallback />
        </div>
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

// At a Glance: the project's fact tabs (public_facts, migration 0061), as
// accessible tabs. Without tabs it falls back to the project's own fields.
function Glance({ project }) {
  const tabs = (project.facts || []).filter(t => t.tab && (t.rows || []).length);
  const [i, setI] = useState(0);
  const cur = tabs[Math.min(i, tabs.length - 1)];
  const rows = tabs.length ? cur.rows : glanceRows(project);
  const onKey = (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const list = [...e.currentTarget.parentElement.children];
    const n = (list.indexOf(e.currentTarget) + d + tabs.length) % tabs.length;
    setI(n);
    list[n]?.focus();
  };
  return (
    <aside className="pub-card" aria-labelledby="pub-glance">
      <h2 id="pub-glance">At a Glance</h2>
      {tabs.length > 1 && (
        <div className="pub-tabs" role="tablist" aria-label="Project facts">
          {tabs.map((t, k) => (
            <button key={t.tab} type="button" role="tab" id={`pub-tab-${k}`} aria-controls="pub-tabpanel"
              aria-selected={k === i} tabIndex={k === i ? 0 : -1} onClick={() => setI(k)} onKeyDown={onKey}>{t.tab}</button>
          ))}
        </div>
      )}
      <div id="pub-tabpanel" role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `pub-tab-${i}` : undefined}>
        {rows.length
          ? <dl className="pub-glance">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          : <p className="pub-muted">Project details are coming soon.</p>}
      </div>
    </aside>
  );
}

// Overview text from the Catalog. A short line on its own (no full stop) is a
// sub-heading; everything else is a paragraph.
function Prose({ text }) {
  const blocks = text.split(/\n+/).map(t => t.trim()).filter(Boolean);
  return (
    <div className="pub-prose">
      {blocks.map((b, k) => (b.length <= 70 && !/[.!?]$/.test(b) ? <h3 key={k}>{b}</h3> : <p key={k}>{b}</p>))}
    </div>
  );
}

// Units: floor stack (top floor first) | that floor's units | the picked unit.
// Laid out like Available Units: a vertical floor list with each floor's open
// count, the floor's units as tiles, and a detail card. No drawing: the
// brochure carries the plans. Only available units can be picked.
function Units({ project }) {
  const floors = floorStack(project);
  const [floorId, setFloorId] = useState(() => (floors.find(f => f.units.some(x => x.unit.status === 'available')) || floors[0])?.id ?? null);
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(null);
  const c = countUnits(project);
  const total = c.available + c.booked + c.sold;
  const floor = floors.find(f => f.id === floorId) || floors[0] || null;
  const card = sel ? unitDetail(project, sel) : null;
  const groups = [];
  for (const x of floor?.units || []) {
    if (filter !== 'all' && x.unit.status !== filter) continue;
    const g = groups.find(y => y.name === (x.variant.name || 'Units'));
    if (g) g.units.push(x); else groups.push({ name: x.variant.name || 'Units', units: [x] });
  }
  const openOn = (f) => f.units.filter(x => x.unit.status === 'available').length;
  const goFloor = (id) => { setFloorId(id); setSel(null); };
  // booked and sold never become the selection
  const pick = (id) => { if (unitDetail(project, id)) setSel(id); };

  return (
    <section className="pub-card pub-inv" aria-labelledby="pub-units">
      <h2 id="pub-units">Units</h2>
      {total === 0 ? <p className="pub-muted">No units listed for this project yet.</p> : (
        <>
          <div className="pub-inv-bar">
            <div className="pub-chips" role="group" aria-label="Filter units by status">
              <button type="button" className="pub-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
              {ORDER.map(k => (
                <button key={k} type="button" className="pub-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  <i className={`pub-dot is-${k}`} aria-hidden="true" />{STATUS_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="pub-inv-sum"><span><b>{c.available}</b> available</span><span><b>{c.booked}</b> booked</span><span><b>{c.sold}</b> sold</span><span><b>{total}</b> total</span></p>
          </div>

          <div className="pub-inv-grid">
            <nav className="pub-floors" aria-label="Floors">
              {floors.map(f => (
                <button key={f.id} type="button" className="pub-floor" aria-pressed={f.id === floor?.id} onClick={() => goFloor(f.id)}>
                  <span className="pub-floor-name">{f.name}</span>
                  <span className="pub-floor-open">{f.units.length ? `${openOn(f)} open` : 'No units'}</span>
                </button>
              ))}
            </nav>

            <div className="pub-inv-map">
              <div className="pub-inv-head"><h3>{floor?.name}</h3><span>{floor?.units.length || 0} unit{floor?.units.length === 1 ? '' : 's'}</span></div>
              {!floor?.units.length ? <p className="pub-muted">No units on this floor.</p>
                : !groups.length ? <p className="pub-muted">No {STATUS_LABEL[filter].toLowerCase()} units on this floor.</p>
                : groups.map(g => (
                  <div key={g.name} className="pub-variant">
                    {groups.length > 1 && <h4>{g.name}</h4>}
                    <div className="pub-units">
                      {g.units.map(({ unit: u }) => (
                        <button key={u.id} type="button" className={`pub-unit is-${u.status}`} aria-pressed={sel === u.id}
                          aria-disabled={u.status !== 'available'}
                          aria-label={`Unit ${u.id}, ${STATUS_LABEL[u.status]}${u.size > 0 ? ', ' + sft(u.size) : ''}`}
                          onClick={() => pick(u.id)}>
                          <b>{u.id}</b>
                          <span>{u.size > 0 ? sft(u.size) : ''}</span>
                          <span className="pub-unit-st">{STATUS_LABEL[u.status]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              <div className="pub-legend" aria-hidden="true">
                {ORDER.map(k => <span key={k}><i className={`pub-sw is-${k}`} />{STATUS_LABEL[k]}</span>)}
              </div>
            </div>

            <aside className="pub-inv-card" aria-live="polite">
              {card ? (
                <>
                  <span className="pub-eyebrow">{floor?.name}</span>
                  <div className="pub-unit-head"><b>Unit {card.code}</b><span className="pub-tag is-available">{card.statusLabel}</span></div>
                  <dl>
                    {card.type && <div><dt>Type</dt><dd>{card.type}</dd></div>}
                    {card.size && <div><dt>Size</dt><dd>{sft(card.size)}</dd></div>}
                    {card.beds && <div><dt>Bedrooms</dt><dd>{card.beds}</dd></div>}
                    {card.baths && <div><dt>Bathrooms</dt><dd>{card.baths}</dd></div>}
                  </dl>
                </>
              ) : <p className="pub-muted">Pick an available unit to see its type and size.</p>}
            </aside>
          </div>

        </>
      )}
    </section>
  );
}

// The project's two calls to action, from the Catalog media: "Brochure" (the
// first PDF) and "More Details" (the first link, e.g. the project page on the
// WECON website). A button shows only when its URL exists.
// Cross-origin PDFs ignore the download attribute, so the brochure opens in a
// new tab where the customer can save it.
function ProjectLinks({ docs, links }) {
  const doc = docs[0], more = links[0];
  if (!doc && !more) return null;
  return (
    <section className="pub-card" aria-labelledby="pub-docs">
      <h2 id="pub-docs">Brochure &amp; details</h2>
      <div className="pub-cta">
        {doc && <a className="pub-btn is-solid" href={doc.url} target="_blank" rel="noopener noreferrer" download>Brochure</a>}
        {more && <a className="pub-btn" href={more.url} target="_blank" rel="noopener noreferrer">More Details</a>}
      </div>
    </section>
  );
}

// The location: a Catalog link labelled "Map" (or any Google Maps URL),
// rendered as an embedded map with a button to open it in Google Maps.
function ProjectMap({ link, name }) {
  const embed = link ? mapEmbedUrl(link.url) : '';
  if (!embed) return null;
  return (
    <section className="pub-card" aria-labelledby="pub-map">
      <h2 id="pub-map">Location</h2>
      <iframe className="pub-mapframe" src={embed} title={`Map showing ${name}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <a className="pub-btn" href={link.url} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
    </section>
  );
}

// Request Callback, laid out like the reference. Demo only for now: nothing
// is sent or stored. Wiring it to a lead is the next task (it needs a
// server-side endpoint; the public key must never write leads).
// shortcut: no backend, submit only shows a notice; replace with the inquiry endpoint.
function RequestCallback() {
  const [sent, setSent] = useState(false);
  const onSubmit = (e) => { e.preventDefault(); if (e.currentTarget.reportValidity()) setSent(true); };
  return (
    <section className="pub-card" aria-labelledby="pub-callback">
      <h2 id="pub-callback">Request Callback</h2>
      <p className="pub-muted pub-small">Schedule a walkthrough or request customized unit layouts or brochure.</p>
      {sent ? (
        <p className="pub-note pub-sent" role="status">Demo form: nothing was sent. Callback requests will reach our team once this form is connected.</p>
      ) : (
        <form className="pub-form" onSubmit={onSubmit} noValidate>
          <label><span className="pub-sr">Your name</span><input name="name" type="text" placeholder="Your Name *" required maxLength={120} autoComplete="name" /></label>
          <label><span className="pub-sr">Phone number</span><input name="phone" type="tel" placeholder="Phone Number *" required maxLength={40} autoComplete="tel" /></label>
          <label><span className="pub-sr">Email address</span><input name="email" type="email" placeholder="Email Address" maxLength={254} autoComplete="email" /></label>
          <label><span className="pub-sr">Message or requirements</span><textarea name="message" rows={3} placeholder="Message / Requirements..." maxLength={2000} /></label>
          <button type="submit" className="pub-btn is-solid">Submit Inquiry</button>
        </form>
      )}
    </section>
  );
}

// Remounts the loader when the project or preview mode changes, so each new key
// starts from the loading state (no synchronous setState in an effect).
export default function PublicProjectView(props) {
  return <PublicProjectLoader key={`${props.projectId}|${props.preview}`} {...props} />;
}
