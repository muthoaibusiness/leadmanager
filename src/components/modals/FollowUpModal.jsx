import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { setFollowUpAt } from '../../lib/db.js';

// Format a Date as the local value a datetime-local input expects (no timezone).
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Default suggestion: tomorrow at 10:00.
function defaultWhen() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  return toLocalInput(d);
}

export default function FollowUpModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isOpen = modal === 'follow-up';
  const [when, setWhen] = useState(defaultWhen);

  useEffect(() => { if (isOpen) setWhen(defaultWhen()); }, [isOpen]);

  // Quick presets fill the date+time field.
  const presets = [
    { lbl: 'In 1 hour', make: () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; } },
    { lbl: 'Today 5 PM', make: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; } },
    { lbl: 'Tomorrow 10 AM', make: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; } },
    { lbl: 'In 3 days', make: () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(10, 0, 0, 0); return d; } },
    { lbl: 'Next week', make: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; } },
  ];

  const submit = () => {
    if (!when) { showToast('Pick a date & time', 'err'); return; }
    const d = new Date(when);
    if (isNaN(d.getTime())) { showToast('Invalid date & time', 'err'); return; }
    setFollowUpAt(panLead, d.toISOString(), user);
    closeModal();
    refreshDB();
    showToast('Follow-up set for ' + d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), 'ok');
  };

  const preview = when && !isNaN(new Date(when).getTime())
    ? new Date(when).toLocaleString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Set Follow-up</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="m-hint"><Mi>alarm</Mi>You'll get a reminder, and it appears on the home page task list.</div>
          <div className="fl" style={{ marginTop: '14px' }}>
            <label>Follow-up date &amp; time</label>
            <input className="finp" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} autoFocus />
            {preview && <div className="fi-hint">Reminder on {preview}</div>}
          </div>
          <div className="fu-presets">
            {presets.map(p => (
              <button key={p.lbl} className="fu-chip" onClick={() => setWhen(toLocalInput(p.make()))}>{p.lbl}</button>
            ))}
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-warn" disabled={!when} onClick={submit}>
            <Mi>alarm</Mi>Set Follow-up
          </button>
        </div>
      </div>
    </div>
  );
}
