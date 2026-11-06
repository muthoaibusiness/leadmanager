import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getProperties, patchPropertyChecked } from '../../lib/db.js';
import { toProject } from '../../lib/projects.js';
import { projectCounts } from '../../lib/publicProjects.js';
import PublicProjectView from './PublicProjectView.jsx';
import './PublicProjectAdmin.css';

const publicUrl = (id) => `${window.location.origin}#/p/${id}`;

// Admin tab: publish/control the public project page and preview exactly what a
// customer sees. Management-only (see NAV_SCOPES.publicproject).
export default function PublicProjectAdmin() {
  const { dbVersion, refreshDB } = useApp();
  void dbVersion; // re-read the store when a publish toggle saves
  const [busy, setBusy] = useState(null); // project id being saved
  const [copied, setCopied] = useState(null);
  const [preview, setPreview] = useState(null); // project id being previewed

  const projects = getProperties().map(toProject);

  const toggle = async (p, next) => {
    setBusy(p.id);
    const res = await patchPropertyChecked(p.id, { publicPublished: next });
    setBusy(null);
    if (!res.ok) { alert(res.error || 'Could not save the publish state.'); return; }
    refreshDB();
  };

  const copy = async (p) => {
    try { await navigator.clipboard.writeText(publicUrl(p.id)); setCopied(p.id); }
    catch { /* clipboard blocked */ }
  };

  return (
    <div className="ppa">
      <div className="ppa-head">
        <p className="ppa-intro">Publish projects to the public, shareable page (<code>#/p/&lt;id&gt;</code>). Only published projects are reachable without login. Use Preview to see exactly what a customer sees before publishing.</p>
      </div>

      <div className="ppa-list">
        {projects.length === 0 && <p className="ppa-muted">No projects yet.</p>}
        {projects.map(p => {
          const counts = projectCounts(p);
          const on = !!p.publicPublished;
          return (
            <div key={p.id} className={`ppa-row${on ? ' is-on' : ''}`}>
              <div className="ppa-info">
                <div className="ppa-name">{p.name}</div>
                <div className="ppa-sub">
                  <span>{counts.available} available · {counts.booked} booked · {counts.sold} sold</span>
                  {on && <span className="ppa-url" title={publicUrl(p.id)}>{publicUrl(p.id)}</span>}
                </div>
              </div>
              <div className="ppa-acts">
                <button type="button" className="btn btn-g btn-sm" onClick={() => setPreview(p.id)}>Preview</button>
                <button type="button" className="btn btn-g btn-sm" onClick={() => copy(p)} disabled={!on}>{copied === p.id ? 'Copied' : 'Copy link'}</button>
                <label className="ppa-sw">
                  <input type="checkbox" checked={on} disabled={busy === p.id} onChange={e => toggle(p, e.target.checked)} />
                  <span className="ppa-sw-track" aria-hidden="true"><span /></span>
                  <span className="ppa-sw-label">{on ? 'Published' : 'Unpublished'}</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div className="ppa-preview" role="dialog" aria-modal="true" aria-label={`Preview ${projects.find(p => p.id === preview)?.name || 'project'}`}>
          <div className="ppa-preview-top">
            <strong>Public preview</strong>
            <span className="ppa-preview-note">What a customer sees at {publicUrl(preview)}</span>
            <button type="button" className="btn btn-g btn-sm" onClick={() => setPreview(null)}>Close</button>
          </div>
          <div className="ppa-preview-body">
            <PublicProjectView projectId={preview} preview />
          </div>
        </div>
      )}
    </div>
  );
}
