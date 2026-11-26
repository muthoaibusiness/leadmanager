// npm run test:0074 — applies 0074 (twice) to PGlite and checks who may register
// a phone for push, and which notifications the trigger hands to push-send.
// pg_net is replaced by a table that records each call. Nothing here touches a
// real database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.users (id text primary key, role text, company_id text, is_active boolean default true, auth_user_id uuid);
  -- As in migration 0054.
  create function public.crm_me() returns table (id text, role text, company_id text, is_active boolean)
    language sql stable security definer set search_path = public, pg_temp as $$
    select u.id, u.role, u.company_id, u.is_active from public.users u where u.auth_user_id = auth.uid() $$;
  grant execute on function public.crm_me() to authenticated;
  create table public.notifications (id text primary key, user_id text, type text, message text, lead_id text,
    is_read boolean default false, created_at timestamptz default now(), company_id text);
  -- As in migration 0067: browser-made follow-up reminders are dropped.
  create function public.notif_insert_guard() returns trigger language plpgsql as $$
    begin if new.id like 'fu-%' then return null; end if; return new; end $$;
  create trigger notif_insert_guard before insert on public.notifications for each row execute function public.notif_insert_guard();
  grant all on public.notifications, public.users to authenticated, service_role;
  -- pg_net stand-in.
  create schema net;
  create table net.calls (id serial primary key, url text, body jsonb, headers jsonb);
  create table net.fail (on_ boolean);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language plpgsql as $$
    declare v bigint;
    begin
      if exists (select 1 from net.fail where on_) then raise exception 'pg_net is down'; end if;
      insert into net.calls (url, body, headers) values (url, body, headers) returning id into v; return v;
    end $$;
  insert into public.users values
    ('u1', 'AGENT', 'c1', true, '00000000-0000-0000-0000-000000000001'),
    ('u2', 'AGENT', 'c2', true, '00000000-0000-0000-0000-000000000002'),
    ('u3', 'AGENT', 'c1', false, '00000000-0000-0000-0000-000000000003');`);
const m = readFileSync('supabase/migrations/0074_push_subscriptions.sql', 'utf8');
await db.exec(m);
const key1 = (await db.query(`select value from public.app_secrets where name = 'push_hook_key'`)).rows[0].value;
await db.exec(m); // re-runnable

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const UID = { u1: '00000000-0000-0000-0000-000000000001', u2: '00000000-0000-0000-0000-000000000002', u3: '00000000-0000-0000-0000-000000000003' };
// Run as a signed-in account (or as anon / a session with no CRM row).
const as = async (who, fn, role = 'authenticated') => {
  await db.exec(`set test.uid = '${UID[who] || ''}'; set role ${role}`);
  try { return await fn(); } finally { await db.exec(`reset role; set test.uid = ''`); }
};
const subscribe = (who, endpoint, role) => as(who, () => db.query(`select public.push_subscribe($1, 'p256', 'auth', 'ua') as ok`, [endpoint]), role);
const subs = () => rows(`select endpoint, user_id, company_id from public.push_subscriptions order by endpoint`);
const calls = () => rows(`select url, body, headers from net.calls order by id`);
const notify = (vals) => db.exec(`insert into public.notifications (id, user_id, type, message, lead_id) values ${vals}`);

await t('the hook key is 64 hex characters and survives a re-run', async () => {
  assert.match(key1, /^[0-9a-f]{64}$/);
  assert.equal((await rows(`select value from public.app_secrets where name = 'push_hook_key'`))[0].value, key1);
});

await t('a signed-in account registers its phone, stamped with its own id and company', async () => {
  await subscribe('u1', 'https://fcm.googleapis.com/a');
  assert.deepEqual(await subs(), [{ endpoint: 'https://fcm.googleapis.com/a', user_id: 'u1', company_id: 'c1' }]);
});

await t('anon, a session with no CRM account and a deactivated account are refused', async () => {
  await assert.rejects(subscribe('', 'https://fcm.googleapis.com/x', 'anon'), /permission denied/);
  await assert.rejects(subscribe('nobody', 'https://fcm.googleapis.com/x'), /Sign in required/);
  await assert.rejects(subscribe('u3', 'https://fcm.googleapis.com/x'), /Sign in required/);
  assert.equal((await subs()).length, 1);
});

await t('a subscription that is not an https address, or has no keys, is refused', async () => {
  await assert.rejects(subscribe('u1', 'http://fcm.googleapis.com/x'), /Invalid push subscription/);
  await assert.rejects(subscribe('u1', null), /Invalid push subscription/);
  await assert.rejects(as('u1', () => db.query(`select public.push_subscribe('https://fcm.googleapis.com/x', '', 'auth')`)), /Invalid push subscription/);
});

await t('the table itself cannot be read or written by the app', async () => {
  await assert.rejects(as('u1', () => db.query(`select * from public.push_subscriptions`)), /permission denied/);
  await assert.rejects(as('u1', () => db.query(`insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://x', 'u2', 'p', 'a')`)), /permission denied/);
  await assert.rejects(as('u1', () => db.query(`select * from public.app_secrets`)), /permission denied/);
});

await t('another account signing in on the same phone takes the subscription over', async () => {
  await subscribe('u2', 'https://fcm.googleapis.com/a');
  assert.deepEqual(await subs(), [{ endpoint: 'https://fcm.googleapis.com/a', user_id: 'u2', company_id: 'c2' }]);
  await subscribe('u1', 'https://fcm.googleapis.com/a');
});

await t('unsubscribe removes only the caller\'s own phone', async () => {
  const un = (who, e) => as(who, async () => (await db.query(`select public.push_unsubscribe($1) as ok`, [e])).rows[0].ok);
  assert.equal(await un('u2', 'https://fcm.googleapis.com/a'), false);
  assert.equal((await subs()).length, 1);
  assert.equal(await un('u1', 'https://fcm.googleapis.com/a'), true);
  assert.equal((await subs()).length, 0);
});

await t('an account keeps its ten most recent phones', async () => {
  for (let i = 0; i < 12; i++) {
    await subscribe('u1', `https://fcm.googleapis.com/d${String(i).padStart(2, '0')}`);
    await db.exec(`update public.push_subscriptions set updated_at = now() - interval '1 hour' * (20 - ${i}) where endpoint like '%/d${String(i).padStart(2, '0')}'`);
  }
  await subscribe('u1', 'https://fcm.googleapis.com/d99');
  const mine = (await subs()).map((s) => s.endpoint.split('/').pop());
  assert.equal(mine.length, 10);
  assert.equal(mine.includes('d00'), false);
  assert.equal(mine.includes('d99'), true);
});

await t('a notification for an account with no phone makes no call', async () => {
  await notify(`('n1', 'u2', 'ASSIGNED', 'no phone', 'L1')`);
  assert.equal((await calls()).length, 0);
});

await t('one statement makes one call, with only the rows of accounts that have a phone', async () => {
  await notify(`('n2', 'u1', 'ASSIGNED', 'New lead assigned: Rahim', 'L1'), ('n3', 'u2', 'ASSIGNED', 'no phone', 'L2'), ('n4', 'u1', 'FOLLOW_UP', '${'x'.repeat(500)}', null)`);
  const c = await calls();
  assert.equal(c.length, 1);
  assert.match(c[0].url, /\/functions\/v1\/push-send$/);
  assert.equal(c[0].headers['x-push-key'], key1);
  assert.deepEqual(c[0].body.rows.map((r) => r.id).sort(), ['n2', 'n4']);
  assert.deepEqual(c[0].body.rows.find((r) => r.id === 'n2'), { id: 'n2', user_id: 'u1', type: 'ASSIGNED', message: 'New lead assigned: Rahim', lead_id: 'L1' });
  assert.equal(c[0].body.rows.find((r) => r.id === 'n4').message.length, 300);
});

await t('a row seen before (upsert) and a row the fu- guard drops are not pushed', async () => {
  await db.exec(`delete from net.calls`);
  await db.exec(`insert into public.notifications (id, user_id, type, message) values ('n2', 'u1', 'ASSIGNED', 'again')
    on conflict (id) do update set message = excluded.message`);
  await db.exec(`insert into public.notifications (id, user_id, type, message) values ('n2', 'u1', 'ASSIGNED', 'again') on conflict (id) do nothing`);
  await notify(`('fu-1', 'u1', 'FOLLOW_UP', 'browser-made', null)`);
  assert.equal((await calls()).length, 0);
});

await t('a notification written by the signed-in app is pushed too', async () => {
  await as('u2', () => db.query(`insert into public.notifications (id, user_id, type, message) values ('n5', 'u1', 'DEAL_WON', 'Deal won: Karim')`));
  const c = await calls();
  assert.equal(c.length, 1);
  assert.equal(c[0].body.rows[0].id, 'n5');
});

await t('when the call fails, the notification is still written', async () => {
  await db.exec(`delete from net.calls; insert into net.fail values (true)`);
  await notify(`('n6', 'u1', 'ASSIGNED', 'pg_net is down', null)`);
  assert.equal((await rows(`select 1 from public.notifications where id = 'n6'`)).length, 1);
  assert.equal((await calls()).length, 0);
  await db.exec(`delete from net.fail`);
});

console.log(`\n${pass} passed`);
