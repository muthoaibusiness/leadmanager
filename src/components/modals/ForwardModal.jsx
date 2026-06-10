import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, fwdLead, getProperties, updLead } from '../../lib/db.js';
import { avc, ini, rlabel, fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

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

  const targetRole = isMA ? ROLES.MA : ROLES.TL;

  useEffect(() => {
    if (isOpen) { setSelected(null); setStep(1); setProjectId(''); setOurOffer(''); setClientOffer(''); setTotalSft(''); setOfferNotes(''); }
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
              {isTL ? (
                <button className="btn btn-p" disabled={!selected} onClick={() => setStep(2)}>Next</button>
              ) : (
                <button className="btn btn-p" disabled={!selected} onClick={submit}>Forward</button>
              )}
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
      </div>
    </div>
  );
}
