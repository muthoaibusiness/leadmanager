import { useRef, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLead, addLeadFn, updLead, addAct, leadByPhone } from '../../lib/db.js';
import { SRC_LABELS } from '../../lib/constants.js';

export default function AddLeadModal() {
  const { modal, closeModal, user, panLead, refreshDB, showToast, setPanLead } = useApp();
  const isEdit = modal === 'edit-lead';
  const isOpen = modal === 'add-lead' || isEdit;

  const nameRef = useRef();
  const companyRef = useRef();
  const sourceRef = useRef();
  const propRef = useRef();
  const budgetRef = useRef();
  const profRef = useRef();
  const cityRef = useRef();

  const [phones, setPhones] = useState(['']);
  const [emails, setEmails] = useState(['']);

  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && panLead) {
      const l = getLead(panLead);
      if (!l) return;
      nameRef.current.value = l.name || '';
      companyRef.current.value = l.company && l.company !== '—' ? l.company : '';
      sourceRef.current.value = l.source || 'META_ADS';
      propRef.current.value = l.propertyInterest || '';
      budgetRef.current.value = l.budget || '';
      profRef.current.value = l.profession || '';
      cityRef.current.value = l.city || '';
      setPhones(l.phones?.length ? l.phones : [l.phone || '']);
      setEmails(l.emails?.length ? l.emails : [l.email || '']);
    } else {
      nameRef.current.value = '';
      companyRef.current.value = '';
      sourceRef.current.value = 'META_ADS';
      propRef.current.value = '';
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
    const cleanPhones = phones.map(p => p.trim()).filter(Boolean);
    const cleanEmails = emails.map(e => e.trim()).filter(Boolean);
    if (!name || !cleanPhones.length) { showToast('Name and at least one phone required', 'err'); return; }

    const phone = cleanPhones[0];
    const email = cleanEmails[0] || '';
    const company = companyRef.current.value.trim();
    const source = sourceRef.current.value;
    const prop = propRef.current.value.trim();
    const budget = budgetRef.current.value;
    const profession = profRef.current.value.trim();
    const city = cityRef.current.value.trim();

    if (isEdit && panLead) {
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
        closeModal(); showToast('A lead with this phone already exists — opening it.', 'warn');
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
            <div className="fg"><label>Customer Location</label><input className="fi" ref={cityRef} type="text" placeholder="e.g. Dubai, Sharjah" /></div>
          </div>
          <div className="fg"><label>Property Interest</label><input className="fi" ref={propRef} type="text" placeholder="e.g. 3BHK Apartment" /></div>
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
