import { useState } from 'react';
import { setOwnPassword } from '../lib/auth.js';

// Shown after a one-time recovery or invite link (auth.js consumeAuthRedirect):
// the account has a session but no password of its own yet. Same card styling
// as the sign-in screen (.msi-*).
export default function SetPasswordCard({ email, onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (pw !== pw2) { setErr('The two passwords do not match.'); return; }
    setBusy(true); setErr('');
    const r = await setOwnPassword(pw);
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Password not saved.'); return; }
    onDone();
  };
  const onKey = (e) => { if (e.key === 'Enter') save(); };

  return (
    <div className="msi-card">
      <div className="msi-wordmark">WEPRO<span> CRM</span></div>
      <h2 className="msi-title">Set your password</h2>
      <p className="msi-sub">{email ? `For ${email}. ` : ''}At least 10 characters. You will sign in with it from now on.</p>
      <div className="msi-form">
        <div className="msi-fields">
          <input className="msi-input" type="password" placeholder="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={onKey} aria-label="New password" />
          <input className="msi-input" type="password" placeholder="Repeat new password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={onKey} aria-label="Repeat new password" />
          {err && <div className="msi-err" role="alert">{err}</div>}
        </div>
        <hr className="msi-hr" />
        <button className="msi-btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
      </div>
    </div>
  );
}
