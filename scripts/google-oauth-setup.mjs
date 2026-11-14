// node scripts/google-oauth-setup.mjs ["Google Cloude Credential.json"]
//
// Stores the Google OAuth client (from the downloaded JSON) as Supabase secrets
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, plus a fresh GOOGLE_SETUP_KEY, and
// prints the link that connects the sending Gmail account through the
// google-oauth Edge Function. The client secret is never printed.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const PROJECT_REF = 'sbqmougcvnplgjgihpwe';
const BASE = `https://${PROJECT_REF}.supabase.co/functions/v1/google-oauth`;
const file = process.argv[2] || 'Google Cloude Credential.json';
const raw = JSON.parse(readFileSync(file, 'utf8'));
const c = raw.web || raw.installed;
if (!c?.client_id || !c?.client_secret) { console.error('No client_id / client_secret in', file); process.exit(1); }

const setupKey = randomBytes(18).toString('hex');
const envFile = join(tmpdir(), `wepro-google-${process.pid}.env`);
writeFileSync(envFile, `GOOGLE_CLIENT_ID=${c.client_id}\nGOOGLE_CLIENT_SECRET=${c.client_secret}\nGOOGLE_SETUP_KEY=${setupKey}\n`, { mode: 0o600 });
let ok = false;
try {
  // Windows runs npx through cmd.exe; quote the temp path (it may hold spaces).
  const win = process.platform === 'win32';
  const cmd = `npx supabase secrets set --env-file "${envFile}" --project-ref ${PROJECT_REF}`;
  ok = (win ? spawnSync(cmd, { stdio: 'inherit', shell: true }) : spawnSync('npx', ['supabase', 'secrets', 'set', '--env-file', envFile, '--project-ref', PROJECT_REF], { stdio: 'inherit' })).status === 0;
} finally { try { unlinkSync(envFile); } catch { /* gone */ } }
if (!ok) { console.error('\nSaving the secrets failed (see above). Are you logged in? npx supabase login'); process.exit(1); }

console.log(`
Secrets saved.

1. In Google Cloud Console > Credentials > your OAuth client, add this to
   "Authorized redirect URIs":
     ${BASE}/callback
2. Deploy:  npx supabase functions deploy google-oauth --no-verify-jwt --project-ref ${PROJECT_REF}
            npx supabase functions deploy email-otp --no-verify-jwt --project-ref ${PROJECT_REF}
3. Open this link and sign in with the Gmail account that should SEND the codes:
     ${BASE}/start?key=${setupKey}
   (The link works until you run this script again. Keep it to yourself.)
`);
