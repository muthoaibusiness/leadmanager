// npm run test:capi:race — the shared limiter under real concurrency.
//
// PGlite (test-0050.mjs) runs one connection, so it cannot race. This runs
// migrations 0050 + 0051 in a throwaway database on the local Docker Postgres
// (supabase_db_wepro-capi-local), fires N truly parallel capi_acquire() calls
// from N psql sessions, and checks no limit is ever exceeded. The database is
// created and dropped here; nothing else on the stack is touched, and the
// production project is never reached (docker exec into a local container).
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const CONTAINER = process.env.CAPI_RACE_CONTAINER || 'supabase_db_wepro-capi-local';
const DB = `capi_race_${process.pid}`;
const psqlArgs = (db, sql) => ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', sql];
const sh = (db, sql) => execFileSync('docker', psqlArgs(db, sql), { encoding: 'utf8' }).trim();
const shFile = (db, sql) => execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
const race = (n, mk) => Promise.all(Array.from({ length: n }, (_, i) => new Promise((res, rej) => {
  const p = spawn('docker', psqlArgs(DB, mk(i)));
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (c) => (c === 0 ? res(JSON.parse(out.trim())) : rej(new Error(err))));
})));

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };

sh('postgres', `create database ${DB}`);
try {
  // The live shape these migrations need (as in test-0050.mjs). Roles exist on the stack.
  shFile(DB, `create table public.leads (id text primary key, name text, source text, company_id text, property_interest text, status text,
      ctwa_clid text, "CAPI_STATUS" text, created_at timestamptz default now());
    create table public.activities (id text primary key, lead_id text, type text, description text, user_id text, "timestamp" timestamptz default now());
    create table public.wa_bot_settings (bot text primary key, display_name text not null, meta_capi_enabled boolean not null default true);`);
  for (const f of ['0050_meta_capi_attempts.sql', '0051_meta_capi_qualified_limiter.sql']) shFile(DB, readFileSync(`supabase/migrations/${f}`, 'utf8'));
  const reset = (sets) => sh(DB, `delete from public.capi_send_locks; delete from public.capi_send_permits;
    update public.capi_settings set throttled_until = null, throttle_strikes = 0, ${sets};`);
  const acquire = (lead) => `select public.capi_acquire('${lead}', 'ui_retry', 120)`;
  const tally = (rs) => rs.reduce((m, r) => ({ ...m, [r.reason ?? r.result]: (m[r.reason ?? r.result] ?? 0) + 1 }), {});

  await t('40 parallel senders, 2 at once allowed: exactly 2 get through', async () => {
    reset('rate_window_seconds = 60, rate_max_sends = 1000, max_concurrent_sends = 2');
    const rs = await race(40, (i) => acquire(`c${i}`));
    assert.equal(rs.filter((r) => r.result === 'ok').length, 2, JSON.stringify(tally(rs)));
    assert.equal(Number(sh(DB, `select count(*) from public.capi_send_locks`)), 2);
  });

  await t('40 parallel senders racing for the last 3 permits in the window: exactly 3 get through', async () => {
    reset('rate_window_seconds = 60, rate_max_sends = 10, max_concurrent_sends = 1000');
    sh(DB, `insert into public.capi_send_permits (lead_id, source) select 'old' || g, 'bot' from generate_series(1, 7) g`);
    const rs = await race(40, (i) => acquire(`w${i}`));
    assert.equal(rs.filter((r) => r.result === 'ok').length, 3, JSON.stringify(tally(rs)));
    assert.equal(Number(sh(DB, `select count(*) from public.capi_send_permits`)), 10, 'the window holds exactly its limit');
  });

  await t('40 parallel senders on one lead: exactly 1 holds it, the rest are told it is locked', async () => {
    reset('rate_window_seconds = 60, rate_max_sends = 1000, max_concurrent_sends = 1000');
    const rs = await race(40, () => acquire('same'));
    assert.equal(rs.filter((r) => r.result === 'ok').length, 1, JSON.stringify(tally(rs)));
    assert.ok(rs.every((r) => r.result === 'ok' || r.result === 'locked'));
  });

  await t('a throttle racing 40 senders: once it lands, none gets through', async () => {
    reset('rate_window_seconds = 60, rate_max_sends = 1000, max_concurrent_sends = 1000');
    sh(DB, `select public.capi_throttle(120)`);
    const rs = await race(40, (i) => acquire(`t${i}`));
    assert.equal(rs.filter((r) => r.result === 'ok').length, 0, JSON.stringify(tally(rs)));
  });
} finally {
  sh('postgres', `drop database if exists ${DB} with (force)`);
}
console.log(`\n${pass} passed`);
