import { useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import LogCall from './LogCall.jsx';
import { getLead, getActs, changeStatus, doneVisit, deleteLead, updLead, addAct, logNoAnswer, noAnswerLock, attendMeeting, createCarpoolRequest } from '../lib/db.js';
import { fmtD, fmtDT, fmtBDT, rlabel, scoreLead, scoreLabel, leadDisplayStatus, fmtDateTimeAP } from '../lib/helpers.js';
import ActivityTimeline from './ActivityTimeline.jsx';
import { ROLES, STATUS_LABELS, SRC_LABELS } from '../lib/constants.js';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }
const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());
const SHARED_LABEL = { price: 'Price idea', brochure: 'Brochure', video: 'Video', image: 'Image' };

function LeadInfo({ l }) {
  const { user } = useApp();
  const phones = (l.phones?.length ? l.phones : [l.phone]).filter(Boolean);
  const emails = (l.emails?.length ? l.emails : l.email ? [l.email] : []).filter(Boolean);

  // Profile completeness (Initial Agent) — 6 optional fields; Name + Phone are
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
  if (l.propertyInterest) specs.push(['Property', l.propertyInterest]);
  if (l.dealValue > 0) specs.push(['Deal value', fmtBDT(l.dealValue)]);
  // Meeting hand-off info set by the Initial Agent (shown to the Meeting Agent).
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
          {user?.role === ROLES.IA &&
            <span className="ld-prof-tag" style={{ color: prof.color, marginLeft: 'auto' }}>{prof.label}</span>}
        </div>
      </div>

      {(phones.length || emails.length) > 0 && (
        <div className="ld-contacts">
          {phones.map((p, i) => (
            <div key={'p' + i} className="ld-crow">
              <Mi>call</Mi>
              <a href={`tel:${p}`}>{p}{i === 0 && phones.length > 1 ? ' · primary' : ''}</a>
              <a className="ld-wa" href={`https://wa.me/${p.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" title="WhatsApp"><Mi>chat</Mi></a>
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
          <div className="ld-ag-tx"><div className="ld-ag-l">Assigned</div><div className="ld-ag-v">{l.assignedToName || 'Unassigned'}</div></div>
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
  const { user, openModal, setFwdTarget, setPanLead, refreshDB, showToast } = useApp();
  const r = user?.role;

  const doStatus = (s) => {
    changeStatus(l.id, s, user);
    refreshDB();
    showToast('Status updated', 'ok');
  };

  const doNotInterested = () => {
    changeStatus(l.id, 'NOT_INTERESTED', user);
    refreshDB();
    showToast('Marked as Not Interested', 'warn');
  };

  const doNoAnswer = () => {
    const res = logNoAnswer(l.id, user);
    refreshDB();
    const retry = res.lockUntil ? new Date(res.lockUntil).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    if (res.locked) showToast(`Locked — 7 attempts used. Try again after ${retry}`, 'warn');
    else if (res.hitCap) showToast(`7 attempts reached — locked for 24h, retry after ${retry}`, 'warn');
    else showToast(`No Answer logged (${res.attempts}/7) · follow-up set for tomorrow`, '');
  };

  const doDoneVisit = () => {
    doneVisit(l.id, user);
    refreshDB();
    showToast('Visit marked as done', 'ok');
  };

  const doAttend = () => {
    attendMeeting(l.id, user);
    refreshDB();
    showToast('Meeting marked as attended', 'ok');
  };

  const doCarpool = () => {
    createCarpoolRequest({ leadId: l.id, clientName: l.name, visitDate: l.meetingDate, projects: l.visitProjects || [] }, user);
    refreshDB();
    showToast('Carpool requested — pending admin approval', 'ok');
  };

  // A lead that has burned through its 7 attempts is locked for 24h: the entire
  // action set is frozen for the agent (IA/MA) until the cool-off lifts. Only the
  // attempting roles are locked — supervisors (TL/MGMT) are never blocked.
  const lockUntil = (r === ROLES.IA || r === ROLES.MA) ? noAnswerLock(l) : null;
  if (lockUntil) {
    const retry = lockUntil.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
      <div className="act-card">
        <div className="act-ttl">Actions</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '8px', background: 'var(--orange-l)', color: 'var(--orange)' }}>
          <Mi>lock</Mi>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35 }}>
            <b>Locked — 7 attempts used</b>
            <span style={{ fontSize: '12px' }}>No answer after 7 attempts. Try again after {retry}.</span>
          </div>
        </div>
      </div>
    );
  }

  const btns = [];

  if (r === ROLES.IA) {
    if (l.status === 'NEW') btns.push(
      <button key="contacted" className="btn btn-p btn-full" onClick={() => doStatus('CONTACTED')}>
        <Mi>phone_callback</Mi>Connected
      </button>
    );
    if (l.status === 'CONTACTED') btns.push(
      <button key="interested" className="btn btn-success btn-full" onClick={() => doStatus('INTERESTED')}>
        <Mi>thumb_up</Mi>Interested
      </button>
    );
    if (l.status === 'INTERESTED' && l.assignedRole === ROLES.IA) btns.push(
      <button key="fwd-ma" className="btn btn-teal btn-full" onClick={() => openModal('forward-ma')}>
        <Mi>forward_to_inbox</Mi>FW to Next Agent
      </button>
    );
    // Not Interested — manual disqualify, available before contact (NEW) and after
    // connecting (CONTACTED) once the agent decides the lead isn't worth pursuing.
    if (['NEW', 'CONTACTED'].includes(l.status)) btns.push(
      <button key="notint" className="btn btn-g btn-full" onClick={doNotInterested}>
        <Mi>thumb_down</Mi>Not Interested
      </button>
    );
    // Attempt — neutral grey outcome: logs a 0-min call attempt, books a next-day
    // follow-up, keeps current status. Available while chasing first contact (NEW),
    // after connecting (CONTACTED), and once interested (3rd stage, confirming
    // before hand-off). Counter restarts each stage; 7 in a stage → the lead is
    // locked for 24h (status unchanged), then a fresh batch of 7 is granted.
    if (['NEW', 'CONTACTED', 'INTERESTED'].includes(l.status)) {
      // A lapsed lock (noAnswerLockUntil in the past) means the next attempt starts
      // a fresh batch, so show no count until then.
      const att = l.noAnswerLockUntil ? 0 : (l.noAnswerCount || 0);
      btns.push(
        <button key="noans" className="btn btn-neutral btn-full" onClick={doNoAnswer}>
          <Mi>phone_missed</Mi>Attempt{att > 0 ? ` (${att}/7)` : ''}
        </button>
      );
    }
    // After contact — follow-up to keep nurturing. Not at INTERESTED (3rd stage):
    // that lead is qualified and ready to forward to a Meeting Agent.
    if (l.status === 'CONTACTED') btns.push(
      <button key="followup" className="btn btn-full" style={{ background: 'var(--orange-l)', color: 'var(--orange)' }} onClick={() => openModal('follow-up')}>
        <Mi>alarm</Mi>Follow-up
      </button>
    );
  }

  if (r === ROLES.MA) {
    const maClosed = ['SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'];
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
    if (!['SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)) btns.push(
      <button key="sched" className="btn btn-teal btn-full" onClick={() => openModal('sched')}>
        <Mi>calendar_month</Mi>Schedule Site Visit
      </button>
    );
    if (l.status === 'SITE_VISIT_SCHEDULED') btns.push(
      <button key="done-visit" className="btn btn-success btn-full" onClick={doDoneVisit}>
        <Mi>check_circle</Mi>Mark Visit as Done
      </button>
    );
    // Request a carpool ride to the site visit — admin approves in Carpool Requests.
    if (l.status === 'SITE_VISIT_SCHEDULED') btns.push(
      l.carpoolRequested
        ? <button key="carpool" className="btn btn-g btn-full" disabled><Mi>directions_car</Mi>Carpool Requested</button>
        : <button key="carpool" className="btn btn-full" style={{ background: 'var(--orange-l)', color: 'var(--orange)' }} onClick={doCarpool}><Mi>directions_car</Mi>Request Carpool</button>
    );
    // Attempt — couldn't reach the client; logs an attempt + next-day follow-up.
    // 7 attempts in a stage → lead locked for 24h (status unchanged), then reset.
    if (['MEETING_SET', 'SITE_VISIT_SCHEDULED'].includes(l.status)) {
      const att = l.noAnswerLockUntil ? 0 : (l.noAnswerCount || 0);
      btns.push(
        <button key="ma-attempt" className="btn btn-neutral btn-full" onClick={doNoAnswer}>
          <Mi>phone_missed</Mi>Attempt{att > 0 ? ` (${att}/7)` : ''}
        </button>
      );
    }
    // Forward to Team Lead — only after the site visit is done (not at meeting stage).
    if (l.status === 'SITE_VISIT_DONE') btns.push(
      <button key="fwd-tl" className="btn btn-purple btn-full" onClick={() => openModal('forward-tl')}>
        <Mi>forward_to_inbox</Mi>Forward to Team Lead
      </button>
    );
  }

  if (r === ROLES.TL || r === ROLES.MGMT) {
    // A lead in the Team Lead's hands (forwarded from MA arrives at Meeting Set /
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
      btns.push(
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
  let data = null;
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
      <div className="offer-by">Submitted by {offer.userName}</div>
    </div>
  );
}

function Timeline({ acts }) {
  const items = acts.map(a => ({
    id: a.id,
    type: a.type,
    actor: (a.userName && a.userName !== 'system') ? a.userName : null,
    description: a.description,
    sub: a.durationSeconds > 0 ? `${Math.floor(a.durationSeconds / 60)}m ${a.durationSeconds % 60}s · ${fmtDT(a.timestamp)}` : fmtDT(a.timestamp),
  }));
  return (
    <div className="tl">
      <div className="tl-ttl">Activity Timeline</div>
      <ActivityTimeline items={items} empty="No activity yet" />
    </div>
  );
}

export default function LeadPanel() {
  const { panLead, setPanLead, openModal, dbVersion, user, refreshDB, showToast } = useApp();
  // Only Management / Master (admin) may delete a lead. Real agents — Initial
  // Agent, Meeting Agent, Team Lead — cannot delete any lead.
  const canDelete = user?.role === ROLES.MGMT || user?.role === ROLES.MASTER;

  function handleDelete() {
    if (!l) return;
    if (!window.confirm(`Delete "${l.name}"? This cannot be undone.`)) return;
    deleteLead(panLead, user);
    refreshDB();
    setPanLead(null);
    showToast('Customer deleted', 'ok');
  }

  const isOpen = !!panLead;
  const l = panLead ? getLead(panLead) : null;
  const acts = panLead ? getActs(panLead) : [];


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
      <div id="pan" className={isOpen ? 'on' : ''}>
        <div className="p-hd">
          <button className="p-back" onClick={() => setPanLead(null)}><Mi>arrow_back</Mi></button>
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
              <Timeline acts={acts} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
