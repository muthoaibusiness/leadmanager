// Sends one WhatsApp message through Meta's Cloud API by way of the wa-meta-send function.
//   FOLLOWUP_CRON_KEY=...  node scripts/meta-wa-send.mjs <number> --template <name> [--lang bn] [--body "Rahim,4-8 Nov"] [--image <url>]
//   FOLLOWUP_CRON_KEY=...  node scripts/meta-wa-send.mjs <number> --text "hello"        (only inside the customer's 24 h window)
// The key is the one in the wa-followup cron job; type it in your own shell, never in a chat.
// SUPABASE_URL is read from .env when not set.
import { readFileSync, existsSync } from 'node:fs';

const a = process.argv.slice(2);
const to = a[0];
const opt = (n) => { const i = a.indexOf('--' + n); return i > 0 ? a[i + 1] : ''; };
if (!to || (!opt('template') && !opt('text'))) { console.error('Usage: node scripts/meta-wa-send.mjs <number> --template <name> [--lang bn] [--body "a,b"] [--image url]  |  --text "hello"'); process.exit(1); }

const envFile = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const base = (process.env.SUPABASE_URL || /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1] || '').trim().replace(/\/+$/, '');
const key = process.env.FOLLOWUP_CRON_KEY || '';
if (!base) { console.error('SUPABASE_URL is not set (and not in .env).'); process.exit(1); }
if (!key) { console.error('FOLLOWUP_CRON_KEY is not set.'); process.exit(1); }

const body = opt('template')
  ? { to, template: { name: opt('template'), lang: opt('lang') || 'bn', body: opt('body') ? opt('body').split(',').map((s) => s.trim()) : [], header_image: opt('image') || undefined } }
  : { to, text: opt('text') };
const r = await fetch(`${base}/functions/v1/wa-meta-send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-followup-key': key }, body: JSON.stringify(body) });
const j = await r.json().catch(() => ({}));
console.log(r.status, JSON.stringify(j));
process.exitCode = j.ok ? 0 : 1;   // not process.exit(): on Windows it can abort node with a handle assertion after the fetch
