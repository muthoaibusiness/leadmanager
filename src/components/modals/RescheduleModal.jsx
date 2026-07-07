import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLead, rescheduleMeeting } from '../../lib/db.js';

const HOURS = { ONLINE: { min: 10, max: 22, label: '10 AM – 10 PM' }, OFFLINE: { min: 10, max: 18, label: '10 AM – 6 PM' } };

// ISO → 'YYYY-MM-DDTHH:mm' in local time for a datetime-local input.
const toLocalInput = (iso) => {
  const d = new Date(iso); const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
};

export default function RescheduleModal() {
  const { modal, closeModal, panLead, user, refreshDB, showToast } = useApp();
  const isOpen = modal === 'reschedule';
  const lead = panLead ? getLead(panLead) : null;

  const [type, setType] = useState('ONLINE');
  const [at, setAt] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    if (isOpen && lead) {
      setType(lead.meetingType === 'OFFLINE' ? 'OFFLINE' : 'ONLINE');
      setAt(lead.meetingAt ? toLocalInput(lead.meetingAt) : '');
      setLink(lead.meetingLink || '');
    }
  }, [isOpen, panLead]);

  const save = () => {
    if (!at) { showToast('Pick a new date & time', 'err'); return; }
    const d = new Date(at); const h = d.getHours() + d.getMinutes() / 60; const w = HOURS[type];
    if (h < w.min || h > w.max) { showToast(`${type === 'ONLINE' ? 'Online' : 'Offline'} meetings must be within ${w.label}`, 'err'); return; }
    if (type === 'ONLINE' && !link.trim()) { showToast('Add the online meeting link', 'err'); return; }
    rescheduleMeeting(panLead, new Date(at).toISOString(), user, type === 'ONLINE' ? link.trim() : '', type);
    closeModal(); refreshDB(); showToast(lead.meetingAt ? 'Meeting rescheduled' : 'Meeting time set', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Reschedule Meeting</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        {isOpen && lead && (
          <>
            <div className="m-body">
              <div className="m-hint" style={{ marginBottom: '14px' }}>
                <Mi>event_repeat</Mi>{lead.meetingAt ? <>Shift <strong>{lead.name}</strong>'s meeting to a new time or day.</> : <>Set the meeting time for <strong>{lead.name}</strong>.</>}
              </div>
              <div className="fl">
                <label>Meeting type</label>
                <div className="seg">
                  <button type="button" className={`seg-b${type === 'ONLINE' ? ' on' : ''}`} onClick={() => setType('ONLINE')}><Mi>videocam</Mi>Online</button>
                  <button type="button" className={`seg-b${type === 'OFFLINE' ? ' on' : ''}`} onClick={() => setType('OFFLINE')}><Mi>store</Mi>Offline</button>
                </div>
              </div>
              <div className="fl">
                <label>New meeting time</label>
                <input className="finp" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />
                <div className="fi-hint"><Mi>schedule</Mi>Within working hours · {HOURS[type].label}</div>
              </div>
              {type === 'ONLINE' && (
                <div className="fl">
                  <label>Meeting link</label>
                  <input className="finp" type="url" placeholder="https://meet.google.com/…" value={link} onChange={e => setLink(e.target.value)} />
                </div>
              )}
            </div>
            <div className="m-ft">
              <button className="btn btn-g" onClick={closeModal}>Cancel</button>
              <button className="btn btn-p" onClick={save}>Save change</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
