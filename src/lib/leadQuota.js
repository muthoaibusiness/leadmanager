import { getDB } from './db.js';
import { sbGet, sbUpsert } from './supabase.js';
import { ROLES, effectiveRole } from './constants.js';

// Free-plan cap: an agent may work on LEAD_LIMIT distinct leads per lock cycle.
// Opening the LEAD_LIMIT-th lead starts a LOCK_MS lock; leads already worked stay
// reachable, any new lead is refused (upgrade popup) until the lock expires, then
// the counter resets. Rolled out to the teams in LIMITED_TEAMS only (testing).
// State is stored in Supabase (agent_lead_quota, migration 0019).
export const LEAD_LIMIT = 3;
export const LOCK_MS = 24 * 60 * 60 * 1000;
// Matched by team name, or by id — the Eayd Islam test team has no row in `teams`, so its name can't be resolved.
const LIMITED_TEAMS = ['eayd islam'];
const LIMITED_TEAM_IDS = ['txxsz5ycjmqnpec8x'];

// In-memory copy of the cloud row, per user, so the modal can read the lock time.
const cache = {};

export function isQuotaLimited(user) {
  if (!user || ![ROLES.IA, ROLES.MA].includes(effectiveRole(user))) return false;
  if (LIMITED_TEAM_IDS.includes(user.teamId)) return true;
  const team = getDB().teams.find(t => t.id === user.teamId);
  const name = (team?.name || '').toLowerCase();
  return LIMITED_TEAMS.some(n => name.includes(n));
}

async function load(uid) {
  const rows = await sbGet(`agent_lead_quota?user_id=eq.${encodeURIComponent(uid)}&select=lead_ids,locked_until`);
  const r = rows[0];
  return { leads: r?.lead_ids || [], lockedUntil: r?.locked_until ? new Date(r.locked_until).getTime() : 0 };
}

const save = (uid, s) => sbUpsert('agent_lead_quota', [{
  user_id: uid, lead_ids: s.leads, locked_until: s.lockedUntil ? new Date(s.lockedUntil).toISOString() : null,
}]);

// Called before a lead is opened. Resolves { ok, lockedUntil? } and records the lead.
export async function claimLead(user, leadId) {
  if (!isQuotaLimited(user)) return { ok: true };
  // Always re-read the cloud row so a second device sees the same count and lock.
  let s = await load(user.id);
  if (s.lockedUntil && Date.now() >= s.lockedUntil) s = { leads: [], lockedUntil: 0 };
  cache[user.id] = s;
  if (s.leads.includes(leadId)) return { ok: true };
  if (s.lockedUntil) return { ok: false, lockedUntil: s.lockedUntil };
  s = { leads: [...s.leads, leadId], lockedUntil: 0 };
  if (s.leads.length >= LEAD_LIMIT) s.lockedUntil = Date.now() + LOCK_MS;
  cache[user.id] = s;
  await save(user.id, s);
  return { ok: true };
}

export const quotaLockedUntil = (user) => (user ? cache[user.id]?.lockedUntil || 0 : 0);
