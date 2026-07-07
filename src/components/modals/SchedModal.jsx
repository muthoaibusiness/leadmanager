import { useRef, useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { schedVisit, getProperties, getLead } from '../../lib/db.js';

export default function SchedModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'sched';
  const dtRef = useRef();
  const locRef = useRef();
  const [picked, setPicked] = useState([]); // [{ id, name }]

  const lead = panLead ? getLead(panLead) : null;
  const projects = [...getProperties()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Default to the projects the agent last entered for this lead.
  useEffect(() => {
    if (isOpen) {
      const prev = lead?.visitProjects;
      setPicked(Array.isArray(prev) ? prev.map(p => ({ id: p.id, name: p.name })) : []);
    }
  }, [isOpen, panLead]);

  const addProject = (id) => {
    if (!id) return;
    const p = projects.find(x => x.id === id);
    if (p && !picked.some(x => x.id === id)) setPicked(s => [...s, { id: p.id, name: p.name }]);
  };
  const removeProject = (id) => setPicked(s => s.filter(x => x.id !== id));

  const submit = () => {
    const dt = dtRef.current.value;
    const loc = locRef.current.value.trim();
    if (!dt) { showToast('Please select a date', 'err'); return; }
    if (!picked.length) { showToast('Pick at least one project', 'err'); return; }
    schedVisit(panLead, new Date(dt).toISOString(), loc, user, picked);
    closeModal();
    refreshDB();
    showToast('Site visit scheduled', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Schedule Site Visit{lead ? ' · ' + (lead.name || 'Client') : ''}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg"><label>Date &amp; Time</label><input className="fi" ref={dtRef} type="datetime-local" /></div>

          <div className="fg">
            <label>Project(s) to visit</label>
            <select className="fi" value="" onChange={e => { addProject(e.target.value); e.target.value = ''; }}>
              <option value="">— Add a project —</option>
              {projects.filter(p => !picked.some(x => x.id === p.id)).map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.area ? ' · ' + p.area : ''}</option>
              ))}
            </select>
            {picked.length > 0 && (
              <div className="proj-chips">
                {picked.map(p => (
                  <span key={p.id} className="proj-chip">
                    {p.name}
                    <button type="button" onClick={() => removeProject(p.id)} title="Remove"><Mi>close</Mi></button>
                  </span>
                ))}
              </div>
            )}
            {projects.length === 0 && <div className="fi-hint">No projects in the catalog yet — add them on the Projects page.</div>}
          </div>

          <div className="fg"><label>Location</label><input className="fi" ref={locRef} type="text" placeholder="e.g. Plot 12, Block C, Bashundhara R/A" /></div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-teal" onClick={submit}><Mi>calendar_month</Mi>Schedule</button>
        </div>
      </div>
    </div>
  );
}
