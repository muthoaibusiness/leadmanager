import { useRef, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLead, addLeadFn, updLead, addAct, leadByPhone, normalizePhone, getCampaigns, getAds } from '../../lib/db.js';
import { SRC_LABELS, ROLES, SOURCE_OPTIONS_IA, SOURCE_OPTIONS_DEFAULT } from '../../lib/constants.js';
import ProjectInterestPicker from '../ProjectInterestPicker.jsx';

const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());

export default function AddLeadModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast, setPanLead } = useApp();
  const isEdit = modal === 'edit-lead';
  const isOpen = modal === 'add-lead' || isEdit;
  // Initial Agents get a different source list (Event / Walking / Personal / Team Lead).
  const sourceOpts = user?.role === ROLES.IA ? SOURCE_OPTIONS_IA : SOURCE_OPTIONS_DEFAULT;
  const defaultSource = sourceOpts[0];
  // Only Admin / Management may edit existing phone numbers. For everyone
  // else (Team Lead, Initial Agent, Meeting Agent) phones are read-only when editing.
  const canEditPhone = !isEdit || [ROLES.MGMT, ROLES.MASTER].includes(user?.role);

  const nameRef = useRef();
  const companyRef = useRef();
  const sourceRef = useRef();
  const budgetRef = useRef();
  const profRef = useRef();
  const cityRef = useRef();
  const emailRef = useRef();

  const [phones, setPhones] = useState(['']);
  const [interest, setInterest] = useState(''); // multi project-interest tags (comma-joined)
  const [campaignId, setCampaignId] = useState('');
  const [adId, setAdId] = useState('');

  // Marketing attribution. Ads are scoped to the picked campaign, so changing the
  // campaign always clears the ad rather than leaving a mismatched pair behind.
  const campaigns = getCampaigns();
  const campaignAds = campaignId ? getAds(campaignId) : [];
  const pickCampaign = (v) => { setCampaignId(v); setAdId(''); };

  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && panLead) {
      const l = getLead(panLead);
      if (!l) return;
      nameRef.current.value = l.name || '';
      companyRef.current.value = l.company && l.company !== '—' ? l.company : '';
      sourceRef.current.value = l.source || defaultSource;
      setInterest(l.propertyInterest || '');
      budgetRef.current.value = l.budget || '';
      profRef.current.value = l.profession || '';
      cityRef.current.value = l.city || '';
      emailRef.current.value = l.email || '';
      setPhones(l.phones?.length ? l.phones : [l.phone || '']);
      setCampaignId(l.campaignId || '');
      setAdId(l.adId || '');
    } else {
      nameRef.current.value = '';
      companyRef.current.value = '';
      sourceRef.current.value = defaultSource;
      setInterest('');
      budgetRef.current.value = '';
      profRef.current.value = '';
      cityRef.current.value = '';
      emailRef.current.value = '';
      setPhones(['']);
      setCampaignId('');
      setAdId('');
    }
  }, [isOpen, isEdit, panLead]);

  const updatePhone = (i, v) => {
    const sanitized = v.replace(/[^\d+ ]/g, '');
    setPhones(p => p.map((x, j) => j === i ? sanitized : x));
  };
  const addPhone = () => setPhones(p => [...p, '']);
  const removePhone = (i) => setPhones(p => p.filter((_, j) => j !== i));

  const submit = () => {
    const name = nameRef.current.value.trim();
    // require + normalize phone(s) to country-code form (+880…)
    const cleanPhones = phones.map(p => normalizePhone(p)).filter(Boolean);
    if (!name) { showToast('Name is required', 'err'); return; }
    if (!cleanPhones.length) { showToast('A valid phone number is required (e.g. +8801XXXXXXXXX)', 'err'); return; }

    const phone = cleanPhones[0];
    const email = emailRef.current.value.trim();
    const company = companyRef.current.value.trim();
    const source = sourceRef.current.value;
    const prop = interest.trim();
    const budget = budgetRef.current.value;
    const profession = profRef.current.value.trim();
    const city = cityRef.current.value.trim();
    // An ad is only meaningful under its campaign; drop it if no campaign is set.
    const attribution = { campaignId: campaignId || null, adId: campaignId ? (adId || null) : null };

    if (isEdit && panLead) {
      // Reject if any of the (possibly changed) numbers already belong to a DIFFERENT lead.
      let clash = null;
      for (const ph of cleanPhones) { const c = leadByPhone(ph); if (c && c.id !== panLead) { clash = c; break; } }
      if (clash) {
        showToast(`Number already exists on lead ${leadCode(clash)} (${clash.assignedToName || '—'}). Change rejected — contact your admin to swap.`, 'err');
        return;
      }
      const old = getLead(panLead);
      const changes = [];
      if (old.name !== name) changes.push(`Name: "${old.name}" → "${name}"`);
      if (old.phone !== phone) changes.push(`Phone: ${old.phone} → ${phone}`);
      if ((old.email || '') !== email) changes.push(`Email: ${old.email || '—'} → ${email || '—'}`);
      if ((old.company || '—') !== (company || '—')) changes.push(`Company: ${old.company || '—'} → ${company || '—'}`);
      if (old.source !== source) changes.push(`Source: ${SRC_LABELS[old.source] || old.source} → ${SRC_LABELS[source] || source}`);
      if ((old.propertyInterest || '') !== prop) changes.push(`Property: ${old.propertyInterest || '—'} → ${prop || '—'}`);
      if ((old.budget || 0) !== (parseFloat(budget) || 0)) changes.push(`Budget: ${old.budget || 0} → ${parseFloat(budget) || 0}`);
      if ((old.profession || '') !== profession) changes.push(`Profession: ${old.profession || '—'} → ${profession || '—'}`);
      if ((old.city || '') !== city) changes.push(`Location: ${old.city || '—'} → ${city || '—'}`);
      if ((old.campaignId || null) !== attribution.campaignId) {
        const nameOf = (id) => campaigns.find(c => c.id === id)?.name || '—';
        changes.push(`Campaign: ${old.campaignId ? nameOf(old.campaignId) : '—'} → ${attribution.campaignId ? nameOf(attribution.campaignId) : '—'}`);
      }
      updLead(panLead, { name, phone, phones: cleanPhones, email, company: company || '—', source, propertyInterest: prop, budget: parseFloat(budget) || 0, profession, city, ...attribution });
      if (changes.length > 0) addAct(panLead, { type: 'NOTE', description: 'Lead updated — ' + changes.join(', '), userId: user.id, userName: user.name, durationSeconds: 0 });
      closeModal(); refreshDB(); showToast('Lead updated', 'ok');
    } else {
      const dup = leadByPhone(phone);
      if (dup) {
        // Lead already on the server. If it belongs to another team (not the
        // current agent's team root), block — only an admin can swap it over.
        const isAdmin = user.role === ROLES.MGMT || user.role === ROLES.MASTER;
        const otherTeam = dup.teamId && user.teamId && dup.teamId !== user.teamId;
        if (!isAdmin && otherTeam) {
          showToast(`This lead (ID ${leadCode(dup)}) is already on another agent’s panel. Please contact your admin to swap.`, 'err');
          return;
        }
        // number already exists → update it, and alert which agent owns it
        const owner = dup.assignedToName || '—';
        // Keep the original attribution unless this submission names a campaign —
        // the first ad that produced the lead is the one that earned it.
        const dupAttr = attribution.campaignId ? attribution : {};
        updLead(dup.id, { name, phones: cleanPhones, email, company: company || '—', source, propertyInterest: prop, budget: parseFloat(budget) || 0, profession, city, ...dupAttr });
        addAct(dup.id, { type: 'NOTE', description: `Re-submitted ${phone} — record updated (already handled by ${owner})`, userId: user.id, userName: user.name, durationSeconds: 0 });
        closeModal(); refreshDB();
        showToast(`Number ${phone} already exists — handled by ${owner}. Record updated.`, 'warn');
        setTimeout(() => setPanLead(dup.id), 150);
        return;
      }
      const id = addLeadFn(name, phone, cleanPhones, email, [], company, source, prop, budget, profession, city, user, attribution);
      closeModal(); refreshDB(); showToast('Lead added', 'ok');
      setTimeout(() => setPanLead(id), 150);
    }
  };

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">{isEdit ? 'Edit Customer' : 'Add New Lead'}</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fg">
            <label>Full Name *</label>
            <input className="fi" ref={nameRef} type="text" placeholder="e.g. Rahim Ahmed" />
          </div>

          {/* Phone numbers — editable only for Admin / Management / Team Lead */}
          <div className="fg">
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              Phone Number(s){canEditPhone ? ' *' : ''}
              {!canEditPhone && <Mi style={{ fontSize: '14px', color: 'var(--t3)' }}>lock</Mi>}
            </label>
            {canEditPhone ? (
              <>
                {phones.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: i < phones.length - 1 ? '6px' : '0' }}>
                    <input
                      className="fi"
                      type="tel"
                      placeholder={i === 0 ? '+971 50 000 0000 (primary)' : 'Additional number'}
                      value={p}
                      onChange={e => updatePhone(i, e.target.value)}
                      style={{ flex: 1 }}
                    />
                    {phones.length > 1 && (
                      <button type="button" onClick={() => removePhone(i)}
                        style={{ padding: '0 10px', borderRadius: 'var(--r-sm)', background: 'var(--red-l)', color: 'var(--red)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                        <Mi>remove</Mi>
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addPhone}
                  style={{ marginTop: '6px', fontSize: '12px', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: 0 }}>
                  <Mi>add</Mi> Add number
                </button>
              </>
            ) : (
              // Read-only: plain text with a lock icon, no inputs, no Add button.
              <div className="ro-field">
                {phones.filter(Boolean).length
                  ? phones.filter(Boolean).map((p, i) => (
                      <div key={i} className="ro-phone"><Mi className="ro-lock">lock</Mi>{p}</div>
                    ))
                  : <div className="ro-phone"><Mi className="ro-lock">lock</Mi>—</div>}
              </div>
            )}
          </div>

          {/* Email */}
          <div className="fg">
            <label>Email</label>
            <input className="fi" ref={emailRef} type="email" placeholder="e.g. primary@email.com" />
          </div>

          <div className="fg-row">
            <div className="fg"><label>Company</label><input className="fi" ref={companyRef} type="text" placeholder="optional" /></div>
            <div className="fg"><label>Profession</label><input className="fi" ref={profRef} type="text" placeholder="e.g. Business Owner" /></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Source</label>
              <select className="fi" ref={sourceRef} defaultValue={defaultSource}>
                {sourceOpts.map(s => <option key={s} value={s}>{SRC_LABELS[s] || s}</option>)}
              </select>
            </div>
            <div className="fg"><label>Customer Location</label><input className="fi" ref={cityRef} type="text" placeholder="e.g. Dhaka, Chattogram" /></div>
          </div>
          <div className="fg">
            <label>Project Interest <span className="fg-hint">— add one or more</span></label>
            <ProjectInterestPicker value={interest} onChange={setInterest} />
          </div>
          <div className="fg"><label>Budget (BDT)</label><input className="fi" ref={budgetRef} type="number" min="0" placeholder="e.g. 850000" /></div>

          {/* Marketing attribution — drives cost per lead on the Campaigns view. */}
          {campaigns.length > 0 && (
            <div className="fg-row">
              <div className="fg">
                <label>Campaign</label>
                <select className="fi" value={campaignId} onChange={e => pickCampaign(e.target.value)}>
                  <option value="">— none —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Ad</label>
                <select className="fi" value={adId} onChange={e => setAdId(e.target.value)} disabled={!campaignId || !campaignAds.length}>
                  <option value="">{!campaignId ? '— pick a campaign —' : campaignAds.length ? '— none —' : '— no ads yet —'}</option>
                  {campaignAds.map(a => <option key={a.id} value={a.id}>{a.title || a.adId || 'Untitled ad'}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}><Mi>save</Mi>Save</button>
        </div>
      </div>
    </div>
  );
}
