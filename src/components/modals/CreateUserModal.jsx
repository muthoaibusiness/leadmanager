import { useRef, useState, useEffect, useId } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, addNotifs } from '../../lib/db.js';
import { createAccount } from '../../lib/accessAdmin.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import useDiscardGuard from '../../hooks/useDiscardGuard.js';
import useChanged from '../../hooks/useChanged.js';
import BkSelect from '../booking/BkSelect.jsx';
import '../booking/ShopBooking.css';
import '../project/AddPropertyWizard.css';
import '../views/AccountsView.css';

export default function CreateUserModal() {
  const { modal, closeModal, user, createUserRoles, refreshDB, showToast, setCredInfo, openModal } = useApp();
  const uid = useId(); // field ids, so each <label htmlFor> points at its field
  const isOpen = modal === 'create-user';
  const [err, setErr] = useState('');
  const [showPw, setShowPw] = useState(false);

  const nameRef = useRef();
  const phoneRef = useRef();
  const emailRef = useRef();
  const passRef = useRef();
  const [role, setRole] = useState('');
  const baselineRef = useRef('');

  // Everything the form holds, as one string; the copy taken on open is the
  // baseline isDirty() compares against. The role picker is not reset on open,
  // so its value then is the baseline, not the first role.
  const formKey = () => JSON.stringify([
    nameRef.current?.value.trim() || '', phoneRef.current?.value.trim() || '',
    emailRef.current?.value.trim() || '', passRef.current?.value || '', role,
  ]);

  if (useChanged(isOpen) && isOpen) {
    setErr('');
    setShowPw(false);
    setRole('');
  }
  // The fields are uncontrolled, so clearing them is DOM work for after commit.
  useEffect(() => {
    if (isOpen) {
      if (nameRef.current) nameRef.current.value = '';
      if (emailRef.current) emailRef.current.value = '';
      if (passRef.current) passRef.current.value = '';
      if (phoneRef.current) phoneRef.current.value = '';
      baselineRef.current = formKey();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- formKey only reads refs and state at call time

  // ✕, Cancel, the backdrop and Esc close through the guard: an untouched form
  // just closes, one with input asks first (Projects → Add Property's structure).
  const guard = useDiscardGuard({
    isOpen, isDirty: () => formKey() !== baselineRef.current, onClose: closeModal,
    ask: { title: 'Exit without creating?', description: 'This new account will be lost.' },
  });

  const pickedRole = role && createUserRoles.includes(role) ? role : createUserRoles[0];
  const submit = async () => {
    const name = nameRef.current.value.trim();
    const email = emailRef.current.value.trim();
    const pass = passRef.current.value;
    const phone = phoneRef.current.value.trim();
    const role = pickedRole;
    const db = getDB();

    if (!name || !email || !pass) { setErr('Name, email and password required.'); return; }
    if (pass.length < 10) { setErr('Password must be at least 10 characters.'); return; }
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) { setErr('Email already in use.'); return; }

    // The access-admin function creates the sign-in and the CRM row together,
    // checks the email across every tenant, and refuses roles above the caller.
    setErr('');
    const res = await createAccount({ name, email, password: pass, phone, role });
    if (!res.ok) { setErr(res.error); return; }

    if (role === ROLES.TL) {
      const newDb = getDB();
      const mgmtIds = newDb.users.filter(u => u.role === ROLES.MGMT).map(u => u.id);
      addNotifs(mgmtIds.map(uid => ({ userId: uid, type: 'NEW_USER', message: 'New Team Lead added: ' + name, leadId: null })), user);
    } else {
      const newDb = getDB();
      const tlIds = newDb.users.filter(u => u.role === ROLES.TL && u.teamId === user.teamId).map(u => u.id);
      addNotifs(tlIds.map(uid => ({ userId: uid, type: 'NEW_USER', message: 'New agent added to your team: ' + name + ' (' + rlabel(role) + ')', leadId: null })), user);
    }

    refreshDB();
    closeModal();
    setCredInfo({ name, email, pass, roleLabel: rlabel(role) });
    openModal('creds');
    showToast('User created', 'ok');
  };

  if (!isOpen) return null;
  return (
    <div className="pw-scrim" {...guard.backdropProps}>
      <div className="bk acx-modal" role="dialog" aria-modal="true" aria-labelledby={`${uid}t`} {...guard.modalProps}>
        <header className="pw-head">
          <div className="acx-mt"><span className="bk-eyebrow">New account</span><h3 id={`${uid}t`}>Create account</h3></div>
          <button type="button" className="bk-close" aria-label="Close" onClick={guard.requestClose}><Mi>close</Mi></button>
        </header>
        <div className="pw-body">
          {createUserRoles.length > 1 && (
            <div className="pw-f"><span className="bk-cap">Role</span>
              <BkSelect label="Role" value={pickedRole} onChange={setRole} options={createUserRoles.map(r => ({ value: r, label: rlabel(r) }))} /></div>
          )}
          <div className="pw-grid">
            <label className="pw-f" htmlFor={`${uid}name`}><span className="bk-cap">Full name *</span><input id={`${uid}name`} ref={nameRef} type="text" placeholder="e.g. Masud Rahman" /></label>
            <label className="pw-f" htmlFor={`${uid}phone`}><span className="bk-cap">Phone</span><input id={`${uid}phone`} ref={phoneRef} type="tel" placeholder="+880 1711 000000" /></label>
          </div>
          <label className="pw-f" htmlFor={`${uid}email`}><span className="bk-cap">Email *</span><input id={`${uid}email`} ref={emailRef} type="email" placeholder="user@company.com" /></label>
          <div className="pw-f"><label className="bk-cap" htmlFor={`${uid}pass`}>Password * (10 characters or more)</label>
            <div className="acx-pw">
              <input id={`${uid}pass`} ref={passRef} type={showPw ? 'text' : 'password'} placeholder="Set a password" />
              <button type="button" className="bk-close" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw(v => !v)}><Mi>{showPw ? 'visibility_off' : 'visibility'}</Mi></button>
            </div>
          </div>
          {err && <div className="pw-warn" role="alert"><Mi>error</Mi>{err}</div>}
        </div>
        <footer className="pw-foot">
          <span className="bk-cap">The login details are shown once, after it is created.</span>
          <div className="pw-acts">
            <button type="button" className="bk-btn" onClick={guard.requestClose}>Cancel</button>
            <button type="button" className="bk-btn primary" onClick={submit}><Mi>person_add</Mi>Create</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
