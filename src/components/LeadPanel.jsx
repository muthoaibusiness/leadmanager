import { useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useState } from 'react';
import { getLead, getActs, changeStatus, doneVisit, deleteLead, updLead, addAct } from '../lib/db.js';
import { avc, ini, fmtD, fmtDT, fmtBDT, fmtAgo, rlabel, actIcon, actClr, scoreLead, scoreLabel } from '../lib/helpers.js';
import { ROLES, STATUS_LABELS, SRC_LABELS } from '../lib/constants.js';

function sclass(s) { return 's-' + (s || '').toLowerCase(); }
function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }

function LeadInfo({ l }) {
  const c = avc(l.name);
  return (
    <div className="li-card">
      <div className="li-top">
        <div className="li-av" style={{ background: c, borderRadius: '14px' }}>{ini(l.name)}</div>
        <div className="li-info" style={{ flex: 1 }}>
          <div className="li-n">{l.name}</div>
          {l.company && l.company !== '—' && <div className="li-co">{l.company}</div>}
          <div className="li-ct">
            {(l.phones?.length ? l.phones : [l.phone]).filter(Boolean).map((p, i) => (
              <div key={i} className="li-cr">
                <Mi>call</Mi><a href={`tel:${p}`}>{p}{i === 0 && l.phones?.length > 1 ? ' (primary)' : ''}</a>
                <a className="wa-btn" href={`https://wa.me/${p.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" title="WhatsApp"><Mi>chat</Mi></a>
              </div>
            ))}
            {(l.emails?.length ? l.emails : l.email ? [l.email] : []).filter(Boolean).map((e, i) => (
              <div key={i} className="li-cr"><Mi>mail</Mi><a href={`mailto:${e}`}>{e}</a></div>
            ))}
          </div>
        </div>
      </div>
      <div className="li-bdg">
        <span className={`bdg ${sclass(l.status)}`}>{STATUS_LABELS[l.status] || l.status}</span>
        <span className={`bdg ${srcclass(l.source)}`}>{SRC_LABELS[l.source] || l.source}</span>
      </div>
      {l.propertyInterest && (
        <div className="li-prop">
          <Mi>apartment</Mi>{l.propertyInterest}{l.budget ? ' · ' + fmtBDT(l.budget) : ''}
        </div>
      )}
      {l.dealValue > 0 && (
        <div className="li-deal-row"><Mi>payments</Mi><strong>{fmtBDT(l.dealValue)}</strong></div>
      )}
      <div className="info-row"><Mi>person</Mi>Assigned to <strong>{l.assignedToName}</strong> · {rlabel(l.assignedRole)}</div>
      {l.meetingDate && (
        <div className="info-row"><Mi>calendar_month</Mi>Visit: {fmtDT(l.meetingDate)}{l.meetingLocation ? ' at ' + l.meetingLocation : ''}</div>
      )}
      {l.profession && !l.city && <div className="info-row"><Mi>work</Mi>{l.profession}</div>}
      {l.city && <div className="info-row"><Mi>location_city</Mi>{l.city}{l.profession ? ' · ' + l.profession : ''}</div>}
      {l.priority && <div className="info-row"><Mi>flag</Mi>Priority {l.priority}{l.preferredTime ? ' · Preferred: ' + l.preferredTime : ''}</div>}
      {l.nextFollowup && <div className="info-row"><Mi>event</Mi>Follow-up: {fmtD(l.nextFollowup)}</div>}
      {l.externalId && <div className="info-row"><Mi>tag</Mi>ID: {l.externalId}{l.materialSent ? ' · Material sent: ' + l.materialSent : ''}</div>}
      <div className="li-mg">
        <div className="li-ms"><div className="li-msv">{l.callCount || 0}</div><div className="li-msl">Calls</div></div>
        <div className="li-ms"><div className="li-msv">{l.smsCount || 0}</div><div className="li-msl">SMS</div></div>
        <div className="li-ms"><div className="li-msv">{l.whatsappCount || 0}</div><div className="li-msl">WhatsApp</div></div>
        <div className="li-ms"><div className="li-msv">{l.visitCount || 0}</div><div className="li-msl">Visits</div></div>
      </div>
    </div>
  );
}

function Actions({ l }) {
  const { user, openModal, setFwdTarget, setPanLead, refreshDB, showToast } = useApp();
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [callMins, setCallMins] = useState('');
  const r = user?.role;

  const submitCall = () => {
    const mins = parseFloat(callMins) || 0;
    const secs = Math.round(mins * 60);
    updLead(l.id, { callCount: (l.callCount || 0) + 1 });
    addAct(l.id, { type: 'CALL', description: 'Call logged' + (mins > 0 ? ' · ' + mins + ' min' : '') + ' (total: ' + ((l.callCount || 0) + 1) + ')', userId: user.id, userName: user.name, durationSeconds: secs });
    refreshDB();
    showToast('Call logged' + (mins > 0 ? ' (' + mins + ' min)' : ''), 'ok');
    setLogCallOpen(false);
    setCallMins('');
  };

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
        <button key="follow-up" className="btn btn-full" style={{ background: '#fef3c7', color: '#92400e' }} onClick={() => openModal('follow-up')}>
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
      {!logCallOpen ? (
        <button className="btn btn-full" style={{ background: '#eff6ff', color: '#1d4ed8' }} onClick={() => setLogCallOpen(true)}>
          <Mi>call</Mi>Log Call
        </button>
      ) : (
        <div className="log-call-box">
          <div className="log-call-header">
            <div className="log-call-icon"><Mi>call</Mi></div>
            <div>
              <div className="log-call-title">Call Duration</div>
              <div className="log-call-sub">How long was the call?</div>
            </div>
            <button className="log-call-close" onClick={() => { setLogCallOpen(false); setCallMins(''); }}><Mi>close</Mi></button>
          </div>
          <div className="log-call-chips">
            {[1, 2, 5, 10, 15, 30].map(m => (
              <button key={m} className={`lc-chip${callMins == m ? ' active' : ''}`} onClick={() => setCallMins(String(m))}>
                <span className="lc-chip-val">{m}</span>
                <span className="lc-chip-unit">min</span>
              </button>
            ))}
          </div>
          <div className="log-call-custom">
            <input
              className="log-call-inp"
              type="number"
              min="0"
              step="0.5"
              placeholder="Custom minutes..."
              value={callMins}
              onChange={e => setCallMins(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitCall(); if (e.key === 'Escape') { setLogCallOpen(false); setCallMins(''); } }}
            />
          </div>
          <button className="log-call-save" onClick={submitCall}>
            <Mi>check_circle</Mi>
            Save Call{callMins > 0 ? ` · ${callMins} min` : ''}
          </button>
        </div>
      )}
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
  if (!acts.length) {
    return (
      <div className="tl">
        <div className="tl-ttl">Activity Timeline</div>
        <div className="empty"><Mi>history</Mi><p>No activity yet</p></div>
      </div>
    );
  }
  return (
    <div className="tl">
      <div className="tl-ttl">Activity Timeline</div>
      {acts.map(a => (
        <div key={a.id} className="tl-item">
          <div className="tl-dot" style={{ background: actClr(a.type) }}>
            <Mi>{actIcon(a.type)}</Mi>
          </div>
          <div className="tl-bd">
            {a.userName && a.userName !== 'system' && (
              <div className="tl-actor" style={{ color: actClr(a.type) }}>{a.userName}</div>
            )}
            <div className="tl-desc">{a.description}</div>
            {a.durationSeconds > 0 && (
              <div className="tl-dur">{Math.floor(a.durationSeconds / 60)}m {a.durationSeconds % 60}s</div>
            )}
            <div className="tl-time">{fmtDT(a.timestamp)}</div>
          </div>
        </div>
      ))}
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
    showToast('Lead deleted', 'ok');
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
          <div className="p-ttl">{l ? l.name : 'Lead Details'}</div>
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
