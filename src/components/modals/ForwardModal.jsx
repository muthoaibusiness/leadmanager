import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, fwdLead, getProperties, updLead } from '../../lib/db.js';
import { avc, ini, rlabel, fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

// Things the Initial Agent may have already shared with the client (clickable).
const SHARED_OPTS = [
  { key: 'price', label: 'Price idea', icon: 'sell' },
  { key: 'brochure', label: 'Brochure', icon: 'description' },
  { key: 'video', label: 'Video', icon: 'videocam' },
  { key: 'image', label: 'Image', icon: 'image' },
];
// Working-hour windows by meeting type (24h).
const HOURS = { ONLINE: { min: 10, max: 22, label: '10 AM – 10 PM' }, OFFLINE: { min: 10, max: 18, label: '10 AM – 6 PM' } };

export default function ForwardModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isMA = modal === 'forward-ma';
  const isTL = modal === 'forward-tl';
  const isOpen = isMA || isTL;

  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [ourOffer, setOurOffer] = useState('');
  const [clientOffer, setClientOffer] = useState('');
  const [totalSft, setTotalSft] = useState('');
  const [offerNotes, setOfferNotes] = useState('');
  // MA hand-off: meeting type/time + what was already shared.
  const [meetingType, setMeetingType] = useState('ONLINE');
  const [meetingAt, setMeetingAt] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [shared, setShared] = useState([]);

  const targetRole = isMA ? ROLES.MA : ROLES.TL;
  const toggleShared = (k) => setShared(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k]);

  useEffect(() => {
    if (isOpen) {
      setSelected(null); setStep(1); setProjectId(''); setOurOffer(''); setClientOffer(''); setTotalSft(''); setOfferNotes('');
      setMeetingType('ONLINE'); setMeetingAt(''); setMeetingLink(''); setShared([]);
    }
  }, [isOpen]);

  const db = getDB();
  const targets = db.users.filter(u => u.role === targetRole && u.teamId === user?.teamId);

  // Project catalog + live demand (how many leads already interested in each project)
  const projects = [...getProperties()].sort((a, b) => a.name.localeCompare(b.name));
  const demand = {};
  db.leads.forEach(l => { const k = l.dealProjectName || l.propertyInterest; if (k) demand[k] = (demand[k] || 0) + 1; });
  const project = projects.find(p => p.id === projectId) || null;

  const pipelineValue = totalSft && clientOffer ? parseFloat(totalSft) * parseFloat(clientOffer) : 0;

  const submit = () => {
    if (!selected || !panLead) return;
    const toUser = db.users.find(u => u.id === selected);
    if (!toUser) return;

    // MA hand-off: require a meeting time inside the working-hour window for the type.
    if (isMA) {
      if (!meetingAt) { showToast('Pick a meeting date & time', 'err'); return; }
      const d = new Date(meetingAt);
      const h = d.getHours() + d.getMinutes() / 60;
      const w = HOURS[meetingType];
      if (h < w.min || h > w.max) { showToast(`${meetingType === 'ONLINE' ? 'Online' : 'Offline'} meetings must be within ${w.label}`, 'err'); return; }
      if (meetingType === 'ONLINE' && !meetingLink.trim()) { showToast('Add the online meeting link', 'err'); return; }
    }

    const offerData = isTL ? {
      ourOffer: parseFloat(ourOffer) || 0,
      clientOffer: parseFloat(clientOffer) || 0,
      totalSft: parseFloat(totalSft) || 0,
      pipelineValue,
      projectId: project?.id || '',
      projectName: project?.name || '',
      notes: offerNotes.trim(),
    } : null;
    fwdLead(panLead, toUser, user, offerData);
    if (isTL && project) updLead(panLead, { dealProjectId: project.id, dealProjectName: project.name, propertyInterest: project.name });
    if (isMA) updLead(panLead, { meetingType, meetingAt: new Date(meetingAt).toISOString(), meetingLink: meetingType === 'ONLINE' ? meetingLink.trim() : '', meetingShared: shared });
    closeModal();
    refreshDB();
    showToast('Lead forwarded to ' + toUser.name, 'ok');
  };

  const selectedUser = selected ? db.users.find(u => u.id === selected) : null;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Forward to {rlabel(targetRole)}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>

        {/* Step 1 — select agent */}
        {step === 1 && (
          <>
            <div className="m-body">
              <div className="fl">
                <label>Select {rlabel(targetRole)}</label>
                <select className="finp" value={selected || ''} onChange={e => setSelected(e.target.value)}>
                  <option value="">— Choose an agent —</option>
                  {targets.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
              </div>
              {selected && (() => { const u = targets.find(x => x.id === selected); return u ? (
                <div className="ap-preview">
                  <div className="ap-av" style={{ background: avc(u.name) }}>{ini(u.name)}</div>
                  <div><div className="ap-n">{u.name}</div><div className="ap-r">{rlabel(u.role)} · {u.email}</div></div>
                </div>
              ) : null; })()}
            </div>
            <div className="m-ft">
              <button className="btn btn-g" onClick={closeModal}>Cancel</button>
              <button className="btn btn-p" disabled={!selected} onClick={() => setStep(2)}>Next</button>
            </div>
          </>
        )}

        {/* Step 2 — offer details (TL only) */}
        {step === 2 && isTL && (
          <>
            <div className="m-body">
              <div className="m-hint" style={{ marginBottom: '14px' }}>
                <Mi>price_check</Mi>Enter offer details before forwarding to <strong>{selectedUser?.name}</strong>.
              </div>
              <div className="fl">
                <label>Project</label>
                <select className="finp" value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">— Select project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.area ? ' · ' + p.area : ''}{demand[p.name] ? ' · ' + demand[p.name] + ' interested' : ''}
                    </option>
                  ))}
                </select>
                {project && (
                  <div className="fi-hint">
                    {(demand[project.name] || 0)} lead{(demand[project.name] || 0) === 1 ? '' : 's'} already interested in {project.name}
                  </div>
                )}
              </div>
              <div className="fl">
                <label>Our Offer Price (BDT)</label>
                <input className="finp" type="number" placeholder="e.g. 5000000" value={ourOffer} onChange={e => setOurOffer(e.target.value)} />
                {ourOffer && <div className="fi-hint">{fmtBDT(parseFloat(ourOffer))}</div>}
              </div>
              <div className="fl">
                <label>Client Offer Price (BDT)</label>
                <input className="finp" type="number" placeholder="e.g. 4500000" value={clientOffer} onChange={e => setClientOffer(e.target.value)} />
                {clientOffer && <div className="fi-hint">{fmtBDT(parseFloat(clientOffer))}</div>}
              </div>
              <div className="fl">
                <label>Total SFT</label>
                <input className="finp" type="number" placeholder="e.g. 1200" value={totalSft} onChange={e => setTotalSft(e.target.value)} />
              </div>
              {pipelineValue > 0 && (
                <div className="pipeline-val">
                  <Mi>trending_up</Mi>
                  <div>
                    <div className="pipeline-val-label">Pipeline Value</div>
                    <div className="pipeline-val-num">{fmtBDT(pipelineValue)}</div>
                    <div className="pipeline-val-sub">{totalSft} SFT × {fmtBDT(parseFloat(clientOffer))}</div>
                  </div>
                </div>
              )}
              <div className="fl">
                <label>Negotiation Notes (optional)</label>
                <textarea className="finp" rows={3} placeholder="Any context for the Team Lead…" value={offerNotes} onChange={e => setOfferNotes(e.target.value)} />
              </div>
            </div>
            <div className="m-ft">
              <button className="btn btn-g" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-p" onClick={submit}>Forward</button>
            </div>
          </>
        )}

        {/* Step 2 — meeting details (MA only) */}
        {step === 2 && isMA && (
          <>
            <div className="m-body">
              <div className="m-hint" style={{ marginBottom: '14px' }}>
                <Mi>event</Mi>Set up the meeting for <strong>{selectedUser?.name}</strong>.
              </div>

              {/* Meeting type */}
              <div className="fl">
                <label>Meeting type</label>
                <div className="seg">
                  <button type="button" className={`seg-b${meetingType === 'ONLINE' ? ' on' : ''}`} onClick={() => setMeetingType('ONLINE')}>
                    <Mi>videocam</Mi>Online
                  </button>
                  <button type="button" className={`seg-b${meetingType === 'OFFLINE' ? ' on' : ''}`} onClick={() => setMeetingType('OFFLINE')}>
                    <Mi>store</Mi>Offline
                  </button>
                </div>
              </div>

              {/* Meeting time within working hours */}
              <div className="fl">
                <label>Meeting time</label>
                <input className="finp" type="datetime-local" value={meetingAt} onChange={e => setMeetingAt(e.target.value)} />
                <div className="fi-hint"><Mi>schedule</Mi>Within working hours · {HOURS[meetingType].label}</div>
              </div>

              {/* Online meetings need a join link */}
              {meetingType === 'ONLINE' && (
                <div className="fl">
                  <label>Meeting link</label>
                  <input className="finp" type="url" placeholder="https://meet.google.com/… or Zoom link" value={meetingLink} onChange={e => setMeetingLink(e.target.value)} />
                  <div className="fi-hint"><Mi>link</Mi>Shared with the Meeting Agent</div>
                </div>
              )}

              {/* Already shared */}
              <div className="fl">
                <label>Already shared with client</label>
                <div className="chip-grid">
                  {SHARED_OPTS.map(o => (
                    <button type="button" key={o.key} className={`chip-sel${shared.includes(o.key) ? ' on' : ''}`} onClick={() => toggleShared(o.key)}>
                      <Mi>{o.icon}</Mi>{o.label}
                      {shared.includes(o.key) && <Mi className="chip-ck">check</Mi>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="m-ft">
              <button className="btn btn-g" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-p" onClick={submit}>Forward</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
