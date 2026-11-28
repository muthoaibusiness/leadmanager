import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import { getProperties, updateProfile } from '../../lib/db.js';
import { setFeatures, setProjects, setProfile } from '../../lib/accessAdmin.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES, canManageUser, initialFeatures } from '../../lib/constants.js';
import { planProjects, projectsFor } from '../../lib/projects.js';
import FeatureEditor from '../FeatureEditor.jsx';
import '../booking/ShopBooking.css';
import '../project/AddPropertyWizard.css';
import '../views/AccountsView.css';

// The projects the account sees right now (its saved list, or the first-3 default), ticked
// when the panel opens.
const shownIds = (a) => projectsFor({ role: a.role, projects: a.projects }, planProjects()).map(p => p.id);

// Edit an account, in the Booking page's look. A Team Lead edits an agent's projects. Admins
// (Management/Master) additionally get a per-user Feature Access checklist that overrides the
// role's default feature set.
export default function EditAgentModal() {
  const { modal, closeModal, user, editUser, refreshDB, showToast } = useApp();
  const isOpen = modal === 'edit-agent';
  const a = editUser;

  // Same rule the access-admin function applies (access-rules.js).
  const isAdmin = !!a && canManageUser(user, a) && a.id !== user?.id;
  const [busy, setBusy] = useState(false);
  // Which projects the account sees (projectsFor in lib/projects.js). Admins always see every project.
  const showProjects = a && a.role !== ROLES.MGMT && a.role !== ROLES.MASTER;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [feat, setFeat] = useState(() => new Set());

  // `a` is the user object held in context, so its identity is stable until
  // the account is edited or swapped.
  if (useChanged(isOpen ? a : null) && isOpen && a) {
    setName(a.name || '');
    setPhone(a.phone || '');
    setAll(a.projects === 'ALL');
    setSel(new Set(shownIds(a)));
    setFeat(initialFeatures(a));
  }

  if (!isOpen || !a) return null;

  const projects = getProperties();
  const toggle = (id) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleFeat = (k) => setFeat(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Each part is saved through its own path and reported truthfully: name and
  // phone as a profile edit (own row) or by an account manager, projects and
  // features through the access-admin function. The modal stays open on error.
  const save = async () => {
    setBusy(true);
    const errors = [];
    const run = async (p) => { const r = await p; if (!r.ok) errors.push(r.error); };
    const nm = name.trim() || a.name;
    if (nm !== a.name || phone.trim() !== (a.phone || '')) {
      await run(a.id === user?.id ? updateProfile(a.id, { name: nm, phone: phone.trim() }) : setProfile(a.id, { name: nm, phone: phone.trim() }));
    }
    if (showProjects) {
      // Saved only when changed from what the panel opened with, so opening and saving an
      // account that runs on the first-3 default does not freeze that default into a list.
      const next = all ? 'ALL' : [...sel];
      const before = a.projects === 'ALL' ? 'ALL' : shownIds(a);
      const same = next === before || (Array.isArray(next) && Array.isArray(before) && next.length === before.length && next.every(id => before.includes(id)));
      if (!same) await run(setProjects(a.id, next));
    }
    if (isAdmin) {
      const before = initialFeatures(a);
      const changed = before.size !== feat.size || [...feat].some(k => !before.has(k));
      if (changed) await run(setFeatures(a.id, [...feat]));
    }
    setBusy(false);
    refreshDB();
    if (errors.length) { showToast(errors[0], 'err'); return; }
    closeModal();
    showToast('User updated', 'ok');
  };

  return (
    <div className="pw-scrim" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="bk acx-modal" role="dialog" aria-modal="true" aria-labelledby="eam-t">
        <header className="pw-head">
          <div className="acx-mt"><span className="bk-eyebrow">Edit account</span><h3 id="eam-t">{a.name}</h3></div>
          <span className={`acx-role t-${{ MANAGEMENT: 'mgmt', TEAM_LEAD: 'tl', EXECUTIVE: 'exec' }[a.role] || 'agent'}`}><i aria-hidden="true" />{rlabel(a.role)}</span>
          <button type="button" className="bk-close" aria-label="Close" onClick={closeModal}><Mi>close</Mi></button>
        </header>

        <div className="pw-body">
          <div className="pw-grid">
            <label className="pw-f"><span className="bk-cap">Name</span><input value={name} onChange={e => setName(e.target.value)} /></label>
            <label className="pw-f"><span className="bk-cap">Phone</span><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+880 1XXX-XXXXXX" /></label>
          </div>

          {showProjects && (
            <div className="acp-feat">
              <div className="acp-feat-h">
                <span className="bk-cap">Assigned projects</span>
                <button type="button" className="bk-chip" aria-pressed={all} onClick={() => setAll(v => !v)}><Mi>{all ? 'check_box' : 'check_box_outline_blank'}</Mi>All projects</button>
              </div>
              {all ? (
                <span className="bk-hint">Sees all {projects.length} projects.</span>
              ) : (
                <>
                  <div className="acx-mates">
                    {projects.map(p => (
                      <button key={p.id} type="button" className="bk-chip" aria-pressed={sel.has(p.id)} onClick={() => toggle(p.id)}>
                        {sel.has(p.id) && <Mi>check</Mi>}{p.name}
                      </button>
                    ))}
                    {!projects.length && <span className="acx-muted">No projects yet.</span>}
                  </div>
                  <span className="bk-cap">{sel.size} of {projects.length} selected</span>
                </>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="acp acp-feat">
              <div className="acp-feat-h">
                <span className="bk-cap">Feature access</span>
                <span className="bk-cap">{feat.size} enabled</span>
              </div>
              <FeatureEditor value={feat} onToggle={toggleFeat} role={a.role} disabled={busy} />
            </div>
          )}
        </div>

        <footer className="pw-foot">
          <span className="bk-cap">{isAdmin ? 'Changes apply on the account’s next request.' : ''}</span>
          <div className="pw-acts">
            <button type="button" className="bk-btn" onClick={closeModal}>Cancel</button>
            <button type="button" className="bk-btn primary" onClick={save} disabled={busy}><Mi>save</Mi>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
