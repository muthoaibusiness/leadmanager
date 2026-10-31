// The real AdminDeps for access-admin: PostgREST and the GoTrue admin API with
// the service role. Deno-free: fetch is passed in, so the local integration
// test drives it against a local stack.
import type { AdminDeps } from "./access-admin-core.ts";

type Opts = { url: string; serviceKey: string; fetch: (input: string, init?: RequestInit) => Promise<Response> };
const COLS = "id,auth_user_id,name,email,phone,role,team_id,company_id,is_active,avatar,projects,allowed_features";

export function restAdminDeps(o: Opts): AdminDeps {
  const H = { apikey: o.serviceKey, Authorization: `Bearer ${o.serviceKey}`, "Content-Type": "application/json" };
  const enc = encodeURIComponent;
  const rest = (path: string, init: RequestInit = {}) => o.fetch(`${o.url}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const admin = (path: string, init: RequestInit = {}) => o.fetch(`${o.url}/auth/v1/admin/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const one = async (r: Response) => { if (!r.ok) throw new Error(`users ${r.status}`); return ((await r.json()) as any[])[0] ?? null; };
  return {
    async user(id) { return one(await rest(`users?id=eq.${enc(id)}&select=${COLS}`)); },
    async userByEmail(email) { return one(await rest(`users?email=ilike.${enc(email.replace(/[%_\\]/g, "\\$&"))}&select=${COLS}`)); },
    async patchUser(id, patch) {
      return one(await rest(`users?id=eq.${enc(id)}&select=${COLS}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) }));
    },
    async insertUser(row) {
      // users.password is NOT NULL until a later migration drops it. The
      // placeholder is not a usable credential: sign-in is Supabase Auth.
      const r = await rest(`users?select=${COLS}`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...row, password: "!auth" }) });
      if (!r.ok) throw new Error(`insert ${r.status}`);
      return (await r.json())[0];
    },
    async deleteUser(id) {
      const r = await rest(`users?id=eq.${enc(id)}&select=id`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      return r.ok && ((await r.json()) as any[]).length === 1;
    },
    async authCreate(email, password) {
      const r = await admin("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
      if (r.status === 422 || r.status === 409) return { error: "exists" };
      if (!r.ok) return { error: `auth ${r.status}` };
      return { id: (await r.json()).id };
    },
    async authDelete(id) { const r = await admin(`users/${enc(id)}`, { method: "DELETE" }); return r.ok || r.status === 404; },
    async authSetPassword(id, password) { return (await admin(`users/${enc(id)}`, { method: "PUT", body: JSON.stringify({ password }) })).ok; },
    // Ends every session of that account (crm_revoke_sessions, migration 0054):
    // no refresh succeeds, and GoTrue (so every Edge Function) refuses its
    // access tokens at once. PostgREST checks only the JWT signature until it
    // expires (1 hour by default); the users policies check is_active.
    async authSignOut(id) { return (await rest("rpc/crm_revoke_sessions", { method: "POST", body: JSON.stringify({ p_auth_user_id: id }) })).ok; },
    async activeManagers(companyId) {
      const r = await rest(`users?select=id&role=eq.MANAGEMENT&is_active=not.eq.false&company_id=${companyId === null ? "is.null" : "eq." + enc(companyId)}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
      return Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
    },
    async deleteTeam(id) {
      const r = await rest(`teams?id=eq.${enc(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return r.ok;
    },
    async insertTeam(row) {
      const r = await rest("teams", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error(`team insert ${r.status}`);
      return (await r.json())[0];
    },
    async audit(row) {
      const r = await rest("access_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error(`access_audit insert ${r.status}`);
    },
    newId: () => "u" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
  };
}
