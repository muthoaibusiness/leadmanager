import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getProperties, updateAgent } from '../../lib/db.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES, FEATURE_KEYS, FEATURE_LABELS, defaultFeatures } from '../../lib/constants.js';

// Team Lead edits an agent's projects. Admins (Management/Master) additionally get a
// per-user Feature Access checklist that overrides the role's default feature set.
export default function EditAgentModal() {
  const { modal, closeModal, user, editUser, refreshDB, showToast } = useApp();
  const isOpen = modal === 'edit-agent';
  const a = editUser;

  const isAdmin = user?.role === ROLES.MGMT || user?.role === ROLES.MASTER;
  const showProjects = a && [ROLES.IA, ROLES.MA].includes(a.role);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [feat, setFeat] = useState(() => new Set());

  useEffect(() => {
    if (isOpen && a) {
      setName(a.name || '');
      setPhone(a.phone || '');
      setAll(a.projects === 'ALL');
      setSel(new Set(Array.isArray(a.projects) ? a.projects : []));
      // Pre-fill features: saved custom list, else the role's defaults (Executive = none).
      setFeat(new Set(Array.isArray(a.allowedFeatures) ? a.allowedFeatures : defaultFeatures(a.role)));
    }
  }, [isOpen, a]);

  if (!isOpen || !a) return <div className={`mov${isOpen ? ' on' : ''}`} onClick={closeModal} />;

  const projects = getProperties();
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleFeat = (k) => setFeat(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const save = () => {
    const fields = { name: name.trim() || a.name, phone: phone.trim() };
    if (showProjects) fields.projects = all ? 'ALL' : [...sel];
    if (isAdmin) fields.allowedFeatures = [...feat];
    updateAgent(a.id, fields);
    refreshDB();
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
              <div className="feat-grid">
                {FEATURE_KEYS.map(k => (
                  <button key={k} className={`feat-chip${feat.has(k) ? ' on' : ''}`} onClick={() => toggleFeat(k)}>
                    <Mi>{feat.has(k) ? 'check_box' : 'check_box_outline_blank'}</Mi>{FEATURE_LABELS[k] || k}
                  </button>
                ))}
              </div>
              <div className="ea-count">{a.role === ROLES.EXEC ? 'Executive — no defaults; grant features explicitly.' : 'Pre-filled with role defaults. Check to grant, uncheck to restrict.'}</div>
            </div>
          )}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={save}><Mi>save</Mi>Save changes</button>
        </div>
      </div>
    </div>
  );
}
