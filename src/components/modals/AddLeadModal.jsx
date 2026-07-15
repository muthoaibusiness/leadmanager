import { useRef, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLead, addLeadFn, updLead, addAct, leadByPhone, normalizePhone } from '../../lib/db.js';
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
  // Phone is the lead's identity — it is the dedup key every import and manual add
  // matches on — so it is captured at creation and locked afterwards for every role,
  // Admin and Master included. There is no override.
  const canEditPhone = !isEdit;
  // Source is stamped when the lead is created and is never editable afterwards —
  // no role override, so reporting by source stays trustworthy.
  const canEditSource = !isEdit;

  const nameRef = useRef();
  const companyRef = useRef();
  const profRef = useRef();
  const cityRef = useRef();
  const emailRef = useRef();

  const [phones, setPhones] = useState(['']);
  const [interest, setInterest] = useState(''); // multi project-interest tags (comma-joined)
  // State, not a ref: the locked view renders no <select> for a ref to hang off.
  const [source, setSource] = useState(defaultSource);

  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && panLead) {
      const l = getLead(panLead);
      if (!l) return;
      nameRef.current.value = l.name || '';
      companyRef.current.value = l.company && l.company !== '—' ? l.company : '';
      setSource(l.source || defaultSource);
      setInterest(l.propertyInterest || '');
      profRef.current.value = l.profession || '';
      cityRef.current.value = l.city || '';
      emailRef.current.value = l.email || '';
      setPhones(l.phones?.length ? l.phones : [l.phone || '']);
    } else {
      nameRef.current.value = '';
      companyRef.current.value = '';
      setSource(defaultSource);
      setInterest('');
      profRef.current.value = '';
      cityRef.current.value = '';
      emailRef.current.value = '';
      setPhones(['']);
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
    const cleanPhones = phones.map(p => normalizePhone(p)).filter(Boolean);
    if (!name) { showToast('Name is required', 'err'); return; }
    // Only enforced where phones can actually be entered. On edit they are locked and
    // echoed back from the lead, so validating them would let one legacy bad number
    // block every other edit to that lead.
    if (canEditPhone && !cleanPhones.length) { showToast('A valid phone number is required (e.g. +8801XXXXXXXXX)', 'err'); return; }

    const phone = cleanPhones[0];
    const email = emailRef.current.value.trim();
    const company = companyRef.current.value.trim();
    const prop = interest.trim();
    const profession = profRef.current.value.trim();
    const city = cityRef.current.value.trim();

    if (isEdit && panLead) {
      // No duplicate-phone check here: phones are locked on edit, so they cannot clash
      // with another lead. Running it anyway would let a pre-existing duplicate
      // elsewhere in the DB block unrelated edits (e.g. fixing a typo in the name).
      const old = getLead(panLead);
      const changes = [];
      if (old.name !== name) changes.push(`Name: "${old.name}" → "${name}"`);
      if ((old.email || '') !== email) changes.push(`Email: ${old.email || '—'} → ${email || '—'}`);
      if ((old.company || '—') !== (company || '—')) changes.push(`Company: ${old.company || '—'} → ${company || '—'}`);
      if ((old.propertyInterest || '') !== prop) changes.push(`Property: ${old.propertyInterest || '—'} → ${prop || '—'}`);
      if ((old.profession || '') !== profession) changes.push(`Profession: ${old.profession || '—'} → ${profession || '—'}`);
      if ((old.city || '') !== city) changes.push(`Location: ${old.city || '—'} → ${city || '—'}`);
      // `phone`, `phones` and `source` are deliberately absent: all three are locked on
      // edit, so they are never written back.
      updLead(panLead, { name, email, company: company || '—', propertyInterest: prop, profession, city });
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
        // `phones` and `source` are deliberately absent. This branch is reached from the
        // Add form, where both fields are editable, so writing them here would be a way
        // to mutate a locked field on an existing lead just by re-submitting its number.
        // Writing `phones` was also destructive: it replaced the whole array, so a
        // re-submit carrying only the primary silently dropped the lead's secondaries.
        // Source stays put too — the channel that first produced the lead earned it.
        updLead(dup.id, { name, email, company: company || '—', propertyInterest: prop, profession, city });
        addAct(dup.id, { type: 'NOTE', description: `Re-submitted ${phone} — record updated (already handled by ${owner})`, userId: user.id, userName: user.name, durationSeconds: 0 });
        closeModal(); refreshDB();
        showToast(`Number ${phone} already exists — handled by ${owner}. Record updated.`, 'warn');
        setTimeout(() => setPanLead(dup.id), 150);
        return;
      }
      const id = addLeadFn(name, phone, cleanPhones, email, [], company, source, prop, profession, city, user);
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

          {/* Phone numbers — entered at creation, read-only once the lead exists. */}
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
            <div className="fg">
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                Source
                {!canEditSource && <Mi style={{ fontSize: '14px', color: 'var(--t3)' }}>lock</Mi>}
              </label>
              {canEditSource ? (
                <select className="fi" value={source} onChange={e => setSource(e.target.value)}>
                  {sourceOpts.map(s => <option key={s} value={s}>{SRC_LABELS[s] || s}</option>)}
                </select>
              ) : (
                // Read-only: source is stamped at creation and never changes.
                <div className="ro-value"><Mi className="ro-lock">lock</Mi>{SRC_LABELS[source] || source || '—'}</div>
              )}
            </div>
            <div className="fg"><label>Customer Location</label><input className="fi" ref={cityRef} type="text" placeholder="e.g. Dhaka, Chattogram" /></div>
          </div>
          <div className="fg">
            <label>Project Interest <span className="fg-hint">— add one or more</span></label>
            <ProjectInterestPicker value={interest} onChange={setInterest} />
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}><Mi>save</Mi>Save</button>
        </div>
      </div>
    </div>
  );
}
