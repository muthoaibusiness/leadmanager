import { useState, useEffect, useRef, useId } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import { setFollowUpAt, getLead, getDB, getActs, addNote, isAgentNote, nextFollowupFor } from '../../lib/db.js';
import { fmtDT } from '../../lib/helpers.js';
import { companyTimeZone, zonedToUtcIso, utcIsoToZoned, isPast } from '../../lib/companyTime.js';
import { hasColumn } from '../../lib/supabase.js';

// The field holds a wall-clock time in the COMPANY's time zone (Dhaka by
// default), not the browser's: a time the customer named must not shift
// because the agent's laptop is set to another zone.
const DAY = 86_400_000;
// A wall-clock date `days` from today in `tz` (as a YYYY-MM-DD value).
function zonedDate(tz, days = 0) {
  return utcIsoToZoned(new Date(Date.now() + days * DAY).toISOString(), tz).slice(0, 10);
}
const fmtIn = (iso, tz, long) => new Date(iso).toLocaleString('en-GB', long
  ? { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }
  : { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function FollowUpModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const uid = useId(); // field ids, so each <label htmlFor> points at its field
  const isOpen = modal === 'follow-up';
  const tz = companyTimeZone(getDB().companies?.find(c => c.id === user?.companyId));
  const [date, setDate] = useState(() => zonedDate(tz, 1));
  const [time, setTime] = useState('10:00');
  const [customerAsked, setCustomerAsked] = useState(false);
  const [note, setNote] = useState('');
  const [newNote, setNewNote] = useState('');
  const [showAllNotes, setShowAllNotes] = useState(false);
  const dateRef = useRef(null);

  if (useChanged(isOpen) && isOpen) { setDate(zonedDate(tz, 1)); setTime('10:00'); setCustomerAsked(false); setNote(''); setNewNote(''); setShowAllNotes(false); }
  // Mounted while closed, so autoFocus would grab focus on page load into a
  // hidden field. Focus the date field when the modal opens instead.
  useEffect(() => { if (isOpen) dateRef.current?.focus(); }, [isOpen]);
  // Before migration 0049 the column is missing and sbUpdate would drop it
  // silently, so the "customer asked" promise is not offered until it exists.
  const [has0049, setHas0049] = useState(false);
  useEffect(() => {
    let live = true;
    hasColumn('leads', 'followup_not_before', 'Customer-requested follow-up times are hidden. Apply supabase/migrations/0049_followup_rules.sql.')
      .then(ok => { if (live) setHas0049(ok); });
    return () => { live = false; };
  }, []);

  const when = date && time ? `${date}T${time}` : '';
  const iso = zonedToUtcIso(when, tz);
  const lead = getLead(panLead);
  // Where the follow-up will actually land: never before an earlier customer request.
  const landsAt = iso ? (customerAsked ? iso : nextFollowupFor(lead, iso)) : null;
  const movedLater = !!(iso && landsAt && landsAt !== iso);

  const sharedNotes = (getActs(panLead) || []).filter(isAgentNote);
  const visibleNotes = showAllNotes ? sharedNotes : sharedNotes.slice(0, 3);

  const addSharedNote = () => {
    const t = newNote.trim();
    if (!t) return;
    addNote(panLead, t, user);
    setNewNote('');
    refreshDB();
  };

  const submit = () => {
    // A closing modal can still take a key press during its fade-out; a second
    // Enter must not set the follow-up twice.
    if (!isOpen) return;
    if (!when) { showToast('Pick a date & time', 'err'); return; }
    if (!iso) { showToast('Invalid date & time', 'err'); return; }
    if (isPast(iso)) { showToast('That time has passed. Pick a later one.', 'err'); return; }
    setFollowUpAt(panLead, iso, user, { customerRequested: has0049 && customerAsked });
    // The note is optional: scheduling works without one. Saved through the same
    // addNote path as Lead Actions > Add Note, so no extra activities row.
    const t = note.trim();
    if (t) addNote(panLead, t, user);
    closeModal();
    refreshDB();
    showToast('Follow-up set for ' + fmtIn(landsAt, tz, false), 'ok');
  };

  const preview = landsAt ? fmtIn(landsAt, tz, true) : null;
  const tzLabel = tz.split('/').pop().replace(/_/g, ' ');

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Set Follow-up</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="m-hint"><Mi>alarm</Mi>You'll get a reminder, and it appears on the home page task list.</div>
          <div className="fl" style={{ marginTop: '14px' }}> {/* ds-allow-hardcode: pre-existing spacing, no token exists */}
            <label htmlFor={`${uid}date`}>Date ({tzLabel})</label>
            <input id={`${uid}date`} ref={dateRef} className="finp" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="fl">
            <label htmlFor={`${uid}time`}>Time ({tzLabel})</label>
            <input id={`${uid}time`} className="finp" type="time" value={time} onChange={e => setTime(e.target.value)} />
            {preview && <div className="fi-hint">Reminder on {preview}{movedLater ? '. Moved to the time the customer asked for.' : ''}</div>}
          </div>
          {has0049 && (
            <label className="fu-asked">
              <input type="checkbox" checked={customerAsked} onChange={e => setCustomerAsked(e.target.checked)} />
              The customer asked to be contacted at this time. No follow-up will be set earlier.
            </label>
          )}
          <div className="fl">
            <label htmlFor={`${uid}note`}>Note (optional)</label>
            <textarea id={`${uid}note`} className="fi" rows={3} placeholder="Anything worth remembering about this follow-up..." value={note} onChange={e => setNote(e.target.value)} />
          </div>
          {/* Shared Lead Notes: the same activities notes the lead panel shows.
              A note here and Add Note both write through addNote. */}
          <div className="fl">
            <label>Shared Lead Notes</label>
            {!sharedNotes.length && <div className="fi-hint">No shared notes yet.</div>}
            {visibleNotes.map(n => (
              <div key={n.id} className="fi-hint">
                <b>{fmtDT(n.timestamp)}</b> {n.userName ? '· ' + n.userName + ' · ' : ''}{n.description}
              </div>
            ))}
            {sharedNotes.length > 3 && (
              <button type="button" className="btn btn-g btn-sm" onClick={() => setShowAllNotes(v => !v)}>
                {showAllNotes ? 'Show fewer notes' : `View all notes (${sharedNotes.length})`}
              </button>
            )}
            <input
              className="finp" type="text" placeholder="Add a new shared note…" value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSharedNote(); } }}
            />
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-warn" disabled={!when} onClick={submit}>
            <Mi>alarm</Mi>Save
          </button>
        </div>
      </div>
    </div>
  );
}
