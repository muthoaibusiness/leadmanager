import { useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { updLead, addAct, getLead } from '../lib/db.js';

// Shared call-duration tracker — single source of truth used by Leads (LeadPanel)
// and Contacts (ClientsView) so the UX stays identical everywhere.
const PRESETS = [1, 3, 5, 10, 15, 30];

export default function LogCall({ leadId, triggerClassName = 'btn btn-full', triggerStyle, triggerLabel = 'Log Call' }) {
  const { user, refreshDB, showToast } = useApp();
  const [open, setOpen] = useState(false);

  const log = (mins) => {
    const secs = Math.round(mins * 60);
    const lead = getLead(leadId);
    const total = (lead?.callCount || 0) + 1;
    updLead(leadId, { callCount: total });
    addAct(leadId, {
      type: 'CALL',
      description: 'Call logged · ' + mins + ' min (total: ' + total + ')',
      userId: user.id, userName: user.name, durationSeconds: secs,
    });
    refreshDB();
    showToast('Call logged · ' + mins + ' min', 'ok');
    setOpen(false);
  };

  return (
    <div className="logcall">
      <button className={triggerClassName} style={triggerStyle} onClick={() => setOpen(v => !v)}>
        <Mi>call</Mi>{triggerLabel}
      </button>
      {open && (
        <div className="logcall-pop">
          <div className="logcall-hd">
            <span>Call duration</span>
            <button className="logcall-x" onClick={() => setOpen(false)}><Mi>close</Mi></button>
          </div>
          <div className="logcall-chips">
            {PRESETS.map(m => (
              <button key={m} className="logcall-chip" onClick={() => log(m)}>{m} min</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
