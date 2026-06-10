import { useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import LogCall from './LogCall.jsx';
import { getLead, getActs, changeStatus, doneVisit, deleteLead, updLead, addAct } from '../lib/db.js';
import { fmtD, fmtDT, fmtBDT, rlabel, scoreLead, scoreLabel } from '../lib/helpers.js';
import ActivityTimeline from './ActivityTimeline.jsx';
import { ROLES, STATUS_LABELS, SRC_LABELS } from '../lib/constants.js';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }

function LeadInfo({ l }) {
  const phones = (l.phones?.length ? l.phones : [l.phone]).filter(Boolean);
  const emails = (l.emails?.length ? l.emails : l.email ? [l.email] : []).filter(Boolean);

  // Eyebrow = source • company (the small kicker line above the big name).
  const eyebrow = [SRC_LABELS[l.source] || l.source || 'Lead',
    (l.company && l.company !== '—') ? l.company : null].filter(Boolean).join('  •  ');

  // Spec sheet — label/value rows, shown only when there's a value.
  const specs = [];
  specs.push(['Assigned', `${l.assignedToName || '—'}${l.assignedRole ? ' · ' + rlabel(l.assignedRole) : ''}`]);
  if (l.propertyInterest) specs.push(['Property', l.propertyInterest + (l.budget ? ' · ' + fmtBDT(l.budget) : '')]);
  if (l.dealValue > 0) specs.push(['Deal value', fmtBDT(l.dealValue)]);
  if (l.meetingDate) specs.push(['Site visit', fmtDT(l.meetingDate) + (l.meetingLocation ? ' · ' + l.meetingLocation : '')]);
  if (l.city || l.profession) specs.push(['Location', [l.city, l.profession].filter(Boolean).join(' · ')]);
  if (l.priority) specs.push(['Priority', l.priority + (l.preferredTime ? ' · ' + l.preferredTime : '')]);
  if (l.nextFollowup) specs.push(['Follow-up', fmtD(l.nextFollowup)]);
  if (l.externalId) specs.push(['Lead ID', l.externalId + (l.materialSent ? ' · Material: ' + l.materialSent : '')]);

  const stats = [['Calls', l.callCount], ['SMS', l.smsCount], ['WhatsApp', l.whatsappCount], ['Visits', l.visitCount]];

  return (
    <div className="ld-card">
      <div className="ld-hero">
        <div className="ld-eyebrow">{eyebrow}</div>
        <h2 className="ld-name">{l.name}</h2>
        <div className="ld-tags">
          <span className={`bdg ${sclass(l.status)}`}>{STATUS_LABELS[l.status] || l.status}</span>
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

      <div className="ld-specs">
        {specs.map(([k, v]) => (
          <div key={k} className="ld-spec">
            <span className="ld-spec-k">{k}</span>
            <span className="ld-spec-v">{v}</span>
          </div>
        ))}
      </div>

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

  const doDoneVisit = () => {
    doneVisit(l.id, user);
    refreshDB();
    showToast('Visit marked as done', 'ok');
  };

  const btns = [];

  if (r === ROLES.IA) {
    if (l.status === 'NEW') btns.push(
      <button key="contacted" className="btn btn-p btn-full" onClick={() => doStatus('CONTACTED')}>
        <Mi>phone_callback</Mi>Mark as Contacted
      </button>
    );
    if (l.status === 'CONTACTED') btns.push(
      <button key="interested" className="btn btn-success btn-full" onClick={() => doStatus('INTERESTED')}>
        <Mi>thumb_up</Mi>Mark as Interested
      </button>
    );
    if (l.status === 'INTERESTED' && l.assignedRole === ROLES.IA) btns.push(
      <button key="fwd-ma" className="btn btn-teal btn-full" onClick={() => openModal('forward-ma')}>
        <Mi>forward_to_inbox</Mi>Forward to Meeting Agent
      </button>
    );
    if (['NEW', 'CONTACTED', 'INTERESTED'].includes(l.status)) btns.push(
      <button key="notint" className="btn btn-g btn-full" onClick={doNotInterested}>
        <Mi>thumb_down</Mi>Not Interested
      </button>
    );
  }

  if (r === ROLES.MA) {
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
    if (l.status === 'SITE_VISIT_DONE' && l.assignedRole === ROLES.MA) btns.push(
      <button key="fwd-tl" className="btn btn-purple btn-full" onClick={() => openModal('forward-tl')}>
        <Mi>forward_to_inbox</Mi>Forward to Team Lead
      </button>
    );
  }

  if (r === ROLES.TL || r === ROLES.MGMT) {
    if (['SITE_VISIT_DONE', 'NEGOTIATING'].includes(l.status)) btns.push(
      <button key="deal" className="btn btn-success btn-full" onClick={() => openModal('deal')}>
        <Mi>emoji_events</Mi>Close as Won
      </button>
    );
    if (l.status === 'SITE_VISIT_DONE') btns.push(
      <button key="neg" className="btn btn-warn btn-full" onClick={() => doStatus('NEGOTIATING')}>
        <Mi>balance</Mi>Mark as Negotiating
      </button>
    );
    if (['SITE_VISIT_DONE', 'NEGOTIATING'].includes(l.status)) {
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
  const canDelete = user?.role === ROLES.TL || user?.role === ROLES.MGMT;

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
          <div className="p-ttl">{l ? l.name : 'Customer Details'}</div>
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
