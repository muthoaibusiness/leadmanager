import { useEffect, useState } from 'react';
import Mi from './Mi.jsx';
import { LoadingBlock } from './Spinner.jsx';
import { useApp } from '../context/AppContext.jsx';
import LogCall from './LogCall.jsx';
import { getLead, getActs, ensureLead, ensureLeadActs, hasFullActs, changeStatus, doneVisit, deleteLead, logNoAnswer, noAnswerLock, attendMeeting, userNameById, MAX_ATTEMPTS, followUpBlock, setNoLongerResponding, clearFollowupSuppression } from '../lib/db.js';
import { hasColumn } from '../lib/supabase.js';
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
  const eyebrow = [SRC_LABELS[l.source] || l.source || 'Lead',
    (l.company && l.company !== '—') ? l.company : null].filter(Boolean).join('  •  ');

  // Spec sheet — label/value rows, shown only when there's a value.
  const specs = [];
  if (l.company && l.company !== '—') specs.push(['Company', l.company]);
  if (l.propertyInterest) specs.push(['Property', l.propertyInterest]);
  if (l.dealValue > 0) specs.push(['Deal value', fmtBDT(l.dealValue)]);
  // Client meeting the agent booked (Set Meeting).
  if (l.meetingAt) specs.push(['Meeting', (l.meetingType === 'OFFLINE' ? 'Offline' : 'Online') + ' · ' + fmtDateTimeAP(l.meetingAt)]);
  if (l.meetingLink) specs.push(['Meeting link', <a href={l.meetingLink} target="_blank" rel="noreferrer" className="ld-link">Join online meeting</a>]);
  if (l.meetingShared?.length) specs.push(['Already shared', l.meetingShared.map(k => SHARED_LABEL[k] || k).join(', ')]);
  if (l.meetingDate) specs.push(['Site visit', fmtDT(l.meetingDate) + (l.meetingLocation ? ' · ' + l.meetingLocation : '')]);
  if (l.visitProjects?.length) specs.push(['Visit projects', l.visitProjects.map(p => p.name).join(', ')]);
  if (l.city || l.profession) specs.push(['Location', [l.city, l.profession].filter(Boolean).join(' · ')]);
  if (l.priority) specs.push(['Priority', l.priority + (l.preferredTime ? ' · ' + l.preferredTime : '')]);
  if (l.nextFollowup) specs.push(['Follow-up', fmtD(l.nextFollowup)]);
  specs.push(['Lead ID', leadCode(l) + (l.materialSent ? ' · Material: ' + l.materialSent : '')]);
  if (l.createdAt) specs.push(['Created', fmtDT(l.createdAt)]);

  const stats = [['Calls', l.callCount], ['SMS', l.smsCount], ['WhatsApp', l.whatsappCount], ['Visits', l.visitCount]];

  return (
    <div className="ld-card">
      <div className="ld-hero">
        <div className="ld-eyebrow">{eyebrow}</div>
        <h2 className="ld-name">{l.name || 'Unnamed customer'}</h2>
        <div className="ld-tags">
          {(() => { const ds = leadDisplayStatus(l); return <span className={`bdg ${ds.cls}`}>{ds.label}</span>; })()}
          {l.nextFollowup && ['NEW', 'CONTACTED', 'INTERESTED'].includes(l.status) &&
            <span className="bdg s-follow_up"><Mi>alarm</Mi>{fmtDT(l.nextFollowup)}</span>}
          {effectiveRole(user) === ROLES.AGENT &&
            <span className="ld-prof-tag" style={{ color: prof.color, marginLeft: 'auto' }}>{prof.label}</span>}
        </div>
      </div>

      {(phones.length || emails.length) > 0 && (
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
          {emails.map((e, i) => (
            <div key={'e' + i} className="ld-crow"><Mi>mail</Mi><a href={`mailto:${e}`}>{e}</a></div>
          ))}
        </div>
      )}

      <div className="ld-agent">
        <div className="ld-ag-cell">
          <Mi>person</Mi>
          <div className="ld-ag-tx"><div className="ld-ag-l">Assigned</div><div className="ld-ag-v">{userNameById(l.assignedTo, l.assignedToName) || 'Unassigned'}</div></div>
        </div>
        <div className="ld-ag-cell">
          <Mi>badge</Mi>
          <div className="ld-ag-tx"><div className="ld-ag-l">Role</div><div className="ld-ag-v">{l.assignedRole ? rlabel(l.assignedRole) : '—'}</div></div>
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
        {stats.map(([lbl, n]) => (
          <div key={lbl} className="ld-stat">
            <div className="ld-stat-v">{n || 0}</div>
            <div className="ld-stat-l">{lbl}</div>
          </div>
        ))}
      </div>
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
