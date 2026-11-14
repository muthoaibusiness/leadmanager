import { useState } from 'react';
import { sendResetCode, confirmReset } from '../lib/emailOtp.js';

// Login page: reset a forgotten password with a 6-digit code from email.
// Step 1 asks for the email (the answer is the same whether or not it has an
// account); step 2 takes the code and the new password.
export default function ForgotPassword({ initialEmail = '', onDone, onCancel }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Enter your email address.'); return; }
    setBusy(true); setErr('');
    const r = await sendResetCode(email.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setStep(2);
    setMsg(`If ${email.trim()} has an account, a 6-digit code is on its way. It works for 10 minutes.`);
  };
  const confirm = async () => {
    if (code.replace(/\D/g, '').length !== 6) { setErr('Enter the 6-digit code from the email.'); return; }
    if (pw.length < 10) { setErr('The new password needs at least 10 characters.'); return; }
    if (pw !== pw2) { setErr('The passwords do not match.'); return; }
    setBusy(true); setErr('');
    const r = await confirmReset(email.trim(), code, pw);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone(email.trim());
  };
  const enter = (fn) => (e) => { if (e.key === 'Enter') fn(); };

  return (
    <div className="msi-card">
      <div className="msi-wordmark">WEPRO<span> CRM</span></div>
      <h2 className="msi-title">Reset password</h2>
      <p className="msi-sub">{step === 1 ? 'We will email you a 6-digit code.' : msg}</p>

      <div className="msi-form">
        <div className="msi-fields">
          {step === 1 ? (
            <input className="msi-input" placeholder="Email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={enter(send)} autoFocus />
          ) : (
            <>
              <input className="msi-input" placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
                value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} onKeyDown={enter(confirm)} autoFocus />
              <input className="msi-input" placeholder="New password (10+ characters)" type="password" autoComplete="new-password"
                value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={enter(confirm)} />
              <input className="msi-input" placeholder="Confirm new password" type="password" autoComplete="new-password"
                value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={enter(confirm)} />
            </>
          )}
          {err && <div className="msi-err">{err}</div>}
        </div>

        <hr className="msi-hr" />

        <div>
          <button className="msi-btn" onClick={step === 1 ? send : confirm} disabled={busy}>
            {busy ? 'Please wait…' : step === 1 ? 'Send code' : 'Change password'}
          </button>
          <div className="msi-altrow">
            {step === 2 && <span><a role="button" tabIndex={0} onClick={() => { setStep(1); setErr(''); setCode(''); }}>Send a new code</a> · </span>}
            <span><a role="button" tabIndex={0} onClick={onCancel}>Back to sign in</a></span>
          </div>
        </div>
      </div>
    </div>
  );
}
