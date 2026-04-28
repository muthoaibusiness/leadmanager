import { useRef, useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, createUserFn, addNotifs } from '../../lib/db.js';
import { rlabel } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';

export default function CreateUserModal() {
  const { modal, closeModal, user, createUserRoles, refreshDB, showToast, setCredInfo, openModal } = useApp();
  const isOpen = modal === 'create-user';
  const [err, setErr] = useState('');
  const [showPw, setShowPw] = useState(false);

  const nameRef = useRef();
  const phoneRef = useRef();
  const emailRef = useRef();
  const passRef = useRef();
  const roleRef = useRef();

  useEffect(() => {
    if (isOpen) {
      setErr('');
      setShowPw(false);
      if (nameRef.current) nameRef.current.value = '';
      if (emailRef.current) emailRef.current.value = '';
      if (passRef.current) passRef.current.value = '';
      if (phoneRef.current) phoneRef.current.value = '';
    }
  }, [isOpen]);

  const submit = () => {
    const name = nameRef.current.value.trim();
    const email = emailRef.current.value.trim();
    const pass = passRef.current.value;
    const phone = phoneRef.current.value.trim();
    const role = roleRef.current?.value || createUserRoles[0];
    const db = getDB();

    if (!name || !email || !pass) { setErr('Name, email and password required.'); return; }
    if (pass.length < 4) { setErr('Password must be at least 4 characters.'); return; }
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) { setErr('Email already in use.'); return; }

    createUserFn(name, email, pass, phone, role, user);

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

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Create Account</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          {createUserRoles.length > 1 && (
            <div className="fg"><label>Role</label>
              <select className="fi" ref={roleRef}>
                {createUserRoles.map(r => <option key={r} value={r}>{rlabel(r)}</option>)}
              </select>
            </div>
          )}
          {createUserRoles.length === 1 && <input type="hidden" ref={roleRef} value={createUserRoles[0]} />}
          <div className="fg-row">
            <div className="fg"><label>Full Name *</label><input className="fi" ref={nameRef} type="text" placeholder="e.g. Masud Rahman" /></div>
            <div className="fg"><label>Phone</label><input className="fi" ref={phoneRef} type="tel" placeholder="+880 1711 000000" /></div>
          </div>
          <div className="fg"><label>Email *</label><input className="fi" ref={emailRef} type="email" placeholder="user@company.com" /></div>
          <div className="fg"><label>Password *</label>
            <div className="pw-w">
              <input className="fi" ref={passRef} type={showPw ? 'text' : 'password'} placeholder="Set a password" />
              <button className="pw-e" onClick={() => setShowPw(v => !v)}><Mi>{showPw ? 'visibility_off' : 'visibility'}</Mi></button>
            </div>
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: '12px', marginTop: '4px' }}>{err}</div>}
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" onClick={submit}><Mi>person_add</Mi>Create</button>
        </div>
      </div>
    </div>
  );
}
