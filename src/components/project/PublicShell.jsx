import { useEffect } from 'react';
import { PUBLIC_BRAND } from '../../lib/publicProjects.js';
import './PublicProject.css';

const FONT_ID = 'pub-brand-fonts';
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Playfair+Display:wght@500;600&display=swap';

// Header, hero band and footer shared by the portfolio and the project page.
// The page itself carries no CRM chrome and no login.
export default function PublicShell({ crumbs, title, subtitle, footerProjects = [], homeLabel = '', onExit = null, children }) {
  // The pages set document.title; put the app's own back on leave. The brand
  // fonts load here, only on the public pages, never for the CRM.
  useEffect(() => {
    const prev = document.title;
    if (!document.getElementById(FONT_ID)) {
      const l = document.createElement('link');
      l.id = FONT_ID; l.rel = 'stylesheet'; l.href = FONT_URL;
      document.head.appendChild(l);
    }
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="pub-site">
      {homeLabel && onExit && (
        <div className="pub-staff">
          <span>You are viewing the public page.</span>
          <button type="button" onClick={onExit}>Back to {homeLabel}</button>
        </div>
      )}
      <header className="pub-top">
        <div className="pub-wrap pub-top-in">
          <a className="pub-brand" href="#/p" aria-label={`${PUBLIC_BRAND.full}, all projects`}>
            <span className="pub-brand-mark" aria-hidden="true">{PUBLIC_BRAND.name[0]}</span>
            <span className="pub-brand-txt"><span className="pub-brand-name">{PUBLIC_BRAND.name}</span><span className="pub-brand-sub">{PUBLIC_BRAND.sub}</span></span>
          </a>
          <nav className="pub-nav" aria-label="Main">
            <a href="#/p">Projects</a>
            <a href="#pub-foot">Contact</a>
          </nav>
        </div>
      </header>

      <section className="pub-hero">
        <div className="pub-wrap">
          {crumbs && <nav className="pub-crumb" aria-label="Breadcrumb">{crumbs}</nav>}
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
          <div className="pub-rule" aria-hidden="true" />
        </div>
      </section>

      <main className="pub-main">
        <div className="pub-wrap">{children}</div>
      </main>

      <footer className="pub-foot" id="pub-foot">
        <div className="pub-wrap pub-foot-in">
          <div>
            <h2>{PUBLIC_BRAND.full}</h2>
            <p>{PUBLIC_BRAND.tagline}</p>
          </div>
          {footerProjects.length > 0 && (
            <div>
              <h2>Projects</h2>
              <ul>
                {footerProjects.slice(0, 6).map(p => <li key={p.id}><a href={`#/p/${encodeURIComponent(p.id)}`}>{p.name}</a></li>)}
                <li><a href="#/p">All projects</a></li>
              </ul>
            </div>
          )}
          <div>
            <h2>Office</h2>
            <ul><li>{PUBLIC_BRAND.office}</li></ul>
          </div>
        </div>
        <div className="pub-foot-bar">
          <div className="pub-wrap">&copy; {new Date().getFullYear()} {PUBLIC_BRAND.full}</div>
        </div>
      </footer>
    </div>
  );
}
