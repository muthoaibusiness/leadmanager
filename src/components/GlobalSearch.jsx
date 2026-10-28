import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { canSee, STATUS_LABELS } from '../lib/constants.js';
import { NAV_META } from '../lib/navMeta.js';
import { queryLeads } from '../lib/db.js';
import { listProjects } from '../lib/projects.js';
import { usePageOverlay } from '../hooks/useNavHistory.js';
import useProjectNav from '../hooks/useProjectNav.js';

// Global search (opened from the phone header's search button): one box over
// pages, prospects and projects.
//   Pages     every page this account may open (same gates as the sidebar),
//             listed when the box is empty, filtered by name when it is not.
//   Prospects the server's lead search (name / phone / project) with the same
//             scope the Leads page uses, so a hit here is one the list shows.
//   Projects  the cached project list, by name or location.
// Browser Back closes it (usePageOverlay). Picking a result closes it first.

const LEAD_LIMIT = 6;
const PROJECT_LIMIT = 5;
const MIN_LEAD_CHARS = 2;

export default function GlobalSearch({ open, onClose }) {
  usePageOverlay(open, onClose);
  if (!open) return null;
  return createPortal(<SearchSheet onClose={onClose} />, document.body);
}

function SearchSheet({ onClose }) {
  const { user, nav, chatOk, setPanLead, setSearch } = useApp();
  const pnav = useProjectNav();
  const [q, setQ] = useState('');
  const [leads, setLeads] = useState({ key: '', rows: [], total: 0 });
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const term = q.trim();
  const lc = term.toLowerCase();
  const canLeads = canSee(user, 'leads');
  const leadKey = canLeads && term.length >= MIN_LEAD_CHARS ? term : '';

  // Prospects: debounced; `seq` drops a slow early answer that lands after a
  // later one (the same guard LeadsView uses for its search box).
  useEffect(() => {
    if (!leadKey) return undefined;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      queryLeads({ user, involved: true, search: leadKey }, { page: 0, size: LEAD_LIMIT, sort: 'updated' })
        .then(res => { if (mine === seq.current) setLeads({ key: leadKey, rows: res?.rows || [], total: res?.total || 0 }); })
        .catch(() => { if (mine === seq.current) setLeads({ key: leadKey, rows: [], total: 0 }); });
    }, 250);
    return () => clearTimeout(t);
  }, [leadKey, user]);

  const pages = useMemo(() => Object.keys(NAV_META)
    .filter(k => (k === 'conversations' ? chatOk : canSee(user, k)))
    .filter(k => !lc || NAV_META[k].lbl.toLowerCase().includes(lc) || k.includes(lc)), [user, chatOk, lc]);

  const projects = useMemo(() => {
    if (!lc || !canSee(user, 'properties')) return [];
    return listProjects()
      .filter(p => [p.name, p.location, p.developer].some(s => String(s || '').toLowerCase().includes(lc)))
      .slice(0, PROJECT_LIMIT);
  }, [user, lc]);

  const leadRows = leadKey && leads.key === leadKey ? leads.rows : [];
  const leadsLoading = !!leadKey && leads.key !== leadKey;

  const goPage = (k) => { onClose(); nav(k); };
  const openLead = (id) => { onClose(); setPanLead(id); };
  const openProject = (id) => { onClose(); pnav.openConsole(id, false); };
  // nav() clears the page search; setting it after puts the term in the Leads box.
  const allLeads = () => { onClose(); nav('leads'); setSearch(term); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); onClose(); }
  };
  // Enter opens the first hit: a prospect, else a project, else a page.
  const onEnter = (e) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (leadRows[0]) openLead(leadRows[0].id);
    else if (projects[0]) openProject(projects[0].id);
    else if (pages[0]) goPage(pages[0]);
  };

  const leadSec = canLeads && term.length >= MIN_LEAD_CHARS; // the section names its own empty state
  const nothing = term && !leadSec && !pages.length && !projects.length;

  return (
    <div className="gs" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}>
      <div className="gs-bar">
        <label className="gs-box">
          <Mi aria-hidden="true">search</Mi>
          <input ref={inputRef} type="search" enterKeyHint="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onEnter}
            placeholder="Search prospects, projects, pages" aria-label="Search prospects, projects, pages" autoComplete="off" />
          {q && (
            <button type="button" className="gs-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Clear search">
              <Mi aria-hidden="true">close</Mi>
            </button>
          )}
        </label>
        <button type="button" className="gs-cancel" onClick={onClose}>Cancel</button>
      </div>

      <div className="gs-body">
        {leadSec && (
          <section className="gs-sec">
            <div className="gs-hd">
              <span>Prospects</span>
              {leads.total > leadRows.length && leadRows.length > 0 && (
                <button type="button" className="gs-all" onClick={allLeads}>See all {leads.total} ›</button>
              )}
            </div>
            {leadsLoading && <div className="gs-note">Searching…</div>}
            {!leadsLoading && !leadRows.length && <div className="gs-note">No prospects match “{term}”</div>}
            {leadRows.length > 0 && (
              <div className="gs-list">
                {leadRows.map(l => (
                  <button key={l.id} type="button" className="gs-row" onClick={() => openLead(l.id)}>
                    <span className="gs-ico"><Mi aria-hidden="true">person</Mi></span>
                    <span className="gs-tx">
                      <span className="gs-t1">{l.name || 'Unnamed'}</span>
                      <span className="gs-t2">{[l.phone, l.propertyInterest].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="gs-tag">{STATUS_LABELS[l.status] || l.status}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {projects.length > 0 && (
          <section className="gs-sec">
            <div className="gs-hd"><span>Projects</span></div>
            <div className="gs-list">
              {projects.map(p => (
                <button key={p.id} type="button" className="gs-row" onClick={() => openProject(p.id)}>
                  <span className="gs-ico"><Mi aria-hidden="true">apartment</Mi></span>
                  <span className="gs-tx">
                    <span className="gs-t1">{p.name || 'Untitled project'}</span>
                    {p.location && <span className="gs-t2">{p.location}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {pages.length > 0 && (
          <section className="gs-sec">
            <div className="gs-hd"><span>{term ? 'Pages' : 'Go to'}</span></div>
            <div className="gs-list">
              {pages.map(k => (
                <button key={k} type="button" className="gs-row" onClick={() => goPage(k)}>
                  <span className="gs-ico"><Mi aria-hidden="true">{NAV_META[k].ico}</Mi></span>
                  <span className="gs-tx"><span className="gs-t1">{NAV_META[k].lbl}</span></span>
                  <Mi className="gs-chev" aria-hidden="true">chevron_right</Mi>
                </button>
              ))}
            </div>
          </section>
        )}

        {canLeads && term.length > 0 && term.length < MIN_LEAD_CHARS && (
          <div className="gs-note">Type {MIN_LEAD_CHARS} or more letters to search prospects.</div>
        )}
        {nothing && <div className="gs-note">Nothing matches “{term}”.</div>}
      </div>
    </div>
  );
}
