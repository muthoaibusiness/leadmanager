import { useState, useEffect, useRef, useId } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import { saveFollowUp, completeFollowUp, cancelFollowUp, getLead, getDB, nextFollowupFor } from '../../lib/db.js';
import { companyTimeZone, zonedToUtcIso, utcIsoToZoned, isPast } from '../../lib/companyTime.js';
import { hasColumn } from '../../lib/supabase.js';
import { fetchPending, pendingFor, followupLine } from '../../lib/followups.js';
import { FU_TYPES, FU_PURPOSES, REMIND_OPTIONS, DEFAULT_REMIND_MIN } from '../../lib/followupTypes.js';
import { useProjectToast } from '../project/projectToast.js';
import useDiscardGuard from '../../hooks/useDiscardGuard.js';
import { toastMsg } from '../../lib/toastMap.js';
import { followupDirty } from '../../lib/followupDirty.js';
import { Select, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';

// "Setup next follow-up", kept to the minimum: type, date + time, reminder and
// purpose (free text only for Other). When the lead already has a pending
// follow-up it is shown on top with Mark done / Cancel; saving the form replaces
// it (a reschedule).
//
// Times are wall-clock in the COMPANY's time zone (Dhaka by default), not the
// browser's: a time the customer named must not shift with the laptop's zone.
const DAY = 86_400_000;
const zonedDate = (tz, days = 0) => utcIsoToZoned(new Date(Date.now() + days * DAY).toISOString(), tz).slice(0, 10);
const fmtIn = (iso, tz) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function FollowUpModal() {
  const { modal, closeModal, user, panLead, refreshDB } = useApp();
  const toast = useProjectToast({ always: true });
  const uid = useId();
  const isOpen = modal === 'follow-up';
  const tz = companyTimeZone(getDB().companies?.find(c => c.id === user?.companyId));
  const lead = getLead(panLead);

  const fresh = () => ({ type: 'CALL', date: zonedDate(tz, 1), time: '10:00', remindMin: DEFAULT_REMIND_MIN, purpose: '', purposeOther: '', outcome: '' });
  const [f, setF] = useState(fresh);
  const [start, setStart] = useState(fresh); // what the form opened with, for the dirty check
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const [customerAsked, setCustomerAsked] = useState(false);
  const [pend, setPend] = useState(null);
  const [mode, setMode] = useState('set'); // 'set' | 'done'
  const [alsoNext, setAlsoNext] = useState(true);
  const [busy, setBusy] = useState(false);
  const dateRef = useRef(null);

  if (useChanged(isOpen) && isOpen) {
    const s = fresh();
    setF(s); setStart(s); setCustomerAsked(false);
    setPend(pendingFor(panLead)); setMode('set'); setAlsoNext(true); setBusy(false);
  }

  // Load the pending follow-up and prefill the form from it (a reschedule keeps
  // what it was about; a missed time is not offered again).
  useEffect(() => {
    if (!isOpen || !panLead) return undefined;
    let live = true;
    fetchPending([panLead], { force: true }).then(() => {
      if (!live) return;
      const p = pendingFor(panLead);
      setPend(p);
      if (p) {
        const at = utcIsoToZoned(p.dueAt, tz);
        const s = {
          ...fresh(), type: p.type || 'CALL', remindMin: p.remindMin ?? DEFAULT_REMIND_MIN,
          purpose: p.purpose || '', purposeOther: p.purposeOther || '',
          ...(isPast(p.dueAt) ? {} : { date: at.slice(0, 10), time: at.slice(11, 16) }),
        };
        setF(s); setStart(s);
      }
    });
    return () => { live = false; };
  }, [isOpen, panLead]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per opening

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

  const when = f.date && f.time ? `${f.date}T${f.time}` : '';
  const iso = zonedToUtcIso(when, tz);
  const landsAt = iso ? (customerAsked ? iso : nextFollowupFor(lead, iso)) : null;
  const movedLater = !!(iso && landsAt && landsAt !== iso);
  const detail = () => ({
    dueAt: iso, type: f.type, remindMin: Number(f.remindMin),
    purpose: f.purpose || null, purposeOther: f.purpose === 'OTHER' ? f.purposeOther.trim() : '',
  });

  const dirty = () => isOpen && followupDirty({ ...f, customerAsked }, { ...start, defDate: start.date, defTime: start.time });
  const g = useDiscardGuard({
    isOpen, isDirty: dirty, onClose: closeModal,
    ask: { title: 'Discard follow-up?', description: 'Your unsaved follow-up details will be lost.' },
  });

  // The form's own checks; null when it can be saved.
  const formError = () => {
    if (!when) return 'Pick a date & time';
    if (!iso) return 'Invalid date & time';
    if (isPast(iso)) return 'That time has passed. Pick a later one.';
    if (f.purpose === 'OTHER' && !f.purposeOther.trim()) return 'Write the purpose';
    return null;
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); closeModal(); refreshDB(); toastMsg(toast, okMsg, 'ok'); }
    catch (e) { console.warn('follow-up save failed', e); toastMsg(toast, 'Not saved. Try again.', 'err'); }
    finally { setBusy(false); }
  };

  const submit = () => {
    // A closing modal can still take a key press during its fade-out.
    if (!isOpen || busy) return;
    if (mode === 'done') {
      const err = alsoNext ? formError() : null;
      if (err) { toastMsg(toast, err, 'err'); return; }
      run(() => completeFollowUp(panLead, { outcome: f.outcome.trim(), next: alsoNext ? detail() : null }, user),
        alsoNext ? 'Done. Next follow-up ' + fmtIn(landsAt, tz) : 'Follow-up marked done');
      return;
    }
    const err = formError();
    if (err) { toastMsg(toast, err, 'err'); return; }
    run(async () => {
      const at = await saveFollowUp(panLead, detail(), user, { customerRequested: has0049 && customerAsked });
      if (!at) throw new Error('follow-ups are off for this lead');
    }, 'Follow-up set for ' + fmtIn(landsAt, tz));
  };

  const cancelPending = () => {
    if (busy) return;
    run(() => cancelFollowUp(panLead, '', user), 'Follow-up cancelled');
  };

  const showForm = mode === 'set' || alsoNext;
  const remind = REMIND_OPTIONS.find((o) => o.min === Number(f.remindMin));
  const dayText = landsAt ? new Date(landsAt).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const timeText = landsAt ? new Date(landsAt).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : '';
  const title = pend ? (mode === 'done' ? 'Complete follow-up' : 'Reschedule follow-up') : 'Setup next follow-up';

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} {...g.backdropProps}>
      <div className="modal fu2" {...g.modalProps}>
        <div className="fu2-hd">
          <span className="fu2-badge" aria-hidden="true"><Mi>{mode === 'done' ? 'task_alt' : 'alarm'}</Mi></span>
          <div className="fu2-hd-txt">
            <div className="fu2-ttl">{title}</div>
            {lead && <div className="fu2-sub">{[lead.name, lead.phone].filter(Boolean).join(' · ')}</div>}
          </div>
          <button className="m-x" aria-label="Close" onClick={g.requestClose}><Mi>close</Mi></button>
        </div>

        <div className="fu2-body">
          {pend && (
            <div className="fu2-pend">
              <div className="fu2-pend-top">
                <Mi>event_upcoming</Mi>
                <div className="fu2-pend-info">
                  <b>{fmtIn(pend.dueAt, tz)}{isPast(pend.dueAt) && <span className="fu2-late">Missed</span>}</b>
                  <span>{followupLine(pend) || 'Follow-up'}</span>
                </div>
              </div>
              {mode === 'set' ? (
                <div className="fu2-pend-act">
                  <button type="button" className="fu2-pill ok" onClick={() => setMode('done')}><Mi>check</Mi>Mark done</button>
                  <button type="button" className="fu2-pill" onClick={cancelPending} disabled={busy}><Mi>event_busy</Mi>Cancel it</button>
                </div>
              ) : (
                <div className="fu2-done">
                  <input className="fu2-input" type="text" aria-label="What happened (optional)" placeholder="What happened? (optional)" value={f.outcome} onChange={(e) => set('outcome', e.target.value)} />
                  <label className="fu2-check">
                    <input type="checkbox" checked={alsoNext} onChange={(e) => setAlsoNext(e.target.checked)} />
                    <span>Schedule the next follow-up now</span>
                  </label>
                  <button type="button" className="fu2-link" onClick={() => setMode('set')}><Mi>arrow_back</Mi>Back</button>
                </div>
              )}
            </div>
          )}

          {showForm && (
            <>
              <div className="fu2-sec">
                <span className="fu2-lbl" id={`${uid}type`}>Type</span>
                <div className="fu2-types" role="radiogroup" aria-labelledby={`${uid}type`}>
                  {FU_TYPES.map((t) => (
                    <button key={t.code} type="button" role="radio" aria-checked={f.type === t.code} className={`fu2-type${f.type === t.code ? ' on' : ''}`} onClick={() => set('type', t.code)}>
                      <span className="fu2-type-ico"><Mi>{t.icon}</Mi></span>
                      <span className="fu2-type-lbl">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="fu2-grid">
                <label className="fu2-field" htmlFor={`${uid}date`}>
                  <span className="fu2-lbl">Date</span>
                  <span className="fu2-box"><Mi>calendar_month</Mi>
                    <input id={`${uid}date`} ref={dateRef} type="date" value={f.date} min={zonedDate(tz, 0)} onChange={(e) => set('date', e.target.value)} />
                  </span>
                </label>
                <label className="fu2-field" htmlFor={`${uid}time`}>
                  <span className="fu2-lbl">Time</span>
                  <span className="fu2-box"><Mi>schedule</Mi>
                    <input id={`${uid}time`} type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
                  </span>
                </label>

                <div className="fu2-field">
                  <span className="fu2-lbl">Reminder</span>
                  <Select className="fu2-sel" value={String(f.remindMin)} onChange={(v) => set('remindMin', Number(v))}>
                    <SelectTrigger aria-label="Reminder"><SelectValue /></SelectTrigger>
                    <SelectPopover><SelectListBox>
                      {REMIND_OPTIONS.map((o) => (
                        <SelectItem key={o.min} value={String(o.min)}><span className="fu2-opt"><Mi>{o.icon}</Mi>{o.label}</span></SelectItem>
                      ))}
                    </SelectListBox></SelectPopover>
                  </Select>
                </div>
                <div className="fu2-field">
                  <span className="fu2-lbl">Purpose</span>
                  <Select className="fu2-sel" value={f.purpose} onChange={(v) => set('purpose', v)} placeholder="Choose a purpose">
                    <SelectTrigger aria-label="Purpose"><SelectValue /></SelectTrigger>
                    <SelectPopover><SelectListBox>
                      {FU_PURPOSES.map((p) => (
                        <SelectItem key={p.code} value={p.code}><span className="fu2-opt"><Mi>{p.icon}</Mi>{p.label}</span></SelectItem>
                      ))}
                    </SelectListBox></SelectPopover>
                  </Select>
                </div>
              </div>

              {f.purpose === 'OTHER' && (
                <input className="fu2-input" type="text" maxLength={80} placeholder="Write the purpose" aria-label="Purpose text" value={f.purposeOther} onChange={(e) => set('purposeOther', e.target.value)} />
              )}

              {landsAt && (
                <div className="fu2-sum">
                  <span className="fu2-sum-ico"><Mi>event_available</Mi></span>
                  <div className="fu2-sum-txt">
                    <b>{dayText} · {timeText}</b>
                    <span>{movedLater ? 'Moved to the time the customer asked for · ' : ''}{remind ? 'Reminder ' + remind.label.toLowerCase() : ''}</span>
                  </div>
                </div>
              )}

              {has0049 && (
                <label className="fu2-check">
                  <input type="checkbox" checked={customerAsked} onChange={(e) => setCustomerAsked(e.target.checked)} />
                  <span>The customer asked for this time</span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="fu2-ft">
          <button className="fu2-btn ghost" onClick={g.requestClose}>Close</button>
          <button className="fu2-btn primary" disabled={busy || (showForm && !when)} onClick={submit}>
            <Mi>{mode === 'done' ? 'task_alt' : 'alarm'}</Mi>{mode === 'done' ? (alsoNext ? 'Done & schedule' : 'Mark done') : pend ? 'Reschedule' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
