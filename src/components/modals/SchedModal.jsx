import { useRef } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { schedVisit } from '../../lib/db.js';

export default function SchedModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'sched';
  const dtRef = useRef();
  const locRef = useRef();

  const submit = () => {
    const dt = dtRef.current.value;
    const loc = locRef.current.value.trim();
    if (!dt) { showToast('Please select a date', 'err'); return; }
    schedVisit(panLead, new Date(dt).toISOString(), loc, user);
    closeModal();
    refreshDB();
    showToast('Site visit scheduled', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Schedule Site Visit</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg"><label>Date &amp; Time</label><input className="fi" ref={dtRef} type="datetime-local" /></div>
          <div className="fg"><label>Location / Meeting Link</label><input className="fi" ref={locRef} type="text" placeholder="e.g. Plot 12, Block C, Bashundhara R/A" /></div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-teal" onClick={submit}><Mi>calendar_month</Mi>Schedule</button>
        </div>
      </div>
    </div>
  );
}
