import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import { getDB, fwdLead, getProperties, updLead, offerComplete, setMeeting } from '../../lib/db.js';
import { sbGetUsersLite, rToU } from '../../lib/supabase.js';
import { avc, ini, rlabel, fmtBDT } from '../../lib/helpers.js';
import { ROLES, OFFER_MAX } from '../../lib/constants.js';
import useLeadBook from '../../hooks/useLeadBook.js';

// Things the agent may have already shared with the client (clickable).
const SHARED_OPTS = [
  { key: 'price', label: 'Price idea', icon: 'sell' },
  { key: 'brochure', label: 'Brochure', icon: 'description' },
  { key: 'video', label: 'Video', icon: 'videocam' },
  { key: 'image', label: 'Image', icon: 'image' },
];
// Working-hour windows by meeting type (24h).
const HOURS = { ONLINE: { min: 10, max: 22, label: '10 AM – 10 PM' }, OFFLINE: { min: 10, max: 18, label: '10 AM – 6 PM' } };
// Same role→badge-tone mapping as the Accounts roster, so a role reads the
// same color everywhere in the app.
const ROLE_BADGE_CLS = { AGENT: 's-new', TEAM_LEAD: 's-negotiating', MANAGEMENT: 's-deal_closed_won', EXECUTIVE: 's-negotiating' };

// Three flows share this modal:
//   forward-tl     pick a Team Lead, then the offer (the lead changes hands)
//   forward-agent  pick another agent on the team; the lead changes hands at
//                  its current stage, no second step
//   set-meeting  the Agent books the client meeting on their own lead — no
//                hand-off, so it opens straight on the meeting step
export default function ForwardModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isMA = modal === 'set-meeting';
  const isTL = modal === 'forward-tl';
  const isAG = modal === 'forward-agent';
  const isOpen = isMA || isTL || isAG;
  // Gated on isOpen: this modal is mounted on every page (App.jsx renders it
  // unconditionally and it returns null when closed), so an ungated call pulled
  // the entire lead book on every screen in the app — including before login,
  // where there is no user yet and the fetch came out unscoped.
  useLeadBook(isOpen);

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
  // Who this lead can be forwarded to. Fetched, not filtered from db.users: an
  // agent's snapshot holds only its own user row since the load became
  // per-account, so its teammates are simply not in it.
  const [targets, setTargets] = useState([]);
  const [pq, setPq] = useState('');

  const targetRole = isAG ? ROLES.AGENT : ROLES.TL;
  const toggleShared = (k) => setShared(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k]);

  if (useChanged(isOpen && modal) && isOpen) {
    setSelected(null); setStep(isMA ? 2 : 1); setProjectId(''); setOurOffer(''); setClientOffer(''); setTotalSft(''); setOfferNotes('');
    setMeetingType('ONLINE'); setMeetingAt(''); setMeetingLink(''); setShared([]); setTargets([]); setPq('');
  }

  const db = getDB();

  useEffect(() => {
    if (!(isTL || isAG) || !user?.teamId) return;
    let live = true;
    // Agent hand-off: every other agent on the team, including the Team Lead —
    // Executives work leads as agents too (see effectiveRole), so they are
    // valid recipients. (This is a plain reassignment, not the SITE_VISIT_DONE
    // → Team Lead closing hand-off below, which still requires an offer.)
    const roleQ = isAG ? `role=in.(${ROLES.AGENT},${ROLES.EXEC},${ROLES.TL})` : `role=eq.${targetRole}`;
    sbGetUsersLite(`${roleQ}&team_id=eq.${user.teamId}&is_active=not.eq.false`)
      .then(rows => { if (live) setTargets((rows || []).map(rToU).filter(u => u.id !== user.id).sort((a, b) => (a.name || '').localeCompare(b.name || ''))); });
    return () => { live = false; };
  }, [isTL, isAG, targetRole, user?.teamId, user?.id]);

  // Project catalog + live demand (how many leads already interested in each project)
  const projects = [...getProperties()].sort((a, b) => a.name.localeCompare(b.name));
  const demand = {};
  db.leads.forEach(l => { const k = l.dealProjectName || l.propertyInterest; if (k) demand[k] = (demand[k] || 0) + 1; });
  const project = projects.find(p => p.id === projectId) || null;

  const pipelineValue = totalSft && clientOffer ? parseFloat(totalSft) * parseFloat(clientOffer) : 0;
  const offerReady = offerComplete({ ourOffer: parseFloat(ourOffer) || 0, clientOffer: parseFloat(clientOffer) || 0, totalSft: parseFloat(totalSft) || 0 });
  // Both prices are a rate per SFT, so a sixth digit is always a mistake — a
  // total deal price typed into a per-SFT field. Refuse the keystroke rather
  // than the submit, so the number on screen is the number that gets sent.
  const onRate = (set) => (e) => { const v = e.target.value; if (v === '' || (/^\d{1,5}(\.\d*)?$/.test(v) && parseFloat(v) <= OFFER_MAX)) set(v); };

  const submit = () => {
    if (!panLead) return;

    // Set Meeting: require a meeting time inside the working-hour window for the type.
    if (isMA) {
      if (!meetingAt) { showToast('Pick a meeting date & time', 'err'); return; }
      const d = new Date(meetingAt);
      const h = d.getHours() + d.getMinutes() / 60;
      const w = HOURS[meetingType];
      if (h < w.min || h > w.max) { showToast(`${meetingType === 'ONLINE' ? 'Online' : 'Offline'} meetings must be within ${w.label}`, 'err'); return; }
      if (meetingType === 'ONLINE' && !meetingLink.trim()) { showToast('Add the online meeting link', 'err'); return; }
      setMeeting(panLead, { meetingType, meetingAt: d.toISOString(), meetingLink: meetingType === 'ONLINE' ? meetingLink.trim() : '', meetingShared: shared }, user);
      closeModal();
      refreshDB();
      showToast('Meeting set', 'ok');
      return;
    }

    const toUser = selected ? targets.find(u => u.id === selected) : null;
    if (!toUser) return;

    const offerData = isTL ? {
      ourOffer: parseFloat(ourOffer) || 0,
      clientOffer: parseFloat(clientOffer) || 0,
      totalSft: parseFloat(totalSft) || 0,
      pipelineValue,
      projectId: project?.id || '',
      projectName: project?.name || '',
      notes: offerNotes.trim(),
    } : null;
    // A Team Lead hand-off carries an offer or it does not happen: the closing
    // pipeline only lists leads with one, so a lead forwarded without it would
    // land nowhere. fwdLead enforces the same rule.
    if (isTL && !offerComplete(offerData)) {
      const overCap = offerData.ourOffer > OFFER_MAX || offerData.clientOffer > OFFER_MAX;
      showToast(overCap
        ? `Offer rates are per SFT — 5 digits at most (${OFFER_MAX})`
        : 'Enter our rate, the client rate and total SFT before forwarding', 'err');
      return;
    }
    if (!fwdLead(panLead, toUser, user, offerData)) { showToast('Could not forward this lead', 'err'); return; }
    if (isTL && project) updLead(panLead, { dealProjectId: project.id, dealProjectName: project.name, propertyInterest: project.name });
    closeModal();
    refreshDB();
    showToast('Lead forwarded to ' + toUser.name, 'ok');
  };

  const selectedUser = selected ? targets.find(u => u.id === selected) : null;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">{isMA ? 'Set Meeting' : isAG ? 'Forward to Teammate' : 'Forward to ' + rlabel(targetRole)}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>

        {/* Step 1 — select agent */}
        {step === 1 && (
          <>
            <div className="m-body">
              <div className="fwd-search">
                <Mi>search</Mi>
                <input
                  placeholder={isAG ? 'Search teammate…' : 'Search ' + rlabel(targetRole).toLowerCase() + '…'}
                  value={pq} onChange={e => setPq(e.target.value)} autoFocus
                />
              </div>
              <div className="fwd-list">
                {targets
                  .filter(u => { const q = pq.trim().toLowerCase(); return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q); })
                  .map(u => (
                    <button type="button" key={u.id} className={`fwd-row${selected === u.id ? ' on' : ''}`} onClick={() => setSelected(u.id)}>
                      <div className="fwd-av" style={{ background: avc(u.name) }}>{ini(u.name)}</div>
                      <div className="fwd-mid">
                        <div className="fwd-name">{u.name}</div>
                        <div className="fwd-email">{u.email}</div>
                      </div>
                      <span className={`bdg ${ROLE_BADGE_CLS[u.role] || 's-new'}`}>{rlabel(u.role)}</span>
                      <Mi className="fwd-ck">{selected === u.id ? 'check_circle' : 'radio_button_unchecked'}</Mi>
                    </button>
                  ))}
                {!targets.length && <div className="fwd-empty"><Mi>group_off</Mi>No other teammates yet</div>}
                {!!targets.length && !targets.some(u => !pq.trim() || u.name.toLowerCase().includes(pq.trim().toLowerCase()) || u.email.toLowerCase().includes(pq.trim().toLowerCase())) && (
                  <div className="fwd-empty"><Mi>search_off</Mi>No match for "{pq}"</div>
                )}
              </div>
            </div>
            <div className="m-ft">
              <button className="btn btn-g" onClick={closeModal}>Cancel</button>
              {isAG
                ? <button className="btn btn-p" disabled={!selected} onClick={submit}><Mi>swap_horiz</Mi>Forward</button>
                : <button className="btn btn-p" disabled={!selected} onClick={() => setStep(2)}>Next</button>}
            </div>
          </>
        )}

        {/* Step 2 — offer details (TL only) */}
        {step === 2 && isTL && (
          <>
            <div className="m-body">
              <div className="m-hint" style={{ marginBottom: '14px' }}>
                <Mi>price_check</Mi>An offer is required — <strong>{selectedUser?.name}</strong> only sees leads that carry one.
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
                <label>Our Offer Rate (BDT per SFT) *</label>
                <input className="finp" type="number" max={OFFER_MAX} placeholder="e.g. 10500" value={ourOffer} onChange={onRate(setOurOffer)} />
                <div className="fi-hint">{ourOffer ? `${fmtBDT(parseFloat(ourOffer))} per SFT` : `Per square foot · max 5 digits (${OFFER_MAX})`}</div>
              </div>
              <div className="fl">
                <label>Client Offer Rate (BDT per SFT) *</label>
                <input className="finp" type="number" max={OFFER_MAX} placeholder="e.g. 9500" value={clientOffer} onChange={onRate(setClientOffer)} />
                <div className="fi-hint">{clientOffer ? `${fmtBDT(parseFloat(clientOffer))} per SFT` : `Per square foot · max 5 digits (${OFFER_MAX})`}</div>
              </div>
              <div className="fl">
                <label>Total SFT *</label>
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
              <button className="btn btn-p" disabled={!offerReady} onClick={submit}>Forward</button>
            </div>
          </>
        )}

        {/* Step 2 — meeting details (MA only) */}
        {step === 2 && isMA && (
          <>
            <div className="m-body">
              <div className="m-hint" style={{ marginBottom: '14px' }}>
                <Mi>event</Mi>Book the client meeting. The lead stays with you and moves to Meeting Set.
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
                  <div className="fi-hint"><Mi>link</Mi>Saved on the lead</div>
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
              <button className="btn btn-g" onClick={closeModal}>Cancel</button>
              <button className="btn btn-p" onClick={submit}><Mi>event_available</Mi>Set Meeting</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
