// The verified caller (decision D1). The browser sends its Supabase Auth access
// token as `Authorization: Bearer <jwt>`; GoTrue says whose token it is, and the
// users row linked by auth_user_id (migration 0054) says what that account may
// do. A user id in the request body is never consulted. Deno-free: fetch is
// passed in, so the Node tests drive it.

export type ActorRow = { id: string; name: string; role: string; is_active: boolean; company_id: string | null; team_id: string | null; allowed_features: string[] | null };
export type ActorDeps = { url: string; serviceKey: string; anonKey: string; fetch: (input: string, init?: RequestInit) => Promise<Response> };

export class ActorError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const COLS = "id,name,role,is_active,company_id,team_id,allowed_features";

export async function verifiedActor(req: Request, d: ActorDeps): Promise<ActorRow> {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get("authorization") || "");
  // The anon key is a valid JWT too, but it names no person.
  if (!m || m[1] === d.anonKey) throw new ActorError(401, "Sign in required");
  let sub: string | undefined;
  try {
    const r = await d.fetch(`${d.url}/auth/v1/user`, { headers: { apikey: d.anonKey, authorization: `Bearer ${m[1]}` } });
    if (!r.ok) throw new ActorError(401, "Session expired or invalid. Sign in again.");
    sub = (await r.json())?.id;
  } catch (e) {
    if (e instanceof ActorError) throw e;
    throw new ActorError(503, "Sign-in service unavailable");
  }
  if (!sub) throw new ActorError(401, "Session expired or invalid. Sign in again.");
  const H = { apikey: d.serviceKey, authorization: `Bearer ${d.serviceKey}` };
  let r: Response;
  try { r = await d.fetch(`${d.url}/rest/v1/users?auth_user_id=eq.${encodeURIComponent(sub)}&select=${COLS}`, { headers: H }); }
  catch { throw new ActorError(503, "Account lookup failed"); }
  if (!r.ok) throw new ActorError(503, "Account lookup failed");
  const u = (await r.json())[0] as ActorRow | undefined;
  if (!u || u.is_active === false) throw new ActorError(403, "No active CRM account for this sign-in");
  return u;
}

// The real dependencies inside an Edge Function.
export function actorDepsFromEnv(env: (k: string) => string | undefined): ActorDeps {
  return {
    url: env("SUPABASE_URL") ?? "",
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    anonKey: env("SUPABASE_ANON_KEY") ?? "",
    fetch: (u, i) => fetch(u, i),
  };
}
