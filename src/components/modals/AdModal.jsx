import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { addAd, updateAd, getCampaign } from '../../lib/db.js';
import { AD_SOURCE_APPS } from '../../lib/constants.js';

const EMPTY = { title: '', body: '', sourceUrl: '', greetingMessage: '', sourceApp: AD_SOURCE_APPS[0], adId: '' };

export default function AdModal() {
  const { modal, closeModal, adEdit, campSel, user, refreshDB, showToast } = useApp();
  const isOpen = modal === 'ad';
  const isEdit = !!adEdit?.id;
  const [f, setF] = useState(EMPTY);

  // An ad always belongs to a campaign: the one being edited, or the one drilled into.
  const campaignId = adEdit?.campaignId || campSel;
  const campaign = campaignId ? getCampaign(campaignId) : null;

  useEffect(() => {
    if (!isOpen) return;
    setF(isEdit
      ? {
          title: adEdit.title || '',
          body: adEdit.body || '',
          sourceUrl: adEdit.sourceUrl || '',
          greetingMessage: adEdit.greetingMessage || '',
          sourceApp: adEdit.sourceApp || AD_SOURCE_APPS[0],
          adId: adEdit.adId || '',
        }
      : EMPTY);
  }, [isOpen, adEdit?.id]);

  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));

  const submit = () => {
    const title = f.title.trim();
    if (!title) { showToast('Ad title is required', 'err'); return; }
    if (!campaignId) { showToast('Pick a campaign before adding an ad', 'err'); return; }
    const payload = {
      title, body: f.body.trim(), sourceUrl: f.sourceUrl.trim(),
      greetingMessage: f.greetingMessage.trim(), sourceApp: f.sourceApp, adId: f.adId.trim(),
    };
    if (isEdit) updateAd(adEdit.id, payload);
    else addAd({ ...payload, campaignId, companyId: user.companyId });
    closeModal(); refreshDB();
    showToast(isEdit ? 'Ad updated' : 'Ad added', 'ok');
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">{isEdit ? 'Edit Ad' : 'New Ad'}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          {campaign && <div className="m-hint"><Mi>campaign</Mi>Campaign: {campaign.name}</div>}
          <div className="fg">
            <label>Ad Title *</label>
            <input className="fi" type="text" placeholder="e.g. 3-Bed Gulshan — Book a Visit" value={f.title} onChange={set('title')} />
          </div>
          <div className="fg">
            <label>Ad Body</label>
            <textarea className="fi" rows="3" placeholder="The ad copy shown to the audience" value={f.body} onChange={set('body')} />
          </div>
          <div className="fg-row">
            <div className="fg">
              <label>Source App</label>
              <select className="fi" value={f.sourceApp} onChange={set('sourceApp')}>
                {AD_SOURCE_APPS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Ad ID <span className="fg-hint">— from the ad platform</span></label>
              <input className="fi" type="text" placeholder="e.g. 23851234567890123" value={f.adId} onChange={set('adId')} />
            </div>
          </div>
          <div className="fg">
            <label>Source URL</label>
            <input className="fi" type="url" placeholder="https://…" value={f.sourceUrl} onChange={set('sourceUrl')} />
          </div>
          <div className="fg">
            <label>Greeting Message</label>
            <textarea className="fi" rows="2" placeholder="First message the lead receives (e.g. WhatsApp/Messenger opener)" value={f.greetingMessage} onChange={set('greetingMessage')} />
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}><Mi>save</Mi>{isEdit ? 'Save Changes' : 'Add Ad'}</button>
        </div>
      </div>
    </div>
  );
}
