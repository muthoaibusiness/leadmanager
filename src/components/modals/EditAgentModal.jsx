import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getProperties, updateAgent } from '../../lib/db.js';
import { rlabel } from '../../lib/helpers.js';

// Team Lead edits an agent: name, phone, and which projects they may deal on
// ('ALL' or a selected set). Initial/Meeting agents then work only those projects.
export default function EditAgentModal() {
  const { modal, closeModal, editUser, refreshDB, showToast } = useApp();
  const isOpen = modal === 'edit-agent';
  const a = editUser;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState(() => new Set());

  useEffect(() => {
    if (isOpen && a) {
      setName(a.name || '');
      setPhone(a.phone || '');
      setAll(a.projects === 'ALL');
      setSel(new Set(Array.isArray(a.projects) ? a.projects : []));
    }
  }, [isOpen, a]);

  if (!isOpen || !a) return <div className={`mov${isOpen ? ' on' : ''}`} onClick={closeModal} />;

  const projects = getProperties();
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = () => {
    updateAgent(a.id, { name: name.trim() || a.name, phone: phone.trim(), projects: all ? 'ALL' : [...sel] });
    refreshDB();
    closeModal();
    showToast('Agent updated', 'ok');
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
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={save}><Mi>save</Mi>Save changes</button>
        </div>
      </div>
    </div>
  );
}
