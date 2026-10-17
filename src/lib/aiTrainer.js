// Browser side of the AI Trainer. Every call goes to the ai-trainer Edge
// Function with the Trainer access key Management entered for this browser
// session. The key lives in sessionStorage only (cleared when the tab session
// ends); the server holds the real secret and checks it on every call.
import { SB_URL, SB_KEY } from './supabase.js';

export const TRAINER_URL = `${SB_URL}/functions/v1/ai-trainer`;
const KEY = 'aitrainer.key';

export function getTrainerKey() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setTrainerKey(k) { try { sessionStorage.setItem(KEY, k); } catch { /* private mode: key lasts this page only */ } }
export function clearTrainerKey() { try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ } }

export async function trainerCall(user, action, payload = {}) {
  let r;
  try {
    r = await fetch(TRAINER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, 'X-Trainer-Key': getTrainerKey() },
      body: JSON.stringify({ action, payload, actor_claimed: user?.name || user?.email || 'unknown' }),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the AI Trainer service. It may not be deployed yet.'), { code: 'network' });
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j?.ok) {
    if (r.status === 401) clearTrainerKey();
    const e = j?.error || {};
    throw Object.assign(new Error(e.message || `Request failed (HTTP ${r.status})`), { code: e.code, details: e.details, status: r.status });
  }
  return j.data;
}
