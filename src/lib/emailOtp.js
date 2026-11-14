// Browser side of the email-otp Edge Function (6-digit codes by email).
// verify* need the signed-in session; reset* run from the login page without one.
import { SB_URL, SB_KEY, bearer, ensureFreshToken } from './supabase.js';

export const OTP_URL = `${SB_URL}/functions/v1/email-otp`;

async function call(action, payload = {}, { session = false } = {}) {
  let r;
  try {
    if (session) await ensureFreshToken();
    r = await fetch(OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: session ? bearer() : `Bearer ${SB_KEY}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (r.status === 404 && !j?.error) return { ok: false, error: 'Email codes are not set up yet.' };
  if (!r.ok || !j?.ok) return { ok: false, status: r.status, error: j?.error || `Failed (HTTP ${r.status})`, retryIn: j?.retryIn };
  return j;
}

export const verifyStatus = () => call('verify.status', {}, { session: true });
export const sendVerifyCode = () => call('verify.send', {}, { session: true });
export const checkVerifyCode = (code) => call('verify.check', { code }, { session: true });
export const sendResetCode = (email) => call('reset.send', { email });
export const confirmReset = (email, code, password) => call('reset.confirm', { email, code, password });
