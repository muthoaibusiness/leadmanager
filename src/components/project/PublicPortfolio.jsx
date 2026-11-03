import { useEffect, useState } from 'react';
import { loadPublicPortfolio, sizeRange, safeUrl, displayName } from '../../lib/publicProjects.js';
import PublicShell from './PublicShell.jsx';

// The public portfolio landing page (#/p): every published project as a card,
// linking to its public page (#/p/<id>). No login, no CRM chrome. Only real
// source fields are shown; a missing photo falls back to a branded placeholder.
function PublicPortfolioLoader({ homeLabel = '', onExit = null }) {
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    document.title = 'Projects | WECON Properties';
    loadPublicPortfolio().then(r => {
      if (!live) return;
      setState(r.error ? { phase: 'error', error: r.error } : { phase: 'ready', projects: r.projects });
    });
    return () => { live = false; };
  }, []);

  const projects = state.projects || [];
  return (
    <PublicShell
      crumbs={<><span>Home</span><span aria-hidden="true">/</span><span aria-current="page">Projects</span></>}
      title="Our Projects"
      subtitle="Explore WECON residential and commercial projects with live unit availability."
      footerProjects={projects.map(p => ({ id: p.id, name: displayName(p.name) }))}
      homeLabel={homeLabel} onExit={onExit}>
      {state.phase === 'loading' && <p className="pub-muted" role="status">Loading projects...</p>}
      {state.phase === 'error' && (
        <div className="pub-card pub-msg" role="alert">
          <h2>Projects are unavailable</h2>
          <p className="pub-muted">{state.error}. Please try again later.</p>
        </div>
      )}
      {state.phase === 'ready' && projects.length === 0 && (
        <div className="pub-card pub-msg"><h2>No projects yet</h2><p className="pub-muted">No projects are published at the moment. Please check back soon.</p></div>
      )}
      {state.phase === 'ready' && projects.length > 0 && (
        <>
          <p className="pub-count">Showing {projects.length} project{projects.length === 1 ? '' : 's'}</p>
          <div className="ppf-grid">
            {projects.map(p => <ProjectCard key={p.id} p={p} />)}
          </div>
        </>
      )}
    </PublicShell>
  );
}

function ProjectCard({ p }) {
  const [broken, setBroken] = useState(false);
  const c = p.counts || {};
  const total = (c.available || 0) + (c.booked || 0) + (c.sold || 0);
  const pct = (n) => `${total ? ((n || 0) / total) * 100 : 0}%`;
  const cover = safeUrl(p.cover);
  const name = displayName(p.name);
  const pill = total && !c.available ? 'Sold out' : p.handover ? (/^ready$/i.test(p.handover) ? 'Ready' : `Handover ${p.handover}`) : '';
  const sizes = sizeRange(c.minSize, c.maxSize) || p.sizeText;
  return (
    <a className="ppf-card" href={`#/p/${encodeURIComponent(p.id)}`}>
      <div className="ppf-media">
        {cover && !broken
          ? <img src={cover} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <div className="pub-ph" aria-hidden="true">{name}</div>}
        {pill && <span className={`ppf-pill${pill === 'Sold out' ? ' is-out' : ''}`}>{pill}</span>}
      </div>
      <div className="ppf-body">
        {p.address && <span className="ppf-loc">{p.address}</span>}
        <h2>{name}</h2>
        {total > 0 && (
          <div className="ppf-bar" role="img" aria-label={`${c.available} available, ${c.booked} booked, ${c.sold} sold`}>
            <span className="is-av" style={{ width: pct(c.available) }} />
            <span className="is-bk" style={{ width: pct(c.booked) }} />
            <span className="is-sd" style={{ width: pct(c.sold) }} />
          </div>
        )}
        <div className="ppf-meta">
          {total > 0 && <span><b>{c.available}</b> of {total} units available</span>}
          {p.type && <span>{p.type}</span>}
          {sizes && <span>{sizes}</span>}
        </div>
        <span className="ppf-go">View project</span>
      </div>
    </a>
  );
}

export default function PublicPortfolio(props) {
  return <PublicPortfolioLoader {...props} />;
}
