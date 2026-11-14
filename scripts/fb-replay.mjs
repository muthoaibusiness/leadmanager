// Replays Facebook Lead Ads leads from the Ads Manager CSV export through the fb-leads function:
// each lead is fetched from Meta by id and handled by its form's settings (Admin > Facebook
// Leads), so a form set to "Forward" assigns it and messages the customer. Leads already
// handled are not made twice (same id, or same phone -> a note).
//
//   FOLLOWUP_CRON_KEY=...  node scripts/fb-replay.mjs <file.csv> [more.csv] [--dry]
//   (SUPABASE_URL is read from .env when not set)
//
// The key is the one in the wa-followup cron job; type it in your own shell, never in a chat.
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('Usage: node scripts/fb-replay.mjs <file.csv> [more.csv] [--dry]'); process.exit(1); }

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const base = (process.env.SUPABASE_URL || /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1] || '').trim().replace(/\/+$/, '');
const key = process.env.FOLLOWUP_CRON_KEY || '';
if (!base) { console.error('SUPABASE_URL is not set (and not in .env).'); process.exit(1); }
if (!dry && !key) { console.error('FOLLOWUP_CRON_KEY is not set.'); process.exit(1); }

// Ads Manager exports UTF-16 with a tab between columns; read either that or plain UTF-8.
function read(f) {
  const b = readFileSync(f);
  return (b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le') : b.toString('utf8')).replace(/^﻿/, '');
}
const digits = (s) => String(s || '').replace(/\D/g, '');

const leads = new Map();
for (const f of files) {
  const [head, ...rows] = read(f).split(/\r?\n/).filter(Boolean);
  const cols = head.split('\t').map((c) => c.trim());
  const at = (n) => cols.indexOf(n);
  for (const r of rows) {
    const v = r.split('\t');
    const id = digits(v[at('id')]);
    if (id && !leads.has(id)) leads.set(id, { leadgen_id: id, form_id: digits(v[at('form_id')]), created: v[at('created_time')] || '' });
  }
}
const list = [...leads.values()].sort((a, b) => a.created.localeCompare(b.created));
console.log(`${list.length} leads from ${files.length} file(s)${dry ? ' (dry run: nothing sent)' : ''}`);
if (dry) process.exit(0);

const tally = {};
for (let i = 0; i < list.length; i += 8) {
  const batch = list.slice(i, i + 8);
  const r = await fetch(`${base}/functions/v1/fb-leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-followup-key': key }, body: JSON.stringify({ replay: batch }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`batch ${i / 8 + 1} refused: ${r.status} ${j.error || ''}`); process.exit(1); }
  for (const o of j.results || []) {
    tally[o.status] = (tally[o.status] || 0) + 1;
    console.log(`${o.leadgen_id}  ${o.status}${o.error ? '  ' + o.error : ''}`);
  }
}
console.log('\nDone:', tally);
