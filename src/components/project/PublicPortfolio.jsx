import { useEffect, useState } from 'react';
import { loadPublicPortfolio } from '../../lib/publicProjects.js';
import './PublicProject.css';
import './PublicPortfolio.css';

// The public portfolio landing page: every published project as a card. No
// login, no app shell. Each card links to that project's public detail route
// (#/p/<id>). Only real source fields are shown; missing data falls back to a
// deliberate empty state.
function PublicPortfolioLoader({ homeLabel = '', onExit = null }) {
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    loadPublicPortfolio().then(r => {
      if (!live) return;
      if (r.error) { setState({ phase: 'error', error: r.error }); return; }
      setState({ phase: 'ready', projects: r.projects });
    });
    return () => { live = false; };
  }, []);

  if (state.phase === 'loading') {
    return <div className="pub pg-shell"><div className="pub-muted">Loading projects...</div></div>;
  }
  if (state.phase === 'error') {
    return (
      <div className="pub pg-shell">
        <div className="pub-card">
          <h1>Portfolio unavailable</h1>
          <p className="pub-muted">{state.error}.</p>
          {homeLabel && onExit && <button className="btn btn-g" type="button" onClick={onExit}>Back to {homeLabel}</button>}
        </div>
      </div>
    );
  }

  const { projects } = state;

  return (
    <div className="pub pg-shell">
      {homeLabel && onExit && (
        <button className="pub-exit" type="button" onClick={onExit}>Back to {homeLabel}</button>
      )}

      <header className="pub-head">
        <h1>Explore WECON Properties</h1>
        <p className="pub-muted">Browse our published projects and view unit availability.</p>
      </header>

      {projects.length === 0 ? (
        <section className="pub-sec">
          <p className="pub-muted">No projects are published yet. Check back soon.</p>
        </section>
      ) : (
        <section className="ppf-grid" aria-label="Published projects">
          {projects.map(p => (
            <a key={p.id} className="ppf-card" href={`#/p/${encodeURIComponent(p.id)}`}>
              {p.cover
                ? <img className="ppf-cover" src={p.cover} alt="" loading="lazy" />
                : <div className="ppf-cover ppf-cover-empty" aria-hidden="true" />}
              <div className="ppf-body">
                <h2>{p.name}</h2>
                {p.type && <span className="pub-chip">{p.type}</span>}
                {p.address && <p className="ppf-loc">{p.address}</p>}
                {p.details && <p className="ppf-desc">{p.details}</p>}
                <span className="ppf-go">View Project</span>
              </div>
            </a>
          ))}
        </section>
      )}
    </div>
  );
}

export default function PublicPortfolio(props) {
  return <PublicPortfolioLoader {...props} />;
}
