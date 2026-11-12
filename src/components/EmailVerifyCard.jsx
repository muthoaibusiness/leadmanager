import { useEffect, useState } from 'react';
import Mi from './Mi.jsx';
import { verifyStatus, sendVerifyCode, checkVerifyCode } from '../lib/emailOtp.js';

// Profile: prove you own your account's email. "Send code" mails a 6-digit code
// (email-otp Edge Function); entering it marks the email verified.
export default function EmailVerifyCard({ showToast }) {
  const [st, setSt] = useState({ loading: true });
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    let live = true;
    verifyStatus().then((r) => { if (live) setSt(r.ok ? { verified: r.verified, at: r.verifiedAt, email: r.email } : { error: r.error }); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    const r = await sendVerifyCode();
    setBusy(false);
    if (r.verified) { setSt({ verified: true, at: r.verifiedAt, email: st.email }); return; }
    if (!r.ok) { showToast(r.error, 'err'); if (r.retryIn) setWait(r.retryIn); return; }
    setSent(true); setCode(''); setWait(60);
    showToast('Code sent to ' + (r.to || st.email), 'ok');
  };
  const check = async () => {
    if (code.replace(/\D/g, '').length !== 6) { showToast('Enter the 6-digit code', 'err'); return; }
    setBusy(true);
    const r = await checkVerifyCode(code);
    setBusy(false);
    if (!r.ok) { showToast(r.error, 'err'); return; }
    setSt({ verified: true, at: r.verifiedAt, email: st.email });
    showToast('Email verified', 'ok');
  };

  return (
    <div className="ev-card">
      <div className="ev-hd">
        <span className={`ev-ico${st.verified ? ' ok' : ''}`}><Mi>{st.verified ? 'verified' : 'mark_email_unread'}</Mi></span>
        <div className="ev-txt">
          <b>Email verification</b>
          <span>
            {st.loading ? 'Checking…'
              : st.error ? st.error
                : st.verified ? `${st.email} · verified${st.at ? ' on ' + new Date(st.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}`
                  : `${st.email} · not verified`}
          </span>
        </div>
        {!st.loading && !st.error && !st.verified && (
          <button type="button" className="btn btn-p btn-sm" disabled={busy || wait > 0} onClick={send}>
            <Mi>send</Mi>{wait > 0 ? `Resend in ${wait}s` : sent ? 'Resend code' : 'Send code'}
          </button>
        )}
      </div>
      {sent && !st.verified && (
        <div className="ev-row">
          <input className="ev-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="6-digit code"
            aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') check(); }} />
          <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={check}><Mi>check</Mi>Verify</button>
        </div>
      )}
    </div>
  );
}
