import { useRef, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLead, addLeadFn, updLead, addAct, leadByPhone, normalizePhone } from '../../lib/db.js';
import { SRC_LABELS, ROLES } from '../../lib/constants.js';
import ProjectInterestPicker from '../ProjectInterestPicker.jsx';

const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());

export default function AddLeadModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast, setPanLead } = useApp();
  const isEdit = modal === 'edit-lead';
  const isOpen = modal === 'add-lead' || isEdit;

  const nameRef = useRef();
  const companyRef = useRef();
  const sourceRef = useRef();
  const budgetRef = useRef();
  const profRef = useRef();
  const cityRef = useRef();

  const [phones, setPhones] = useState(['']);
  const [emails, setEmails] = useState(['']);
  const [interest, setInterest] = useState(''); // multi project-interest tags (comma-joined)

  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && panLead) {
      const l = getLead(panLead);
      if (!l) return;
      nameRef.current.value = l.name || '';
      companyRef.current.value = l.company && l.company !== '—' ? l.company : '';
      sourceRef.current.value = l.source || 'META_ADS';
      setInterest(l.propertyInterest || '');
      budgetRef.current.value = l.budget || '';
      profRef.current.value = l.profession || '';
      cityRef.current.value = l.city || '';
      setPhones(l.phones?.length ? l.phones : [l.phone || '']);
      setEmails(l.emails?.length ? l.emails : [l.email || '']);
    } else {
      nameRef.current.value = '';
      companyRef.current.value = '';
      sourceRef.current.value = 'META_ADS';
      setInterest('');
      budgetRef.current.value = '';
      profRef.current.value = '';
      cityRef.current.value = '';
      setPhones(['']);
      setEmails(['']);
    }
  }, [isOpen, isEdit, panLead]);

  const updatePhone = (i, v) => setPhones(p => p.map((x, j) => j === i ? v : x));
  const addPhone = () => setPhones(p => [...p, '']);
  const removePhone = (i) => setPhones(p => p.filter((_, j) => j !== i));

  const updateEmail = (i, v) => setEmails(e => e.map((x, j) => j === i ? v : x));
  const addEmail = () => setEmails(e => [...e, '']);
  const removeEmail = (i) => setEmails(e => e.filter((_, j) => j !== i));

  const submit = () => {
    const name = nameRef.current.value.trim();
    const cleanEmails = emails.map(e => e.trim()).filter(Boolean);
    // require + normalize phone(s) to country-code form (+880…)
    const cleanPhones = phones.map(p => normalizePhone(p)).filter(Boolean);
    if (!name) { showToast('Name is required', 'err'); return; }
    if (!cleanPhones.length) { showToast('A valid phone number is required (e.g. +8801XXXXXXXXX)', 'err'); return; }

    const phone = cleanPhones[0];
    const email = cleanEmails[0] || '';
    const company = companyRef.current.value.trim();
    const source = sourceRef.current.value;
    const prop = interest.trim();
    const budget = budgetRef.current.value;
    const profession = profRef.current.value.trim();
    const city = cityRef.current.value.trim();

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
      updLead(panLead, { name, phone, phones: cleanPhones, email, emails: cleanEmails, company: company || '—', source, propertyInterest: prop, budget: parseFloat(budget) || 0, profession, city });
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
        updLead(dup.id, { name, phones: cleanPhones, email, emails: cleanEmails, company: company || '—', source, propertyInterest: prop, budget: parseFloat(budget) || 0, profession, city });
        addAct(dup.id, { type: 'NOTE', description: `Re-submitted ${phone} — record updated (already handled by ${owner})`, userId: user.id, userName: user.name, durationSeconds: 0 });
        closeModal(); refreshDB();
        showToast(`Number ${phone} already exists — handled by ${owner}. Record updated.`, 'warn');
        setTimeout(() => setPanLead(dup.id), 150);
        return;
      }
      const id = addLeadFn(name, phone, cleanPhones, email, cleanEmails, company, source, prop, budget, profession, city, user);
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

          {/* Phone numbers */}
          <div className="fg">
            <label>Phone Number(s) *</label>
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
              <Mi>add</Mi> Add another number
            </button>
          </div>

          {/* Emails */}
          <div className="fg">
            <label>Email(s)</label>
            {emails.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: i < emails.length - 1 ? '6px' : '0' }}>
                <input
                  className="fi"
                  type="email"
                  placeholder={i === 0 ? 'primary@email.com' : 'Additional email'}
                  value={e}
                  onChange={ev => updateEmail(i, ev.target.value)}
                  style={{ flex: 1 }}
                />
                {emails.length > 1 && (
                  <button type="button" onClick={() => removeEmail(i)}
                    style={{ padding: '0 10px', borderRadius: 'var(--r-sm)', background: 'var(--red-l)', color: 'var(--red)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                    <Mi>remove</Mi>
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addEmail}
              style={{ marginTop: '6px', fontSize: '12px', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: 0 }}>
              <Mi>add</Mi> Add another email
            </button>
          </div>

          <div className="fg-row">
            <div className="fg"><label>Company</label><input className="fi" ref={companyRef} type="text" placeholder="optional" /></div>
            <div className="fg"><label>Profession</label><input className="fi" ref={profRef} type="text" placeholder="e.g. Business Owner" /></div>
          </div>
          <div className="fg-row">
            <div className="fg"><label>Source</label>
              <select className="fi" ref={sourceRef}>
                <option value="META_ADS">Meta Ads</option>
                <option value="WHATSAPP_ADS">WhatsApp Ads</option>
                <option value="LINKEDIN">LinkedIn</option>
                <option value="WEBSITE">Website</option>
                <option value="HOTLINE">Hotline</option>
                <option value="PERSONAL">Personal</option>
              </select>
            </div>
            <div className="fg"><label>Customer Location</label><input className="fi" ref={cityRef} type="text" placeholder="e.g. Dhaka, Chattogram" /></div>
          </div>
          <div className="fg">
            <label>Project Interest <span className="fg-hint">— add one or more</span></label>
            <ProjectInterestPicker value={interest} onChange={setInterest} />
          </div>
          <div className="fg"><label>Budget (BDT)</label><input className="fi" ref={budgetRef} type="number" min="0" placeholder="e.g. 850000" /></div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}><Mi>save</Mi>Save</button>
        </div>
      </div>
    </div>
  );
}
