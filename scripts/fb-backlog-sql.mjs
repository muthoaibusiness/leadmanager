// Turns Ads Manager lead CSV exports into the SQL that queues those leads for the backlog drip
// (table from migration 0063). Prints SQL; paste it into the Supabase SQL editor.
//   node scripts/fb-backlog-sql.mjs <file.csv> [more.csv]            (prints the SQL)
//   node scripts/fb-backlog-sql.mjs <file.csv> [more.csv] --out=backlog.sql   (writes it to a file)
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('Usage: node scripts/fb-backlog-sql.mjs <file.csv> [more.csv]'); process.exit(1); }
const digits = (s) => String(s || '').replace(/\D/g, '');
function read(f) {
  const b = readFileSync(f);
  return (b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le') : b.toString('utf8')).replace(/^﻿/, '');
}
const rows = new Map();
for (const f of files) {
  const [head, ...lines] = read(f).split(/\r?\n/).filter(Boolean);
  const cols = head.split('\t').map((c) => c.trim());
  const at = (n) => cols.indexOf(n);
  for (const l of lines) {
    const v = l.split('\t');
    const id = digits(v[at('id')]), form = digits(v[at('form_id')]);
    if (id && form && !rows.has(id)) rows.set(id, `('${id}', '${form}', '${String(v[at('created_time')] || '').replace(/[^0-9T:+\-.Z]/g, '')}')`);
  }
}
const sql = `-- ${rows.size} leads
insert into fb_lead_backlog (leadgen_id, form_id, created_time) values\n${[...rows.values()].join(',\n')}\non conflict (leadgen_id) do nothing;
`;
if (out) { writeFileSync(out, sql); console.log(`${rows.size} leads written to ${out}`); } else console.log(sql);
