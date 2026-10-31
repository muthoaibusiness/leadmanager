// node scripts/cr001-followup-e2e.mjs — wa-followup behind FOLLOWUP_CRON_KEY,
// end to end on the isolated local stack only (CR001_* env, loopback URLs).
// The local functions server must run with FOLLOWUP_CRON_KEY=$KEY and
// WASENDER_BASE pointing at the local Wasender stub (STUB_LOG), so nothing
// reaches WhatsApp. One throwaway prelead (stage greeted, 6 minutes old, no
// replies) is the only row in a follow-up stage.
//   * no header, a wrong header, the anon key as header: 401, nothing claimed
//   * a local pg_cron job posting the right x-followup-key through pg_net:
//     the prelead moves greeted -> asked_profile and the stub gets one send
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = process.env.CR001_API_URL; const DB = process.env.CR001_DB_URL; const ANON = process.env.CR001_ANON_KEY;
const KEY = process.env.FOLLOWUP_CRON_KEY; const STUB_LOG = process.env.STUB_LOG || '/tmp/cr001-sb/wasender-stub.log';
if (!API || !DB || !KEY) throw new Error('set CR001_* and FOLLOWUP_CRON_KEY (local stack only)');
for (const u of [API, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname)) throw new Error(`refusing ${u}`);
const sql = (q) => execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atqc', q], { encoding: 'utf8' }).trim();
const stub = () => readFileSync(STUB_LOG, 'utf8').split('\n').filter(Boolean);
const active = Number(sql(`select count(*) from public.preleads where flow_stage is not null`));
assert.equal(active, 0, 'park the real follow-up rows first: only the throwaway row may be in a stage');

const tag = randomUUID(); const job = 'cr001-fu-' + Date.now(); const phone = '88017' + String(Date.now()).slice(-8);
sql(`insert into public.preleads (id, name, phone, "WA", message_logs, flow_stage, stage_at, stage_msg_count)
     values ('${tag}', 'Follow-up test', '${phone}', 'Eyad', '[]'::jsonb, 'greeted', now() - interval '6 minutes', 0)`);
const stage = () => sql(`select coalesce(flow_stage,'null') from public.preleads where id='${tag}'`);
const call = (h) => fetch(`${API}/functions/v1/wa-followup`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h } });

try {
  const before = stub().length;
  for (const h of [{}, { 'x-followup-key': 'wrong' }, { 'x-followup-key': ANON }, { Authorization: `Bearer ${ANON}` }]) {
    const r = await call(h);
    assert.equal(r.status, 401, `${JSON.stringify(Object.keys(h))}: ${r.status}`);
  }
  assert.equal(stage(), 'greeted', 'refused calls claimed nothing');
  assert.equal(stub().length, before, 'refused calls sent nothing');

  // The local cron job, configured the way production would be: secret in the header.
  const url = `http://host.docker.internal:${new URL(API).port}/functions/v1/wa-followup`;
  sql(`select cron.schedule('${job}', '* * * * *', $$ select net.http_post(url := '${url}', headers := jsonb_build_object('Content-Type','application/json','x-followup-key','${KEY}')) $$)`);
  let s = 'greeted';
  for (let i = 0; i < 100 && s === 'greeted'; i++) { await new Promise((ok) => setTimeout(ok, 1500)); s = stage(); }
  assert.equal(s, 'asked_profile', `cron-triggered run moved the stage (now ${s})`);
  const sent = stub().slice(before);
  assert.equal(sent.length, 1, 'one follow-up message reached the stub');
  assert.equal(JSON.parse(sent[0]).body.to.replace(/\D/g, ''), phone);
  const codes = sql(`select coalesce(string_agg(status_code::text, ',' order by id), '') from net._http_response where created > now() - interval '5 minutes'`);
  assert.match(codes, /(^|,)200(,|$)/, `pg_net saw 200 from wa-followup (${codes})`);
  console.log(`followup e2e PASS: unauthenticated / wrong-key / anon calls 401 with nothing claimed or sent; local pg_cron with x-followup-key moved greeted -> asked_profile and sent 1 message to the stub`);
} finally {
  sql(`select cron.unschedule('${job}') where exists (select 1 from cron.job where jobname='${job}')`);
  sql(`delete from public.preleads where id='${tag}'`);
  sql(`delete from public.wa_messages where phone='${phone}'`);
  sql(`delete from public.wa_conversations where phone='${phone}'`);
}
