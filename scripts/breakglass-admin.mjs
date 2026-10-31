#!/usr/bin/env node
// Break-glass admin recovery (CR-001 D1). Gives one existing MANAGEMENT
// account a working Supabase Auth sign-in when no admin can get in: no
// sign-in linked yet, password lost, or the account deactivated.
//
// This is an approved emergency change (plan §11), run by an operator who
// holds the service-role key. It writes to the project named by SUPABASE_URL.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service role> \
//   BREAKGLASS_PASSWORD=<10+ characters, typed, never logged> \
//   node scripts/breakglass-admin.mjs --email admin@example.com --confirm https://<ref>.supabase.co
//
// What it does, and nothing else:
//   * links a new Auth sign-in to the account, or sets a new password on the
//     linked one, then ends every session of that sign-in;
//   * reactivates the account if it was inactive;
//   * appends a row to access_audit (actor 'breakglass').
// It never prints or stores the password, and never touches users.password,
// the role, or the feature list. Rollback: none needed; to undo, deactivate
// the account in Users & Accounts › Access, or reset its password again.

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error(`breakglass: ${msg}`); process.exit(1); };

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const email = String(arg('--email') || '').trim().toLowerCase();
const confirm = String(arg('--confirm') || '').replace(/\/+$/, '');
const password = process.env.BREAKGLASS_PASSWORD || '';

if (!URL_ || !SVC) die('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
if (!email) die('--email is required');
if (!confirm) die(`--confirm <SUPABASE_URL> is required, and must equal ${URL_}`);
if (confirm !== URL_) die(`--confirm ${confirm} does not match SUPABASE_URL ${URL_}`);
if (!password) die('set BREAKGLASS_PASSWORD in the environment (never on the command line)');
if (password.length < 10) die('BREAKGLASS_PASSWORD must be at least 10 characters');

const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const rest = (path, init = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const admin = (path, init = {}) => fetch(`${URL_}/auth/v1/admin/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const enc = encodeURIComponent;

const rows = await (await rest(`users?select=id,email,role,is_active,company_id,auth_user_id&email=ilike.${enc(email.replace(/[%_\\]/g, '\\$&'))}`)).json();
const u = (Array.isArray(rows) ? rows : []).find((r) => String(r.email).toLowerCase() === email);
if (!u) die(`No CRM account with email ${email}`);
if (u.role !== 'MANAGEMENT') die(`${email} is not a Management account (role ${u.role}); recovery is for admins only`);

let authId = u.auth_user_id;
let what;
if (authId && (await admin(`users/${enc(authId)}`)).ok) {
  const r = await admin(`users/${enc(authId)}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) });
  if (!r.ok) die(`could not set the password (HTTP ${r.status})`);
  what = 'password reset';
} else {
  const r = await admin('users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!r.ok) die(`could not create the sign-in (HTTP ${r.status}); if ${email} already has one that is not linked, link it first`);
  authId = (await r.json()).id;
  what = 'sign-in created and linked';
}

const patch = { auth_user_id: authId, ...(u.is_active === false ? { is_active: true } : {}) };
const p = await rest(`users?id=eq.${enc(u.id)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
if (!p.ok || !(await p.json()).length) die(`could not link the sign-in to ${u.id} (HTTP ${p.status})`);
if (u.is_active === false) what += ', reactivated';

const rv = await rest('rpc/crm_revoke_sessions', { method: 'POST', body: JSON.stringify({ p_auth_user_id: authId }) });
if (!rv.ok) console.error(`breakglass: warning: could not end older sessions (HTTP ${rv.status}); run it again after migration 0054`);

await rest('access_audit', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
  action: 'breakglass', actor_id: 'breakglass', target_id: u.id, company_id: u.company_id ?? null,
  before: { linked: !!u.auth_user_id, is_active: u.is_active }, after: { linked: true, is_active: true },
}) });

console.log(`breakglass: ${email}: ${what}. Older sessions ended. Sign in with the new password and change it in Profile.`);
