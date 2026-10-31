import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import { getProperties, updateProfile } from '../../lib/db.js';
import { setFeatures, setProjects, setProfile } from '../../lib/accessAdmin.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES, canManageUser, initialFeatures } from '../../lib/constants.js';
import FeatureEditor from '../FeatureEditor.jsx';

// Team Lead edits an agent's projects. Admins (Management/Master) additionally get a
// per-user Feature Access checklist that overrides the role's default feature set.
export default function EditAgentModal() {
  const { modal, closeModal, user, editUser, refreshDB, showToast } = useApp();
  const isOpen = modal === 'edit-agent';
  const a = editUser;

  // Same rule the access-admin function applies (access-rules.js).
  const isAdmin = !!a && canManageUser(user, a) && a.id !== user?.id;
  const [busy, setBusy] = useState(false);
  const showProjects = a && (a.role === ROLES.AGENT || a.role === ROLES.MA);

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
    setSel(new Set(Array.isArray(a.projects) ? a.projects : []));
    setFeat(initialFeatures(a));
  }

  if (!isOpen || !a) return <div className={`mov${isOpen ? ' on' : ''}`} onClick={closeModal} />;

  const projects = getProperties();
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleFeat = (k) => setFeat(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
      const next = all ? 'ALL' : [...sel];
      if (JSON.stringify(next) !== JSON.stringify(a.projects ?? [])) await run(setProjects(a.id, next));
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
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Edit {a.name} · <span style={{ color: 'var(--t3)', fontWeight: 600 }}>{rlabel(a.role)}</span></div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fl"><label>Name</label><input className="finp" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fl"><label>Phone</label><input className="finp" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+880 1XXX-XXXXXX" /></div>

          {showProjects && (
            <div className="fl">
              <div className="ea-row">
                <label style={{ margin: 0 }}>Assigned projects</label>
                <button className={`ea-all${all ? ' on' : ''}`} onClick={() => setAll(v => !v)}>
                  <Mi>{all ? 'check_box' : 'check_box_outline_blank'}</Mi>All projects
                </button>
              </div>
              {all ? (
                <div className="ea-count">This agent can deal on all {projects.length} projects.</div>
              ) : (
                <>
                  <div className="ea-projs">
                    {projects.map(p => (
                      <button key={p.id} className={`ea-chip${sel.has(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)}>
                        {sel.has(p.id) && <Mi>check</Mi>}{p.name}
                      </button>
                    ))}
                    {!projects.length && <div className="cl-none">No projects in catalog.</div>}
                  </div>
                  <div className="ea-count">{sel.size} of {projects.length} selected</div>
                </>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="fl">
              <div className="ea-row">
                <label style={{ margin: 0 }}>Feature access</label>
                <span className="ea-count" style={{ margin: 0 }}>{feat.size} enabled</span>
              </div>
              <FeatureEditor value={feat} onToggle={toggleFeat} role={a.role} disabled={busy} />
            </div>
          )}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={save} disabled={busy}><Mi>save</Mi>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
