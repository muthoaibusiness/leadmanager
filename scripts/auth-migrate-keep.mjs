#!/usr/bin/env node
// Move old-style accounts to Supabase sign-in, keeping each person's password.
//
// For every ACTIVE CRM account with no linked sign-in (users.auth_user_id null)
// and a stored password: create a Supabase Auth user with that email and that
// password (email confirmed), link it by users.auth_user_id, then replace the
// plain-text users.password with '!auth'. People sign in exactly as before; the
// login page now goes through Supabase Auth, and email codes (email-otp) work.
// An Auth user that already has the email is linked, never duplicated, and its
// password is left alone. Inactive accounts are skipped. No password is printed.
//
// A stored password under 6 characters (Supabase's minimum) cannot be carried
// over. Those accounts are skipped, unless --short-reset: then their sign-in gets
// a random password nobody knows, and they set a new one with "Forgot password?"
// on the login page (a code to their email). Their old password stops working.
//
// Dry run by default. Writes only with --apply --confirm <SUPABASE_URL>.
//
//   PowerShell:
//     $env:SUPABASE_URL="https://sbqmougcvnplgjgihpwe.supabase.co"
//     $env:SUPABASE_SERVICE_ROLE_KEY="<service role key from Project Settings > API>"
//     node scripts/auth-migrate-keep.mjs
//     node scripts/auth-migrate-keep.mjs --apply --confirm https://sbqmougcvnplgjgihpwe.supabase.co

import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
class Stop extends Error {}
const die = (m) => { console.error(`auth-migrate-keep: ${m}`); throw new Stop(m); };

async function main() {
const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const apply = args.includes('--apply');
const shortReset = args.includes('--short-reset');
if (!BASE || !SVC) die('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this shell first');
if (apply && String(arg('--confirm') || '').replace(/\/+$/, '') !== BASE) die(`--apply needs --confirm ${BASE}`);

const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${BASE}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const admin = (p, init = {}) => fetch(`${BASE}/auth/v1/admin/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const looksLikeEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const NO_PW = new Set(['', '!auth']);

// Every Auth user, by lower-case email (a few dozen here; paged to be safe).
async function authUsersByEmail() {
  const map = new Map();
  for (let page = 1; page < 50; page++) {
    const r = await admin(`users?page=${page}&per_page=1000`);
    if (!r.ok) die(`listing Auth users failed: HTTP ${r.status}`);
    const j = await r.json();
    const list = j.users || [];
    list.forEach((u) => { if (u.email) map.set(u.email.toLowerCase(), u.id); });
    if (list.length < 1000) break;
  }
  return map;
}

const r = await rest('users?select=id,name,email,password,is_active,auth_user_id&auth_user_id=is.null&order=name');
if (!r.ok) die(`reading users failed: HTTP ${r.status}`);
const rows = await r.json();
const existing = await authUsersByEmail();

// The same email on two CRM accounts cannot share one sign-in: skip both.
const seen = new Map();
rows.forEach((u) => { const e = String(u.email || '').trim().toLowerCase(); seen.set(e, (seen.get(e) || 0) + 1); });

const plan = [];
for (const u of rows) {
  const email = String(u.email || '').trim().toLowerCase();
  const pw = String(u.password ?? '');
  let action, why = '';
  if (u.is_active === false) { action = 'skip'; why = 'inactive'; }
  else if (!looksLikeEmail(email)) { action = 'skip'; why = 'no valid email'; }
  else if (seen.get(email) > 1) { action = 'skip'; why = 'email used by two accounts'; }
  else if (existing.has(email)) { action = 'link'; why = 'sign-in already exists for this email'; }
  else if (NO_PW.has(pw)) { action = 'skip'; why = 'no stored password'; }
  else if (pw.length < 6) {
    if (shortReset) { action = 'create'; why = 'short password: must use Forgot password'; }
    else { action = 'skip'; why = 'password shorter than 6 (add --short-reset to move it)'; }
  }
  else action = 'create';
  plan.push({ u, email, pw, action, why });
}

console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (nothing written)'} — ${BASE}\n`);
plan.forEach((p) => console.log(`${p.action.padEnd(7)} ${String(p.u.name || '').padEnd(28)} ${p.email}${p.why ? '  (' + p.why + ')' : ''}`));
const count = (a) => plan.filter((p) => p.action === a).length;
console.log(`\ncreate ${count('create')} · link ${count('link')} · skip ${count('skip')}`);
if (!apply) { console.log('\nRun again with --apply --confirm', BASE, 'to do it.'); return; }

let done = 0, failed = 0;
for (const p of plan) {
  if (p.action === 'skip') continue;
  let authId = existing.get(p.email);
  if (p.action === 'create') {
    const c = await admin('users', { method: 'POST', body: JSON.stringify({ email: p.email, password: p.pw.length >= 6 ? p.pw : randomBytes(24).toString('base64url'), email_confirm: true }) });
    const j = await c.json().catch(() => ({}));
    if (!c.ok || !j.id) { failed++; console.log(`FAILED  ${p.u.name}: could not create sign-in (HTTP ${c.status} ${j.msg || j.error_code || ''})`); continue; }
    authId = j.id;
  }
  // Link, and drop the plain-text password only for accounts whose sign-in now holds it.
  const patch = p.action === 'create' ? { auth_user_id: authId, password: '!auth' } : { auth_user_id: authId };
  const l = await rest(`users?id=eq.${encodeURIComponent(p.u.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!l.ok) { failed++; console.log(`FAILED  ${p.u.name}: linking failed (HTTP ${l.status})`); continue; }
  done++;
}
console.log(`\nDone: ${done} moved, ${failed} failed. They sign in with the same email and password as before.`);
if (plan.some((p) => p.action === 'link')) console.log('Linked accounts use the password their existing sign-in already has.');
const forced = plan.filter((p) => p.action === 'create' && p.pw.length < 6);
if (forced.length) console.log(`These ${forced.length} must set a new password with "Forgot password?": ${forced.map((p) => p.u.name).join(', ')}`);
}

main().catch((e) => { process.exitCode = 1; if (!(e instanceof Stop)) console.error(e); });
