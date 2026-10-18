// Browser side of the AI Trainer. Every call goes to the ai-trainer Edge
// Function with the signed-in CRM user's id; the server allows it only for an
// active Management or Master account.
import { SB_URL, SB_KEY } from './supabase.js';

export const TRAINER_URL = `${SB_URL}/functions/v1/ai-trainer`;

export async function trainerCall(user, action, payload = {}) {
  let r;
  try {
    r = await fetch(TRAINER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
      body: JSON.stringify({ action, payload, user_id: user?.id, actor_claimed: user?.name || user?.email || 'unknown' }),
    });
  } catch {
    throw Object.assign(new Error('Could not reach the AI Trainer service. It may not be deployed yet.'), { code: 'network' });
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j?.ok) {
    const e = j?.error || {};
    throw Object.assign(new Error(e.message || `Request failed (HTTP ${r.status})`), { code: e.code, details: e.details, status: r.status });
  }
  return j.data;
}
