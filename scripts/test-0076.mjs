// npm run test:0076 — applies 0074 then 0076 (twice) to PGlite and checks who may
// register a native phone for push, and that the trigger now also covers them.
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
const m76 = readFileSync('supabase/migrations/0076_push_devices.sql', 'utf8');
await db.exec(m76);
await db.exec(m76); // re-runnable

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('ok -', name); };
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const UID = { u1: '00000000-0000-0000-0000-000000000001', u2: '00000000-0000-0000-0000-000000000002', u3: '00000000-0000-0000-0000-000000000003' };
const as = async (who, fn, role = 'authenticated') => {
  await db.exec(`set test.uid = '${UID[who] || ''}'; set role ${role}`);
  try { return await fn(); } finally { await db.exec(`reset role; set test.uid = ''`); }
};
const TOK = (s) => `ExponentPushToken[${s}]`;
const register = (who, token, role) => as(who, () => db.query(`select public.push_register_device($1, 'android', 'Pixel') as ok`, [token]), role);
const devices = () => rows(`select token, user_id, company_id, platform from public.push_devices order by token`);
const calls = () => rows(`select url, body, headers from net.calls order by id`);
const notify = (vals) => db.exec(`insert into public.notifications (id, user_id, type, message, lead_id) values ${vals}`);

await t('a signed-in account registers its phone, stamped with its own id and company', async () => {
  await register('u1', TOK('aaa'));
  assert.deepEqual(await devices(), [{ token: TOK('aaa'), user_id: 'u1', company_id: 'c1', platform: 'android' }]);
});

await t('anon, a session with no CRM account and a deactivated account are refused', async () => {
  await assert.rejects(register('', TOK('x'), 'anon'), /permission denied/);
  await assert.rejects(register('nobody', TOK('x')), /Sign in required/);
  await assert.rejects(register('u3', TOK('x')), /Sign in required/);
  assert.equal((await devices()).length, 1);
});

await t('only an Expo push token is accepted', async () => {
  for (const bad of ['https://evil.example/x', 'ExponentPushToken[]', 'ExponentPushToken[a] x', '', null]) {
    await assert.rejects(register('u1', bad), /Invalid push token/);
  }
  await register('u1', 'ExpoPushToken[newFormat_1-2]');
  await db.exec(`delete from public.push_devices where token like 'ExpoPushToken%'`);
});

await t('the table itself cannot be read or written by the app', async () => {
  await assert.rejects(as('u1', () => db.query(`select * from public.push_devices`)), /permission denied/);
  await assert.rejects(as('u1', () => db.query(`insert into public.push_devices (token, user_id) values ('ExponentPushToken[z]', 'u2')`)), /permission denied/);
});

await t('another account signing in on the same phone takes the token over', async () => {
  await register('u2', TOK('aaa'));
  assert.deepEqual((await devices()).map((d) => d.user_id + ':' + d.company_id), ['u2:c2']);
  await register('u1', TOK('aaa'));
});

await t('unregister removes only the caller\'s own phone', async () => {
  const un = (who, tk) => as(who, async () => (await db.query(`select public.push_unregister_device($1) as ok`, [tk])).rows[0].ok);
  assert.equal(await un('u2', TOK('aaa')), false);
  assert.equal((await devices()).length, 1);
  assert.equal(await un('u1', TOK('aaa')), true);
  assert.equal((await devices()).length, 0);
});

await t('an account keeps its ten most recent phones', async () => {
  for (let i = 0; i < 12; i++) {
    const id = 'd' + String(i).padStart(2, '0');
    await register('u1', TOK(id));
    await db.exec(`update public.push_devices set updated_at = now() - interval '1 hour' * (20 - ${i}) where token = '${TOK(id)}'`);
  }
  await register('u1', TOK('d99'));
  const mine = (await devices()).map((d) => d.token);
  assert.equal(mine.length, 10);
  assert.equal(mine.includes(TOK('d00')), false);
  assert.equal(mine.includes(TOK('d99')), true);
  await db.exec(`delete from public.push_devices`);
});

await t('a notification for an account with no phone of either kind makes no call', async () => {
  await notify(`('n1', 'u2', 'ASSIGNED', 'no phone', 'L1')`);
  assert.equal((await calls()).length, 0);
});

await t('an account whose only phone is a native one is now pushed', async () => {
  await register('u1', TOK('aaa'));
  await notify(`('n2', 'u1', 'ASSIGNED', 'New lead assigned: Rahim', 'L1'), ('n3', 'u2', 'ASSIGNED', 'no phone', 'L2')`);
  const c = await calls();
  assert.equal(c.length, 1);
  assert.match(c[0].url, /\/functions\/v1\/push-send$/);
  assert.match(c[0].headers['x-push-key'], /^[0-9a-f]{64}$/);
  assert.deepEqual(c[0].body.rows, [{ id: 'n2', user_id: 'u1', type: 'ASSIGNED', message: 'New lead assigned: Rahim', lead_id: 'L1' }]);
});

await t('an account with a web subscription is still pushed (0074 unchanged)', async () => {
  await db.exec(`delete from net.calls`);
  await as('u2', () => db.query(`select public.push_subscribe('https://fcm.googleapis.com/a', 'p256', 'auth', 'ua')`));
  await notify(`('n4', 'u2', 'DEAL_WON', 'Deal won', null)`);
  const c = await calls();
  assert.equal(c.length, 1);
  assert.equal(c[0].body.rows[0].id, 'n4');
});

await t('when the call fails, the notification is still written', async () => {
  await db.exec(`delete from net.calls; insert into net.fail values (true)`);
  await notify(`('n5', 'u1', 'ASSIGNED', 'pg_net is down', null)`);
  assert.equal((await rows(`select 1 from public.notifications where id = 'n5'`)).length, 1);
  assert.equal((await calls()).length, 0);
});

console.log(`\n${pass} passed`);
