import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { addCampaign, updateCampaign } from '../../lib/db.js';
import { CAMPAIGN_PLATFORMS, CAMPAIGN_STATUS } from '../../lib/constants.js';

// <input type="date"> wants yyyy-mm-dd; the DB stores full ISO timestamps.
const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const fromDateInput = (v) => (v ? new Date(v + 'T00:00:00').toISOString() : null);

const EMPTY = { name: '', platform: CAMPAIGN_PLATFORMS[0], cost: '', startDate: '', endDate: '', status: 'ACTIVE' };

export default function CampaignModal() {
  const { modal, closeModal, campEdit, user, refreshDB, showToast } = useApp();
  const isOpen = modal === 'campaign';
  const isEdit = !!campEdit?.id;
  const [f, setF] = useState(EMPTY);

  useEffect(() => {
    if (!isOpen) return;
    setF(isEdit
      ? {
          name: campEdit.name || '',
          platform: campEdit.platform || CAMPAIGN_PLATFORMS[0],
          cost: campEdit.cost || '',
          startDate: toDateInput(campEdit.startDate),
          endDate: toDateInput(campEdit.endDate),
          status: campEdit.status || 'ACTIVE',
        }
      : EMPTY);
  }, [isOpen, campEdit?.id]);

  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));

  const submit = () => {
    const name = f.name.trim();
    if (!name) { showToast('Campaign name is required', 'err'); return; }
    const cost = parseFloat(f.cost) || 0;
    if (cost < 0) { showToast('Cost cannot be negative', 'err'); return; }
    if (f.startDate && f.endDate && new Date(f.endDate) < new Date(f.startDate)) {
      showToast('End date cannot be before the start date', 'err'); return;
    }
    const payload = {
      name, platform: f.platform, cost, status: f.status,
      startDate: fromDateInput(f.startDate), endDate: fromDateInput(f.endDate),
    };
    if (isEdit) updateCampaign(campEdit.id, payload);
    else addCampaign({ ...payload, companyId: user.companyId });
    closeModal(); refreshDB();
    showToast(isEdit ? 'Campaign updated' : 'Campaign created', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">{isEdit ? 'Edit Campaign' : 'New Campaign'}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg">
            <label>Campaign Name *</label>
            <input className="fi" type="text" placeholder="e.g. Ramadan Launch — Gulshan" value={f.name} onChange={set('name')} />
          </div>
          <div className="fg-row">
            <div className="fg">
              <label>Platform</label>
              <select className="fi" value={f.platform} onChange={set('platform')}>
                {CAMPAIGN_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Status</label>
              <select className="fi" value={f.status} onChange={set('status')}>
                {Object.entries(CAMPAIGN_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="fg">
            <label>Cost (BDT) <span className="fg-hint">— total spend, drives cost per lead</span></label>
            <input className="fi" type="number" min="0" step="any" placeholder="e.g. 50000" value={f.cost} onChange={set('cost')} />
          </div>
          <div className="fg-row">
            <div className="fg"><label>Start Date</label><input className="fi" type="date" value={f.startDate} onChange={set('startDate')} /></div>
            <div className="fg"><label>End Date</label><input className="fi" type="date" value={f.endDate} onChange={set('endDate')} /></div>
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}><Mi>save</Mi>{isEdit ? 'Save Changes' : 'Create Campaign'}</button>
        </div>
      </div>
    </div>
  );
}
