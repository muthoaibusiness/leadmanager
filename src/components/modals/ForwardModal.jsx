import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, fwdLead } from '../../lib/db.js';
import { avc, ini, rlabel, fmtBDT } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function ForwardModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast } = useApp();
  const isMA = modal === 'forward-ma';
  const isTL = modal === 'forward-tl';
  const isOpen = isMA || isTL;

  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState(null);
  const [ourOffer, setOurOffer] = useState('');
  const [clientOffer, setClientOffer] = useState('');
  const [offerNotes, setOfferNotes] = useState('');

  const targetRole = isMA ? ROLES.MA : ROLES.TL;

  useEffect(() => {
    if (isOpen) { setSelected(null); setStep(1); setOurOffer(''); setClientOffer(''); setOfferNotes(''); }
  }, [isOpen]);

  const db = getDB();
  const targets = db.users.filter(u => u.role === targetRole && u.teamId === user?.teamId);

  const submit = () => {
    if (!selected || !panLead) return;
    const toUser = db.users.find(u => u.id === selected);
    if (!toUser) return;
    const offerData = isTL ? { ourOffer: parseFloat(ourOffer) || 0, clientOffer: parseFloat(clientOffer) || 0, notes: offerNotes.trim() } : null;
    fwdLead(panLead, toUser, user, offerData);
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
              <div className="m-hint"><Mi>info</Mi>Select a {rlabel(targetRole)} to assign this lead.</div>
              <div className="ap-list">
                {targets.map(u => (
                  <div key={u.id} className={`ap-item${selected === u.id ? ' sel' : ''}`} onClick={() => setSelected(u.id)}>
                    <div className="ap-av" style={{ background: avc(u.name) }}>{ini(u.name)}</div>
                    <div><div className="ap-n">{u.name}</div><div className="ap-r">{u.email}</div></div>
                  </div>
                ))}
              </div>
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

        {/* Step 2 — offer prices (TL only) */}
        {step === 2 && isTL && (
          <>
            <div className="m-body">
              <div className="m-hint" style={{ marginBottom: '14px' }}>
                <Mi>price_check</Mi>Enter offer details before forwarding to <strong>{selectedUser?.name}</strong>.
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
