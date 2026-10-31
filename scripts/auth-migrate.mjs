#!/usr/bin/env node
// Auth account migration for the CR-001 D1 cutover (plan §8.4). For every
// ACTIVE CRM account with no linked sign-in: create a Supabase Auth user with
// no usable password (a random one that is never stored or shown), link it by
// users.auth_user_id, and generate a one-time recovery link so the person sets
// their own password. No password is carried over and none is shared.
//
// Dry run by default. Writes only with --apply and --confirm <SUPABASE_URL>.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role> \
//   node scripts/auth-migrate.mjs [--company <id>] [--apply --confirm https://<ref>.supabase.co
//                                  --out <file> --redirect https://<app>/]
//
// The links go only to --out (created 0600); deliver each one to its owner
// out of band and delete the file. A link is single-use and expires (GoTrue
// mailer OTP expiry). An Auth user that already has the account's email is
// linked, not duplicated. Inactive accounts are skipped. users.password is
// never read or written: clearing it is a separate, later migration.
import { randomBytes } from 'node:crypto';
import { openSync, writeSync, closeSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(`auth-migrate: ${m}`); process.exit(1); };

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const apply = flag('--apply');
const company = arg('--company');
const out = arg('--out');
const redirect = arg('--redirect');
if (!URL_ || !SVC) die('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
if (apply) {
  const confirm = String(arg('--confirm') || '').replace(/\/+$/, '');
  if (!confirm) die(`--apply needs --confirm <SUPABASE_URL> (${URL_})`);
  if (confirm !== URL_) die(`--confirm ${confirm} does not match SUPABASE_URL ${URL_}`);
  if (!out) die('--apply needs --out <file> for the one-time links');
}

const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const rest = (p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const admin = (p, init = {}) => fetch(`${URL_}/auth/v1/admin/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

const scope = company ? `&company_id=eq.${encodeURIComponent(company)}` : '';
const users = await (await rest(`users?select=id,email,is_active,auth_user_id&order=id${scope}`)).json();
if (!Array.isArray(users)) die('could not read users');

// Every existing Auth user, by lower-cased email, so an existing sign-in is linked.
const authByEmail = new Map();
for (let page = 1; ; page++) {
  const r = await (await admin(`users?page=${page}&per_page=1000`)).json();
  const list = r.users || [];
  for (const a of list) if (a.email) authByEmail.set(a.email.toLowerCase(), a.id);
  if (list.length < 1000) break;
}

const todo = users.filter((u) => u.is_active !== false && !u.auth_user_id);
const inactive = users.filter((u) => u.is_active === false && !u.auth_user_id).length;
const already = users.filter((u) => u.auth_user_id).length;
const toLink = todo.filter((u) => authByEmail.has(String(u.email).toLowerCase())).length;
if (!apply) {
  console.log(`DRY RUN: would create ${todo.length - toLink}, link ${toLink}, skip ${inactive} inactive, already linked ${already}. Nothing written.`);
  process.exit(0);
}

const fd = openSync(out, 'w', 0o600);
let created = 0, linked = 0;
try {
  for (const u of todo) {
    const email = String(u.email).trim().toLowerCase();
    let id = authByEmail.get(email);
    if (id) linked++;
    else {
      // A random password nobody ever sees: the account cannot be signed into
      // until its owner uses the recovery link.
      const r = await admin('users', { method: 'POST', body: JSON.stringify({ email, password: randomBytes(32).toString('base64url'), email_confirm: true }) });
      if (!r.ok) die(`could not create the sign-in for ${email} (HTTP ${r.status})`);
      id = (await r.json()).id; created++;
    }
    const p = await rest(`users?id=eq.${encodeURIComponent(u.id)}&auth_user_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ auth_user_id: id }) });
    if (!p.ok || !(await p.json()).length) die(`could not link ${email} (HTTP ${p.status})`);
    const g = await admin('generate_link', { method: 'POST', body: JSON.stringify({ type: 'recovery', email, ...(redirect ? { redirect_to: redirect } : {}) }) });
    if (!g.ok) die(`could not generate a link for ${email} (HTTP ${g.status})`);
    const j = await g.json();
    writeSync(fd, `${email}\t${j.action_link || j.properties?.action_link}\n`);
  }
} finally { closeSync(fd); }
console.log(`auth-migrate: created ${created}, linked ${linked}, skipped ${inactive} inactive, already linked ${already}. One-time links written to ${out} (0600); deliver each to its owner, then delete the file.`);
