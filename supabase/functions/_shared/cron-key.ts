// Shared-secret gate for functions pg_cron calls (wa-followup). Fail closed:
// with the key unset, or shorter than 32 characters, every call is refused, so
// the secret and the cron job's header must be set before the deploy. Anything
// without the exact header is refused. Compared in constant time so the header
// cannot be guessed byte by byte.

export type CronGate = { ok: true } | { ok: false; status: number; error: string };
const MIN_KEY = 32;

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function cronKeyGate(req: Request, configured: string | undefined, header: string): CronGate {
  if (!configured || configured.length < MIN_KEY) return { ok: false, status: 503, error: `${header} secret is not set (32+ characters)` };
  const got = req.headers.get(header) ?? "";
  return same(got, configured) ? { ok: true } : { ok: false, status: 401, error: "Unauthorized" };
}
