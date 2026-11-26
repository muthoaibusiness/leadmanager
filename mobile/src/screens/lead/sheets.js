// The lead forms, one bottom sheet each. Every one calls the same db.js writer
// the web modal of the same name calls, with the same arguments and the same
// checks, so a status change made on the phone is logged exactly like one made
// on the web (see "Lead status changes — always logged" in CLAUDE.md).
//
// Each sheet takes { visible, onClose, lead } and reports through useUI().toast.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Field, Row, Segmented, Sheet, T, useUI } from '../../ui';
import DateTimeField, { emptyParts, partsOf, valueOf } from '../../ui/DateTimeField';
import { space } from '../../theme';
import { useApp } from '../../store';
import {
  addNote, addAct, updLead, getLead, getCompany, getProperties,
  saveFollowUp, completeFollowUp, cancelFollowUp, nextFollowupFor,
  setMeeting, rescheduleMeeting, schedVisit, closeDealFn, markLostFn,
} from '../../../../src/lib/db.js';
import { hasColumn } from '../../../../src/lib/supabase.js';
import { pendingFor, fetchPending } from '../../../../src/lib/followups.js';
import { FU_TYPES, FU_PURPOSES, REMIND_OPTIONS, DEFAULT_REMIND_MIN } from '../../../../src/lib/followupTypes.js';
import { companyTimeZone, zonedToUtcIso, utcIsoToZoned, isPast } from '../../../../src/lib/companyTime.js';
import { fmtDT } from '../../../../src/lib/helpers.js';

// ── Note ────────────────────────────────────────────────────────────────────
export function NoteSheet({ visible, onClose, lead }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const [text, setText] = useState('');
  useEffect(() => { if (visible) setText(''); }, [visible]);
  const save = () => {
    const t = text.trim();
    if (!t) { toast('Write the note first', 'err'); return; }
    addNote(lead.id, t, user);
    refresh(); onClose(); toast('Note added');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Add note" footer={<Button label="Save note" icon="edit-note" onPress={save} />}>
      <Field label="Note" value={text} onChangeText={setText} multiline autoFocus placeholder="What happened, what the customer said…" />
    </Sheet>
  );
}

// ── Log call ────────────────────────────────────────────────────────────────
const CALL_MINUTES = [1, 3, 5, 10, 15, 30];
export function LogCallSheet({ visible, onClose, lead }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const log = (mins) => {
    const total = (getLead(lead.id)?.callCount || 0) + 1;
    updLead(lead.id, { callCount: total });
    addAct(lead.id, {
      type: 'CALL', description: 'Call logged · ' + mins + ' min (total: ' + total + ')',
      userId: user.id, userName: user.name, durationSeconds: Math.round(mins * 60),
    });
    refresh(); onClose(); toast('Call logged · ' + mins + ' min');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Call duration">
      <Row wrap>
        {CALL_MINUTES.map((m) => <Button key={m} label={`${m} min`} variant="soft" tone="info" full={false} onPress={() => log(m)} />)}
      </Row>
    </Sheet>
  );
}

// ── Follow-up ───────────────────────────────────────────────────────────────
export function FollowUpSheet({ visible, onClose, lead }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const tz = useMemo(() => companyTimeZone(getCompany(user.companyId)), [user.companyId]);
  const [parts, setParts] = useState(emptyParts);
  const [type, setType] = useState('CALL');
  const [purpose, setPurpose] = useState('');
  const [purposeOther, setPurposeOther] = useState('');
  const [remindMin, setRemindMin] = useState(DEFAULT_REMIND_MIN);
  const [customerAsked, setCustomerAsked] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [pend, setPend] = useState(null);
  const [busy, setBusy] = useState(false);
  const [has0049, setHas0049] = useState(false);

  // Each opening starts clean, then takes over the pending follow-up if there
  // is one (a reschedule keeps what it was about; a missed time is not offered again).
  useEffect(() => {
    if (!visible || !lead) return undefined;
    let live = true;
    setParts(emptyParts); setType('CALL'); setPurpose(''); setPurposeOther(''); setRemindMin(DEFAULT_REMIND_MIN);
    setCustomerAsked(false); setOutcome(''); setBusy(false); setPend(pendingFor(lead.id));
    fetchPending([lead.id], { force: true }).then(() => {
      if (!live) return;
      const p = pendingFor(lead.id);
      setPend(p);
      if (!p) return;
      setType(p.type || 'CALL'); setRemindMin(p.remindMin ?? DEFAULT_REMIND_MIN);
      setPurpose(p.purpose || ''); setPurposeOther(p.purposeOther || '');
      if (!isPast(p.dueAt)) setParts(partsOf(utcIsoToZoned(p.dueAt, tz)));
    });
    hasColumn('leads', 'followup_not_before', '').then((ok) => { if (live) setHas0049(ok); });
    return () => { live = false; };
  }, [visible, lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opening

  const when = valueOf(parts);
  const iso = zonedToUtcIso(when, tz);
  const landsAt = iso ? (customerAsked ? iso : nextFollowupFor(lead, iso)) : null;
  const detail = () => ({ dueAt: iso, type, remindMin: Number(remindMin), purpose: purpose || null, purposeOther: purpose === 'OTHER' ? purposeOther.trim() : '' });
  const formError = () => {
    if (!when) return 'Pick a date and time';
    if (!iso) return 'Invalid date and time';
    if (isPast(iso)) return 'That time has passed. Pick a later one.';
    if (purpose === 'OTHER' && !purposeOther.trim()) return 'Write the purpose';
    return null;
  };
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); refresh(); onClose(); toast(okMsg); }
    catch (e) { console.warn('follow-up save failed', e); toast('Not saved. Try again.', 'err'); }
    finally { setBusy(false); }
  };
  const save = () => {
    const err = formError();
    if (err) { toast(err, 'err'); return; }
    run(async () => {
      const at = await saveFollowUp(lead.id, detail(), user, { customerRequested: has0049 && customerAsked });
      if (!at) throw new Error('follow-ups are off for this lead');
    }, 'Follow-up set for ' + fmtDT(landsAt));
  };
  const done = () => run(() => completeFollowUp(lead.id, { outcome: outcome.trim(), next: null }, user), 'Follow-up marked done');
  const cancel = () => run(() => cancelFollowUp(lead.id, '', user), 'Follow-up cancelled');

  return (
    <Sheet visible={visible} onClose={onClose} title={pend ? 'Follow-up' : 'Set follow-up'}
      footer={<Button label={pend ? 'Reschedule' : 'Set follow-up'} icon="alarm" onPress={save} busy={busy} />}>
      {pend ? (
        <Card>
          <T v="strong">Pending: {fmtDT(pend.dueAt)}</T>
          <Field label="What came of it (optional)" value={outcome} onChangeText={setOutcome} placeholder="Outcome" />
          <Row>
            <View style={{ flex: 1 }}><Button label="Mark done" icon="check" variant="soft" tone="brand" onPress={done} disabled={busy} /></View>
            <View style={{ flex: 1 }}><Button label="Cancel it" icon="close" variant="soft" tone="danger" onPress={cancel} disabled={busy} /></View>
          </Row>
        </Card>
      ) : null}
      <DateTimeField parts={parts} onParts={setParts} />
      {landsAt && landsAt !== iso ? <T v="small" tone="warn">Moves to {fmtDT(landsAt)}: follow-ups keep a gap after an attempt.</T> : null}
      <T v="small" tone="sub" style={{ fontWeight: '600' }}>How</T>
      <Row wrap>{FU_TYPES.map((o) => <Chip key={o.code} label={o.label} icon={o.icon} active={type === o.code} onPress={() => setType(o.code)} />)}</Row>
      <T v="small" tone="sub" style={{ fontWeight: '600' }}>About (optional)</T>
      <Row wrap>{FU_PURPOSES.map((o) => <Chip key={o.code} label={o.label} active={purpose === o.code} onPress={() => setPurpose(purpose === o.code ? '' : o.code)} />)}</Row>
      {purpose === 'OTHER' ? <Field label="Purpose" value={purposeOther} onChangeText={setPurposeOther} placeholder="What is it about?" /> : null}
      <T v="small" tone="sub" style={{ fontWeight: '600' }}>Remind me</T>
      <Row wrap>{REMIND_OPTIONS.map((o) => <Chip key={o.min} label={o.label} active={Number(remindMin) === o.min} onPress={() => setRemindMin(o.min)} />)}</Row>
      {has0049 ? <Chip label="The customer asked for this exact time" icon={customerAsked ? 'check-box' : 'check-box-outline-blank'} active={customerAsked} onPress={() => setCustomerAsked((v) => !v)} /> : null}
    </Sheet>
  );
}

// ── Meeting (set, or reschedule) ────────────────────────────────────────────
// Working-hour windows by meeting type (24h), as on the web.
const HOURS = { ONLINE: { min: 10, max: 22, label: '10 AM – 10 PM' }, OFFLINE: { min: 10, max: 18, label: '10 AM – 6 PM' } };
const SHARED = [
  { key: 'price', label: 'Price idea' }, { key: 'brochure', label: 'Brochure' }, { key: 'floor_plan', label: 'Floor plan' },
  { key: 'video', label: 'Video' }, { key: 'image', label: 'Image' },
];
const toLocalInput = (iso) => {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function MeetingSheet({ visible, onClose, lead, reschedule = false }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const [type, setType] = useState('ONLINE');
  const [parts, setParts] = useState(emptyParts);
  const [link, setLink] = useState('');
  const [shared, setShared] = useState([]);
  useEffect(() => {
    if (!visible || !lead) return;
    setType(reschedule && lead.meetingType === 'OFFLINE' ? 'OFFLINE' : 'ONLINE');
    setParts(reschedule && lead.meetingAt ? partsOf(toLocalInput(lead.meetingAt)) : emptyParts);
    setLink(reschedule ? (lead.meetingLink || '') : '');
    setShared([]);
  }, [visible, lead?.id, reschedule]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opening

  const save = () => {
    const at = valueOf(parts);
    if (!at) { toast('Pick a meeting date and time', 'err'); return; }
    const d = new Date(at);
    const h = d.getHours() + d.getMinutes() / 60;
    const w = HOURS[type];
    if (h < w.min || h > w.max) { toast(`${type === 'ONLINE' ? 'Online' : 'Offline'} meetings must be within ${w.label}`, 'err'); return; }
    if (type === 'ONLINE' && !link.trim()) { toast('Add the online meeting link', 'err'); return; }
    const cleanLink = type === 'ONLINE' ? link.trim() : '';
    if (reschedule) rescheduleMeeting(lead.id, d.toISOString(), user, cleanLink, type);
    else setMeeting(lead.id, { meetingType: type, meetingAt: d.toISOString(), meetingLink: cleanLink, meetingShared: shared }, user);
    refresh(); onClose();
    toast(reschedule ? (lead.meetingAt ? 'Meeting rescheduled' : 'Meeting time set') : 'Meeting set');
  };
  const w = HOURS[type];

  return (
    <Sheet visible={visible} onClose={onClose} title={reschedule ? 'Reschedule meeting' : 'Set meeting'}
      footer={<Button label={reschedule ? 'Save new time' : 'Set meeting'} icon="event" onPress={save} />}>
      <Segmented options={[{ value: 'ONLINE', label: 'Online' }, { value: 'OFFLINE', label: 'Offline' }]} value={type} onChange={setType} />
      <DateTimeField label={`Date & time (${w.label})`} parts={parts} onParts={setParts} minHour={w.min} maxHour={w.max} />
      {type === 'ONLINE' ? <Field label="Meeting link" value={link} onChangeText={setLink} placeholder="https://meet…" autoCapitalize="none" autoCorrect={false} keyboardType="url" /> : null}
      {!reschedule ? (
        <>
          <T v="small" tone="sub" style={{ fontWeight: '600' }}>Already shared with the customer</T>
          <Row wrap>
            {SHARED.map((o) => <Chip key={o.key} label={o.label} active={shared.includes(o.key)} onPress={() => setShared((s) => (s.includes(o.key) ? s.filter((x) => x !== o.key) : [...s, o.key]))} />)}
          </Row>
        </>
      ) : null}
    </Sheet>
  );
}

// ── Site visit ──────────────────────────────────────────────────────────────
export function VisitSheet({ visible, onClose, lead }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const [parts, setParts] = useState(emptyParts);
  const [loc, setLoc] = useState('');
  const [picked, setPicked] = useState([]); // [{ id, name }]
  const projects = useMemo(() => [...getProperties()].sort((a, b) => (a.name || '').localeCompare(b.name || '')), [visible]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read each opening
  useEffect(() => {
    if (!visible || !lead) return;
    setParts(emptyParts); setLoc('');
    setPicked(Array.isArray(lead.visitProjects) ? lead.visitProjects.map((p) => ({ id: p.id, name: p.name })) : []);
  }, [visible, lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opening
  const toggle = (p) => setPicked((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, { id: p.id, name: p.name }]));
  const save = () => {
    const at = valueOf(parts);
    if (!at) { toast('Pick a date and time', 'err'); return; }
    if (!picked.length) { toast('Pick at least one project', 'err'); return; }
    schedVisit(lead.id, new Date(at).toISOString(), loc.trim(), user, picked);
    refresh(); onClose(); toast('Site visit scheduled');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Schedule site visit" footer={<Button label="Schedule visit" icon="calendar-month" onPress={save} />}>
      <DateTimeField parts={parts} onParts={setParts} />
      <T v="small" tone="sub" style={{ fontWeight: '600' }}>Project(s) to visit</T>
      {projects.length
        ? <Row wrap>{projects.map((p) => <Chip key={p.id} label={p.name} active={picked.some((x) => x.id === p.id)} onPress={() => toggle(p)} />)}</Row>
        : <T v="small" tone="mute">No projects in the catalog yet.</T>}
      <Field label="Meeting point (optional)" value={loc} onChangeText={setLoc} placeholder="Where to meet" />
    </Sheet>
  );
}

// ── Close as won ────────────────────────────────────────────────────────────
export function DealSheet({ visible, onClose, lead }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const [value, setValue] = useState('');
  useEffect(() => { if (visible) setValue(''); }, [visible]);
  const save = () => {
    if (!value) { toast('Enter the deal value', 'err'); return; }
    closeDealFn(lead.id, true, value, user);
    refresh(); onClose(); toast('Deal closed. Won!');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Close as won" footer={<Button label="Closed won" icon="emoji-events" onPress={save} />}>
      <Field label="Deal value (BDT)" value={value} onChangeText={(v) => setValue(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="e.g. 4500000" autoFocus />
    </Sheet>
  );
}

// ── Mark as lost ────────────────────────────────────────────────────────────
export function LostSheet({ visible, onClose, lead }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const [reason, setReason] = useState('');
  useEffect(() => { if (visible) setReason(''); }, [visible]);
  const save = () => {
    if (!reason.trim()) { toast('Write why it was lost', 'err'); return; }
    markLostFn(lead.id, reason.trim(), user);
    refresh(); onClose(); toast('Lead marked as lost', 'warn');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Mark as lost" footer={<Button label="Mark as lost" icon="thumb-down" tone="danger" onPress={save} />}>
      <T v="small" tone="danger">This closes the lead as lost. The reason helps the team learn.</T>
      <Field label="Why was it lost?" value={reason} onChangeText={setReason} multiline autoFocus placeholder="Price, location, bought elsewhere…" />
    </Sheet>
  );
}
