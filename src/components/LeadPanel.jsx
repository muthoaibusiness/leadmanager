import { useEffect, useState } from 'react';
import Mi from './Mi.jsx';
import { LoadingBlock } from './Spinner.jsx';
import { useApp } from '../context/AppContext.jsx';
import LogCall from './LogCall.jsx';
import { getLead, getActs, ensureLead, ensureLeadActs, hasFullActs, changeStatus, doneVisit, deleteLead, logNoAnswer, noAnswerLock, attendMeeting, userNameById, MAX_ATTEMPTS, followUpBlock, setNoLongerResponding, clearFollowupSuppression, saveLeadPick } from '../lib/db.js';
import { hasColumn } from '../lib/supabase.js';
import { leadUnits, planProjects, projectFloors, unitPrice, unitSize } from '../lib/projects.js';
import { statusLook } from '../lib/floorPlan.js';
import { Building2, ChevronRight, DoorOpen, Layers, Store } from 'lucide-react';
import { Crumb } from './project/ProjectConsole.jsx';
import { fmtD, fmtDT, fmtBDT, rlabel, scoreLead, scoreLabel, leadDisplayStatus, fmtDateTimeAP } from '../lib/helpers.js';
import ActivityTimeline from './ActivityTimeline.jsx';
import { ROLES, SRC_LABELS, effectiveRole, isNiHandler, canSelfForward, DRAWER_MQ, canSee, PAST_QUALIFY } from '../lib/constants.js';
import useMediaQuery from '../hooks/useMediaQuery.js';
import useChanged from '../hooks/useChanged.js';
import { useProjectToast } from './project/projectToast.js';
import { toastMsg } from '../lib/toastMap.js';

const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());
const SHARED_LABEL = { price: 'Price idea', brochure: 'Brochure', floor_plan: 'Floor Plan', video: 'Video', image: 'Image' };

function LeadInfo({ l }) {
  const { user, setChatTarget, chatOk } = useApp();
  const phones = (l.phones?.length ? l.phones : [l.phone]).filter(Boolean);
  const emails = (l.emails?.length ? l.emails : l.email ? [l.email] : []).filter(Boolean);

  // Profile completeness (Agent) — 6 optional fields; Name + Phone are
  // always required so they don't count. Every check must map to something the
  // agent can actually fill in, or the meter can never reach Complete.
  const profChecks = [
    emails.length > 0,                       // Email
    !!(l.company && l.company !== '—'),      // Company
    !!l.profession,                          // Profession
    !!l.source,                              // Source
    !!l.city,                                // Customer Location
    !!l.propertyInterest,                    // Project Interest
  ];
  const profFilled = profChecks.filter(Boolean).length;
  const prof = profFilled >= 6 ? { color: '#22C55E', label: 'Complete' }
    : profFilled >= 4 ? { color: '#EAB308', label: 'Good' }
    : profFilled >= 2 ? { color: '#F59E0B', label: 'Partial' }
    : { color: '#EF4444', label: 'Incomplete' };

  // Eyebrow = source • company (the small kicker line above the big name).
  // Eyebrow = source · status (the kicker line above the name). Company has
  // its own heading in the right column.
  const source = SRC_LABELS[l.source] || l.source || 'Lead';
  const ds = leadDisplayStatus(l);

  // Right column: what the customer wants, each row only when it has a value.
  // Interest floor/unit come from the units this lead holds or bought
  // (leadUnits), re-read on every refreshDB, so a hold, approval or release
  // elsewhere shows here at once.
  const units = leadUnits(l.id);
  const company = l.company && l.company !== '—' ? l.company : '';
  const facts = [];
  if (company) facts.push(['business', 'Company', company]);
  if (l.propertyInterest) facts.push(['layers', 'Property', l.propertyInterest]);
  // A pick saved from the breadcrumb below (lead.cart) counts as interest too.
  const pick = l.cart?.unitNo && !units.some(u => u.code === l.cart.unitNo) ? l.cart : null;
  const floorsOf = [...new Set([pick?.floor, ...units.map(u => u.floor)].filter(Boolean))];
  if (pick || units.length) facts.push(['stacks', 'Interest floor', floorsOf.join(', ') || 'Not on a floor plan']);
  if (pick) facts.push(['storefront', 'Interest unit', <>
    <span>{pick.unitNo}</span>
    <span className="ld-fact-s">{[pick.propertyName !== l.propertyInterest ? pick.propertyName : '', pick.size ? `${pick.size.toLocaleString('en-IN')} sft` : '', pick.value ? fmtBDT(pick.value) : ''].filter(Boolean).join(' · ')}</span>
  </>]);
  units.forEach((u, i) => facts.push(['storefront', i || pick ? `Interest unit ${i + (pick ? 2 : 1)}` : 'Interest unit', <>
    <span>{u.code} · {u.status === 'sold' ? 'Sold' : 'Reserved'}</span>
    <span className="ld-fact-s">{[units.length > 1 || u.project !== l.propertyInterest ? u.project : '', u.size ? `${u.size.toLocaleString('en-IN')} sft` : '', u.price ? fmtBDT(u.price) : ''].filter(Boolean).join(' · ')}</span>
  </>]));
  facts.push(['tag', 'Lead ID', leadCode(l) + (l.materialSent ? ' · Material: ' + l.materialSent : '')]);

  // Below the two columns: deal and meeting details, only when set.
  const specs = [];
  if (l.dealValue > 0) specs.push(['Deal value', fmtBDT(l.dealValue)]);
  // Client meeting the agent booked (Set Meeting).
  if (l.meetingAt) specs.push(['Meeting', (l.meetingType === 'OFFLINE' ? 'Offline' : 'Online') + ' · ' + fmtDateTimeAP(l.meetingAt)]);
  if (l.meetingLink) specs.push(['Meeting link', <a href={l.meetingLink} target="_blank" rel="noreferrer" className="ld-link">Join online meeting</a>]);
  if (l.meetingShared?.length) specs.push(['Already shared', l.meetingShared.map(k => SHARED_LABEL[k] || k).join(', ')]);
  if (l.meetingDate) specs.push(['Site visit', fmtDT(l.meetingDate) + (l.meetingLocation ? ' · ' + l.meetingLocation : '')]);
  if (l.visitProjects?.length) specs.push(['Visit projects', l.visitProjects.map(p => p.name).join(', ')]);
  if (l.priority) specs.push(['Priority', l.priority + (l.preferredTime ? ' · ' + l.preferredTime : '')]);
  if (l.nextFollowup) specs.push(['Follow-up', fmtD(l.nextFollowup)]);

  const stats = [['call', 'Calls', l.callCount], ['sms', 'SMS', l.smsCount], ['chat', 'WhatsApp', l.whatsappCount], ['event_available', 'Visits', l.visitCount]];
  const assignee = [userNameById(l.assignedTo, l.assignedToName) || 'Unassigned', l.assignedRole ? rlabel(l.assignedRole) : ''].filter(Boolean).join(' · ');

  return (
    <div className="ld-card">
      <div className="ld-top">
        <div className="ld-hero">
          <div className="ld-tags">
            <span className="ld-eyebrow">{source}</span>
            <span className="ld-eyebrow" aria-hidden="true">·</span>
            <span className={`bdg ${ds.cls}`}>{ds.label}</span>
            {l.nextFollowup && ['NEW', 'CONTACTED', 'INTERESTED'].includes(l.status) &&
              <span className="bdg s-follow_up"><Mi>alarm</Mi>{fmtDT(l.nextFollowup)}</span>}
            {effectiveRole(user) === ROLES.AGENT &&
              <span className="ld-prof-tag" style={{ color: prof.color, marginLeft: 'auto' }}>{prof.label}</span>}
          </div>
          <h2 className="ld-name">{l.name || 'Unnamed customer'}</h2>
          {phones.length > 0 && (
            <div className="ld-contacts">
              {phones.map((p, i) => (
                <div key={'p' + i} className="ld-crow">
                  <Mi>call</Mi>
                  <a href={`tel:${p}`}>{p}{i === 0 && phones.length > 1 ? ' · primary' : ''}</a>
                  {chatOk && (
                    <button
                      type="button"
                      className="ld-wa"
                      title="Chat on WhatsApp"
                      aria-label={`Chat on WhatsApp with ${p}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setChatTarget({ ...l, phone: p });
                      }}
                    >
                      <Mi>chat</Mi>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <ul className="ld-meta">
            {emails.map((e, i) => <li key={'e' + i}><Mi>mail</Mi><a href={`mailto:${e}`}>{e}</a></li>)}
            {(l.city || l.profession) && <li><Mi>location_on</Mi>{[l.city, l.profession].filter(Boolean).join(' · ')}</li>}
            {l.createdAt && <li><Mi>calendar_today</Mi>Created: {fmtDT(l.createdAt)}</li>}
            <li><Mi>person</Mi>{assignee}</li>
          </ul>
        </div>

        <div className="ld-side">
          {/* Same height as the left column's source · status row, so the rows line up. */}
          <div className="ld-tags"><span className="ld-eyebrow">Project details</span></div>
          <dl className="ld-facts">
            {facts.map(([ic, k, v]) => (
              // Icon only; the label stays as the hover title and the screen-reader name.
              <div key={k} className="ld-fact" title={k}><dt aria-label={k}><Mi>{ic}</Mi></dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
      </div>

      {specs.length > 0 && (
        <div className="ld-specs">
          {specs.map(([k, v]) => (
            <div key={k} className="ld-spec">
              <span className="ld-spec-k">{k}</span>
              <span className="ld-spec-v">{v}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ld-stats">
        {stats.map(([ic, lbl, n]) => (
          <div key={lbl} className="ld-stat">
            <div className="ld-stat-v"><Mi>{ic}</Mi>{n || 0}</div>
            <div className="ld-stat-l">{lbl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The project console's breadcrumb (Project > Floor > Unit type > Unit),
// without the grid, Prospects only. Opens on the lead's saved pick (lead.cart),
// else its project. Picking a unit only stages it:
//   Save project details: stores the pick on the lead (cart); the unit's own
//     status is not touched, so Available Units does not change.
//   Reserve now: opens the Reserve drawer with the unit and this lead filled in.
function UnitPick({ l }) {
  const { user, refreshDB, setPropSel, setConsoleAdmin, setConsoleUnit, openModal } = useApp();
  const toast = useProjectToast({ always: true });
  const projects = planProjects();
  const saved = l.cart?.propertyId ? l.cart : null;
  const want = String(l.propertyInterest || '').trim().toLowerCase();
  const [pid, setPid] = useState(() => saved?.propertyId || projects.find(p => String(p.name || '').trim().toLowerCase() === want)?.id || null);
  const [floorSel, setFloorSel] = useState(saved?.floor || null);
  const [vid, setVid] = useState(saved?.variantId || null);
  const [unit, setUnit] = useState(saved?.unitNo || null);
  const p = projects.find(x => x.id === pid) || null;
  const floors = p ? projectFloors(p) : [];
  const floor = floors.find(f => f.name === floorSel) || floors[0] || null;
  const onFloor = (u) => !floor || floor.ids.has(u.id);
  const variants = (p?.variants || []).filter(v => (v.units || []).some(onFloor));
  const variant = variants.find(v => v.id === vid) || variants[0] || null;
  const units = (variant?.units || []).filter(onFloor);
  const picked = units.find(u => u.id === unit) || null;
  const openN = (v) => v.units.filter(u => onFloor(u) && u.status === 'available').length;
  const isSaved = !!picked && saved?.propertyId === p?.id && saved?.unitNo === picked.id;

  const save = () => {
    saveLeadPick(l.id, { project: p, variant, floor: floor?.name || '', unitNo: picked.id, size: unitSize(picked, variant), value: picked.sheet?.package || unitPrice(picked, variant) }, user);
    refreshDB();
    toast.success('Project details saved', `${picked.id} · ${p.name}`);
  };
  const reserve = () => {
    setConsoleAdmin(false);
    setConsoleUnit({ projectId: p.id, variantId: variant.id, unitId: picked.id, client: { id: l.id, name: l.name, phone: l.phone } });
    setPropSel(p.id);
    openModal('project-console');
  };
  return (
    <div className="ld-pick">
      <nav className="pcb" aria-label="Project details">
        <ol>
          <li>
            <Crumb label="Project" icon={Building2} value={p?.id} placeholder="Project" onChange={id => { setPid(id); setFloorSel(null); setVid(null); setUnit(null); }}
              items={projects.map(x => ({ value: x.id, label: x.name || 'Untitled project' }))} />
          </li>
          {floors.length > 1 && (
            <li>
              <ChevronRight className="pcb-sep" size={16} aria-hidden="true" />
              <Crumb label="Floor" icon={Layers} value={floor?.name} onChange={n => { setFloorSel(n); setVid(null); setUnit(null); }}
                items={floors.map(f => ({ value: f.name, label: f.name }))} />
            </li>
          )}
          {p && (
            <li>
              <ChevronRight className="pcb-sep" size={16} aria-hidden="true" />
              <Crumb label="Unit type" icon={Store} value={variant?.id} onChange={id => { setVid(id); setUnit(null); }}
                items={variants.map(v => ({ value: v.id, label: v.name, description: `${openN(v)} open` }))} />
            </li>
          )}
          {p && (
            <li>
              <ChevronRight className="pcb-sep" size={16} aria-hidden="true" />
              <Crumb label="Unit" icon={DoorOpen} value={picked?.id} placeholder="Pick a unit" current onChange={setUnit}
                items={units.map(u => ({ value: u.id, label: u.id, description: statusLook(p.unitStatuses, u).label, disabled: u.status !== 'available' }))} />
            </li>
          )}
        </ol>
      </nav>
      {picked && (
        <div className="ld-pick-acts">
          <button type="button" className="btn btn-g btn-sm" onClick={save} disabled={isSaved}><Mi>save</Mi>{isSaved ? 'Saved' : 'Save project details'}</button>
          <button type="button" className="btn btn-p btn-sm" onClick={reserve} disabled={picked.status !== 'available'}><Mi>send</Mi>Reserve now</button>
        </div>
      )}
    </div>
  );
}

function Actions({ l }) {
  const { user, openModal, refreshDB } = useApp();
  const toast = useProjectToast({ always: true });
  // Behavioural role: an Executive works leads with the action set its features
  // imply (always Agent). Delete stays on the raw role below.
  const r = effectiveRole(user);

  const doStatus = (s) => {
    changeStatus(l.id, s, user);
    refreshDB();
    toastMsg(toast, 'Status updated', 'ok');
  };

  const doNotInterested = () => {
    changeStatus(l.id, 'NOT_INTERESTED', user);
    refreshDB();
    toastMsg(toast, 'Marked as Not Interested', 'warn');
  };

  const [naBusy, setNaBusy] = useState(false);
  const doNoAnswer = async () => {
    setNaBusy(true);
    const res = await logNoAnswer(l.id, user);
    setNaBusy(false);
    refreshDB();
    if (res.error) toastMsg(toast, 'Could not log the attempt. Check the connection and try again.', 'err');
    else if (!res.counted) toastMsg(toast, res.hitCap ? `${MAX_ATTEMPTS} attempts already used. Follow-ups are off.` : 'Follow-ups are off for this lead', 'warn');
    else if (res.hitCap) toastMsg(toast, `${MAX_ATTEMPTS} attempts reached. Follow-ups stopped.`, 'warn');
    else toastMsg(toast, `No Answer logged (${res.attempts}/${MAX_ATTEMPTS}) · follow-up set for tomorrow`, '');
  };

  // Stop / resume follow-ups. WHO may do this is decided here in the browser
  // only: every request uses the public key and the browser-checked login, so
  // the database cannot tell a manager from an agent. Not secure until real
  // sign-in (Supabase Auth). The database keeps NOT_INTERESTED_X2 permanent.
  const block = followUpBlock(l);
  const supervisor = r === ROLES.TL || r === ROLES.MGMT;
  // Before migration 0049 the column is missing and the PATCH would drop it
  // silently (sbUpdate strips unknown columns), so the action stays hidden.
  const [has0049, setHas0049] = useState(false);
  useEffect(() => {
    let live = true;
    hasColumn('leads', 'followup_suppressed_at', '"No Longer Responding" is hidden. Apply supabase/migrations/0049_followup_rules.sql.')
      .then(ok => { if (live) setHas0049(ok); });
    return () => { live = false; };
  }, []);
  const mayStop = has0049 && !block && (l.assignedTo === user.id || supervisor);
  const mayResume = has0049 && !!l.followupSuppressedAt && l.followupSuppressedReason !== 'NOT_INTERESTED_X2' && supervisor;
  const doStop = () => {
    toast.confirm({
      title: 'Stop follow-ups for this lead?',
      description: 'The lead and its status stay as they are.',
      confirmLabel: 'Stop follow-ups',
      onConfirm: () => { setNoLongerResponding(l.id, user); refreshDB(); toastMsg(toast, 'Follow-ups stopped. No longer responding.', 'warn'); },
    });
  };
  const doResume = () => {
    clearFollowupSuppression(l.id, user);
    refreshDB();
    toastMsg(toast, 'Follow-ups resumed', 'ok');
  };

  const doDoneVisit = () => {
    doneVisit(l.id, user);
    refreshDB();
    toastMsg(toast, 'Visit marked as done', 'ok');
  };

  const doAttend = () => {
    attendMeeting(l.id, user);
    refreshDB();
    toastMsg(toast, 'Meeting marked as attended', 'ok');
  };

  // A 24h lock from before 0049 (7 attempts under the old rule) still freezes
  // the agent's action set until it lapses; 0049 sets no new locks. Only the
  // attempting role is locked — supervisors (TL/MGMT) are never blocked.
  // Interested stays visible inside the lock but disabled: the lock is the
  // safeguard, so the action renders greyed out rather than hidden.
  const lockUntil = r === ROLES.AGENT ? noAnswerLock(l) : null;
  if (lockUntil) {
    const retry = lockUntil.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
      <div className="act-card">
        <div className="act-ttl">Actions</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '8px', background: 'var(--orange-l)', color: 'var(--orange)' }}> {/* ds-allow-hardcode: pre-existing lock-banner inline styles */}
          <Mi>lock</Mi>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
            <b>Locked — 7 attempts used</b>
            <span style={{ fontSize: '12px' }}>No answer after 7 attempts. Try again after {retry}.</span>
          </div>
        </div>
        <button className="btn btn-success btn-full" disabled> {/* ds-allow-hardcode: lock card needs its own top gap */}
          <Mi>thumb_up</Mi>Interested
        </button>
      </div>
    );
  }

  const btns = [];

  // The Agent works a lead end to end: first contact → Interested → Set Meeting
  // → Attend → Site Visit → Visit Done → Forward to Team Lead.
  if (r === ROLES.AGENT) {
    const s = l.status;
    if (s === 'NEW') btns.push(
      <button key="contacted" className="btn btn-p btn-full" onClick={() => doStatus('CONTACTED')}>
        <Mi>phone_callback</Mi>Connected
      </button>
    );
    // Interested is kept visible at every status: from INTERESTED on (PAST_QUALIFY)
    // it is disabled (already qualified; re-marking would rewind a later stage)
    // rather than hidden, so the same control sits in the same place on every lead.
    const interested = PAST_QUALIFY.includes(s);
    btns.push(
      <button key="interested" className="btn btn-success btn-full" onClick={() => doStatus('INTERESTED')} disabled={interested}>
        <Mi>thumb_up</Mi>Interested
      </button>
    );
    if (s === 'INTERESTED' && canSee(user, 'meeting')) btns.push(
      <button key="set-meeting" className="btn btn-teal btn-full" onClick={() => openModal('set-meeting')}>
        <Mi>event</Mi>Set Meeting
      </button>
    );
    // Not Interested — manual disqualify, available before contact (NEW), after
    // connecting (CONTACTED), once interested (INTERESTED), and through the
    // meeting/site-visit stages: a client can still back out before negotiation
    // closes, and the agent must be able to record it as a status, not only as
    // a note.
    if (['NEW', 'CONTACTED', 'INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE'].includes(s)) btns.push(
      <button key="notint" className="btn btn-g btn-full" onClick={doNotInterested}>
        <Mi>thumb_down</Mi>Not Interested
      </button>
    );
    // Attempt — neutral grey outcome: logs a 0-min call attempt, books a next-day
    // follow-up, keeps current status. Available while chasing first contact (NEW),
    // after connecting (CONTACTED), and once interested (3rd stage, confirming
    // before the meeting). Counter restarts each stage; the 5th in a stage stops
    // follow-ups (status unchanged). Hidden once follow-ups are off.
    if (['NEW', 'CONTACTED', 'INTERESTED'].includes(l.status) && !block) {
      const att = l.noAnswerCount || 0;
      btns.push(
        <button key="noans" className="btn btn-neutral btn-full" onClick={doNoAnswer} disabled={naBusy}>
          <Mi>phone_missed</Mi>Attempt{att > 0 ? ` (${att}/${MAX_ATTEMPTS})` : ''}
        </button>
      );
    }
    // After contact — follow-up to keep nurturing. Not at INTERESTED (3rd stage):
    // that lead is qualified and ready for a meeting.
    if (l.status === 'CONTACTED' && !block) btns.push(
      <button key="followup" className="btn btn-full" style={{ background: 'var(--orange-l)', color: 'var(--orange)' }} onClick={() => openModal('follow-up')}>
        <Mi>alarm</Mi>Follow-up
      </button>
    );

    // Attended the scheduled meeting → log it, then schedule the site visit/booking.
    if (l.status === 'MEETING_SET' && !l.meetingAttended) btns.push(
      <button key="attend" className="btn btn-success btn-full" onClick={doAttend}>
        <Mi>how_to_reg</Mi>Attend Meeting
      </button>
    );
    // Reschedule / set the hand-off meeting time (logged to activity). Shown at the
    // meeting stage even if no time was set — but gone once the meeting is attended.
    if ((l.status === 'MEETING_SET' || l.meetingAt) && !l.meetingAttended) btns.push(
      <button key="resched" className="btn btn-full" style={{ background: 'var(--blue-l)', color: 'var(--accent)' }} onClick={() => openModal('reschedule')}>
        <Mi>event_repeat</Mi>Reschedule Meeting
      </button>
    );
    if (l.status === 'MEETING_SET') btns.push(
      <button key="sched" className="btn btn-teal btn-full" onClick={() => openModal('sched')}>
        <Mi>calendar_month</Mi>Schedule Site Visit
      </button>
    );
    if (l.status === 'SITE_VISIT_SCHEDULED') btns.push(
      <button key="done-visit" className="btn btn-success btn-full" onClick={doDoneVisit}>
        <Mi>check_circle</Mi>Mark Visit as Done
      </button>
    );
    // Attempt — couldn't reach the client; logs an attempt + next-day follow-up.
    // The 5th in a stage stops follow-ups (status unchanged).
    if (['MEETING_SET', 'SITE_VISIT_SCHEDULED'].includes(l.status) && !block) {
      const att = l.noAnswerCount || 0;
      btns.push(
        <button key="mt-attempt" className="btn btn-neutral btn-full" onClick={doNoAnswer} disabled={naBusy}>
          <Mi>phone_missed</Mi>Attempt{att > 0 ? ` (${att}/${MAX_ATTEMPTS})` : ''}
        </button>
      );
    }
    // One top-level Forward action. Its modal offers the three destinations:
    // a team member (open stage, owned), the Team Lead (after the site visit,
    // with the offer), and myself (Add-Customer holder or self_forward grant,
    // when not already assigned here). Shown when any of the three applies.
    const teamRoute = user.role !== ROLES.MA && s !== 'NEGOTIATING' && s !== 'DEAL_CLOSED_WON' && s !== 'DEAL_CLOSED_LOST' && s !== 'NOT_INTERESTED' && l.assignedTo === user.id;
    const tlRoute = s === 'SITE_VISIT_DONE';
    const selfRoute = canSelfForward(user) && l.assignedTo !== user.id;
    if (teamRoute || tlRoute || selfRoute) btns.push(
      <button key="fwd-agent" className="btn btn-g btn-full" onClick={() => openModal('forward-agent')}>
        <Mi>swap_horiz</Mi>Forward to Agent
      </button>
    );
  }

  // Not Interested handler: re-engages the lead with the same first-contact
  // buttons an Agent uses. Moving it off Not Interested takes it out of their (Not
  // Interested-only) list, but it stays assigned to them.
  if (isNiHandler(user) && l.status === 'NOT_INTERESTED') {
    btns.push(
      <button key="ni-contacted" className="btn btn-p btn-full" onClick={() => doStatus('CONTACTED')}>
        <Mi>phone_callback</Mi>Connected
      </button>,
      <button key="ni-interested" className="btn btn-success btn-full" onClick={() => doStatus('INTERESTED')}>
        <Mi>thumb_up</Mi>Interested
      </button>,
    );
    if (!block) btns.push(
      <button key="ni-noans" className="btn btn-neutral btn-full" onClick={doNoAnswer} disabled={naBusy}>
        <Mi>phone_missed</Mi>Attempt{l.noAnswerCount > 0 ? ` (${l.noAnswerCount}/${MAX_ATTEMPTS})` : ''}
      </button>,
      <button key="ni-followup" className="btn btn-full" style={{ background: 'var(--orange-l)', color: 'var(--orange)' }} onClick={() => openModal('follow-up')}>
        <Mi>alarm</Mi>Follow-up
      </button>
    );
  }

  if (r === ROLES.TL || r === ROLES.MGMT) {
    // A lead in the Team Lead's hands (forwarded by an Agent arrives at Meeting Set /
    // Visit Scheduled / Visit Done) — let the TL act on any deal-stage lead, not
    // only Visit Done / Negotiating, so a forwarded lead can always be closed.
    const DEAL_STAGE = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING'];
    const inDeal = DEAL_STAGE.includes(l.status);
    if (inDeal) btns.push(
      <button key="deal" className="btn btn-success btn-full" onClick={() => openModal('deal')}>
        <Mi>emoji_events</Mi>Close as Won
      </button>
    );
    if (inDeal && l.status !== 'NEGOTIATING') btns.push(
      <button key="neg" className="btn btn-warn btn-full" onClick={() => doStatus('NEGOTIATING')}>
        <Mi>balance</Mi>Mark as Negotiating
      </button>
    );
    if (inDeal) {
      if (!block) btns.push(
        <button key="follow-up" className="btn btn-full" style={{ background: 'var(--orange-l)', color: 'var(--orange)' }} onClick={() => openModal('follow-up')}>
          <Mi>alarm</Mi>Take Time
        </button>
      );
      btns.push(
        <button key="lost" className="btn btn-full" style={{ background: 'var(--red-l)', color: 'var(--red)' }} onClick={() => openModal('lost')}>
          <Mi>thumb_down</Mi>Mark as Lost
        </button>
      );
    }
  }

  if (r === ROLES.MGMT) {
    btns.push(
      <button key="transfer" className="btn btn-purple btn-full" onClick={() => openModal('transfer-lead')}>
        <Mi>swap_horiz</Mi>Transfer Lead
      </button>
    );
  }

  if (mayStop) btns.push(
    <button key="no-longer" className="btn btn-g btn-full" onClick={doStop}>
      <Mi>voice_over_off</Mi>No Longer Responding
    </button>
  );
  if (mayResume) btns.push(
    <button key="resume-fu" className="btn btn-g btn-full" onClick={doResume}>
      <Mi>alarm_on</Mi>Resume Follow-ups
    </button>
  );

  btns.push(
    <div key="log-call" className="log-call-wrap">
      <LogCall leadId={l.id} triggerClassName="btn btn-full" triggerStyle={{ background: 'var(--blue-l)', color: 'var(--accent)' }} />
    </div>
  );
  btns.push(
    <button key="note" className="btn btn-g btn-full" onClick={() => openModal('note')}>
      <Mi>edit_note</Mi>Add Note
    </button>
  );

  if (!btns.length) return null;

  return (
    <div className="act-card">
      <div className="act-ttl">Actions</div>
      <div className="act-list">{btns}</div>
    </div>
  );
}

function ScoreCard({ l, acts }) {
  const score = scoreLead(l, acts);
  const { label, color, bg } = scoreLabel(score);
  const factors = [];
  if (l.callCount > 0) factors.push(l.callCount + ' call' + (l.callCount > 1 ? 's' : ''));
  if (l.visitCount > 0) factors.push(l.visitCount + ' visit' + (l.visitCount > 1 ? 's' : ''));
  if (l.budget > 0) factors.push('Budget set');
  if (l.propertyInterest) factors.push('Property interest');
  if (l.nextFollowup) factors.push('Follow-up scheduled');
  return (
    <div className="score-card" style={{ borderColor: color + '55', background: bg }}>
      <div className="score-top-row">
        <div className="score-badge" style={{ background: color }}>
          <Mi>psychology</Mi>AI Score
        </div>
        <div className="score-num-wrap">
          <span className="score-num" style={{ color }}>{score}</span>
          <span className="score-label" style={{ color }}>{label}</span>
        </div>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: score + '%', background: color }} />
      </div>
      <div className="score-factors">{factors.length ? factors.join(' · ') : 'Limited data'}</div>
    </div>
  );
}

function OfferCard({ acts }) {
  const offer = acts.find(a => a.type === 'OFFER');
  if (!offer) return null;
  let data;
  try { data = JSON.parse(offer.description); } catch { return null; }
  return (
    <div className="offer-card">
      <div className="offer-ttl"><Mi>price_check</Mi>Offer Summary</div>
      {data.ourOffer > 0 && <div className="offer-row"><span className="offer-lbl">Our Offer</span>{fmtBDT(data.ourOffer)}</div>}
      {data.clientOffer > 0 && <div className="offer-row"><span className="offer-lbl">Client Offer</span>{fmtBDT(data.clientOffer)}</div>}
      {data.totalSft > 0 && <div className="offer-row"><span className="offer-lbl">Total SFT</span>{data.totalSft} sqft</div>}
      {data.pipelineValue > 0 && (
        <div className="offer-row offer-pipeline"><span className="offer-lbl">Pipeline Value</span><strong>{fmtBDT(data.pipelineValue)}</strong></div>
      )}
      {data.notes && <div className="offer-notes">{data.notes}</div>}
      <div className="offer-by">Submitted by {userNameById(offer.userId, offer.userName)}</div>
    </div>
  );
}

function Timeline({ acts, lead }) {
  const items = acts.map(a => ({
    id: a.id,
    type: a.type,
    actor: userNameById(a.userId, (a.userName && a.userName !== 'system') ? a.userName : null),
    description: a.description,
    sub: a.durationSeconds > 0 ? `${Math.floor(a.durationSeconds / 60)}m ${a.durationSeconds % 60}s · ${fmtDT(a.timestamp)}` : fmtDT(a.timestamp),
  }));
  // Surface the lead's persistent notes (Message logs) as a pinned timeline entry.
  if (lead?.notes && lead.notes.trim()) {
    items.unshift({ id: 'lead-notes', type: 'NOTE', actor: 'Customer message logs', description: lead.notes, sub: fmtDT(lead.createdAt) });
  }
  return (
    <div className="tl">
      <div className="tl-ttl">Activity Timeline</div>
      <ActivityTimeline items={items} empty="No activity yet" />
    </div>
  );
}

export default function LeadPanel() {
  const { panLead, setPanLead, openModal, user, refreshDB, sidebarOpen } = useApp();
  const toast = useProjectToast({ always: true });
  // Inert while the ≤1023px drawer is open, like the page behind it: the panel
  // lives outside #app, and even closed (off-canvas) its buttons would take Tab.
  const drawerOpen = useMediaQuery(DRAWER_MQ) && sidebarOpen;
  // Only Management / Master (admin) may delete a lead. Real agents — Initial
  // Agent, Team Lead — cannot delete any lead.
  const canDelete = user?.role === ROLES.MGMT || user?.role === ROLES.MASTER;

  function handleDelete() {
    if (!l) return;
    toast.confirm({
      title: `Delete "${l.name}"?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: () => { deleteLead(panLead, user); refreshDB(); setPanLead(null); toastMsg(toast, 'Customer deleted', 'ok'); },
    });
  }

  const isOpen = !!panLead;
  const l = panLead ? getLead(panLead) : null;
  const acts = panLead ? getActs(panLead) : [];

  // Activities are no longer part of the boot snapshot (see ensureLeadActs in
  // db.js) -- this panel is what pulls them, for the ONE lead being opened.
  // Cache-first: whatever is already in memory renders immediately and the
  // fetch refreshes underneath, so reopening a lead never flashes a spinner.
  // The spinner below is only for a lead nothing has ever loaded.
  // Whether this lead's activities have finished loading. It has to be STATE:
  // hasFullActs() is a module-level flag, and reading it during render only
  // works if something re-renders after it flips. ensureLeadActs re-renders via
  // refreshDB only when the cache actually CHANGED — so a lead with no activity
  // at all resolved, changed nothing, never re-rendered, and sat on the spinner
  // forever. Resolving is the signal, not changing.
  const [actsReady, setActsReady] = useState(false);

  // A lead whose full history is already cached must not flash a spinner.
  if (useChanged(panLead) && panLead) setActsReady(hasFullActs(panLead));

  useEffect(() => {
    if (!panLead) return;
    let alive = true;
    // The lead row itself may not be cached either — a notification opens the
    // panel from an id alone, and db.leads only holds what has been listed so far.
    ensureLead(panLead).then(changed => { if (alive && changed) refreshDB(); });
    ensureLeadActs(panLead).then(changed => {
      if (!alive) return;
      // Done either way — including "done, and there were none".
      setActsReady(true);
      if (changed) refreshDB();
    });
    return () => { alive = false; };
  }, [panLead, refreshDB]);

  const actsLoading = !!panLead && !actsReady && !acts.length;

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && panLead) setPanLead(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [panLead, setPanLead]);

  return (
    <>
      <div id="pov" className={isOpen ? 'on' : ''} onClick={() => setPanLead(null)} />
      <div id="pan" className={isOpen ? 'on' : ''} inert={drawerOpen}>
        <div className="p-hd">
          <button className="p-back" onClick={() => setPanLead(null)} aria-label="Back" title="Back"><Mi aria-hidden="true">arrow_back</Mi></button>
          <div className="p-ttl">{l ? (l.name || 'Unnamed customer') : 'Customer Details'}</div>
          <div style={{ display: 'flex', gap: '7px' }}>
            {l && (
              <>
                <a href={`tel:${l.phone}`} className="btn btn-g btn-sm"><Mi>call</Mi></a>
                <button className="btn btn-g btn-sm" onClick={() => openModal('edit-lead')}><Mi>edit</Mi></button>
                {canDelete && (
                  <button className="btn btn-sm" style={{background:'var(--red-l)',color:'var(--red)'}} onClick={handleDelete}><Mi>delete</Mi></button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="p-body">
          {l && (
            <>
              <LeadInfo l={l} />
              <UnitPick key={l.id} l={l} />
              <ScoreCard l={l} acts={acts} />
              <Actions l={l} />
              <OfferCard acts={acts} />
              {actsLoading
                ? <div className="tl"><div className="tl-ttl">Activity Timeline</div><LoadingBlock label="Loading activity…" pad={18} /></div>
                : <Timeline acts={acts} lead={l} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
