// access-admin: the only road to changing an account's role, feature access,
// active status, password, or to creating and deleting accounts. The actor is
// the verified caller (actor.ts); the rules are access-rules.js, the same file
// the browser shows. Deno-free: storage and GoTrue are passed in as deps.
import { FEATURE_KEYS, canManageUser, assignableRoles, grantableFeatures } from "./access-rules.js";
import type { ActorRow } from "./actor.ts";

type Row = Record<string, any>;
export type AdminDeps = {
  user(id: string): Promise<Row | null>;
  userByEmail(email: string): Promise<Row | null>;
  patchUser(id: string, patch: Row): Promise<Row | null>;
  insertUser(row: Row): Promise<Row>;
  deleteUser(id: string): Promise<boolean>;
  authCreate(email: string, password: string): Promise<{ id?: string; error?: string }>;
  authDelete(authUserId: string): Promise<boolean>;
  authSetPassword(authUserId: string, password: string): Promise<boolean>;
  authSignOut(authUserId: string): Promise<boolean>;
  audit(row: Row): Promise<void>;
  insertTeam(row: Row): Promise<Row>;
  deleteTeam(id: string): Promise<boolean>;
  activeManagers(companyId: string | null): Promise<number>;
  newId(): string;
};
type Res = { status: number; body: Row };

const ok = (body: Row = {}): Res => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: number, error: string): Res => ({ status, body: { ok: false, error } });
const ROLES = ["AGENT", "MEETING_AGENT", "TEAM_LEAD", "MANAGEMENT", "EXECUTIVE", "MASTER"];
// Not a page: the "Not Interested" handler flag. The editor never shows it,
// so it is carried over from the stored list unless the caller names it.
const MARKERS = ["ni_only"];
const MIN_PASSWORD = 10;
const PUBLIC_COLS = ["id", "name", "email", "phone", "role", "team_id", "company_id", "is_active", "avatar", "projects", "allowed_features"];
const shown = (u: Row) => Object.fromEntries(PUBLIC_COLS.map((k) => [k, u[k] ?? null]));

async function target(actor: ActorRow, deps: AdminDeps, id: unknown): Promise<Row | Res> {
  if (typeof id !== "string" || !id) return fail(400, "userId required");
  const t = await deps.user(id);
  if (!t) return fail(404, "No such account");
  if (!canManageUser(actor, t)) return fail(403, "You may not change this account");
  return t;
}
// Account managers, and a Team Lead for the agents of its own team (the
// EditAgentModal rule). Used for the fields a Team Lead may edit: name,
// phone, projects. Never for access, role or status.
async function teamOrManaged(actor: ActorRow, deps: AdminDeps, id: unknown): Promise<Row | Res> {
  if (typeof id !== "string" || !id) return fail(400, "userId required");
  const t = await deps.user(id);
  if (!t) return fail(404, "No such account");
  const ownTeam = actor.role === "TEAM_LEAD" && actor.is_active !== false && !!actor.team_id && t.team_id === actor.team_id
    && ["AGENT", "MEETING_AGENT", "EXECUTIVE"].includes(t.role) && t.company_id === actor.company_id;
  if (!canManageUser(actor, t) && !ownTeam) return fail(403, "You may not change this account");
  return t;
}
// MANAGEMENT is the company's admin. Removing, demoting or deactivating the
// last active one would leave nobody who can manage its accounts.
async function lastAdmin(deps: AdminDeps, t: Row): Promise<boolean> {
  if (t.role !== "MANAGEMENT" || t.is_active === false) return false;
  return (await deps.activeManagers(t.company_id)) <= 1;
}
const isRes = (x: unknown): x is Res => !!x && typeof (x as Res).status === "number" && "body" in (x as Res);
const self = (actor: ActorRow, t: Row) => t.id === actor.id;

async function done(deps: AdminDeps, actor: ActorRow, action: string, t: Row, before: Row, after: Row | null) {
  await deps.audit({ action, actor_id: actor.id, target_id: t.id, company_id: t.company_id ?? null, before, after });
}

export async function handleAccessAdmin(actor: ActorRow, body: Row, deps: AdminDeps): Promise<Res> {
  const action = String(body?.action || "");
  switch (action) {
    case "features.set": {
      const t = await target(actor, deps, body.userId); if (isRes(t)) return t;
      if (self(actor, t)) return fail(409, "You cannot change your own access");
      const f = body.features;
      if (f !== null && !(Array.isArray(f) && f.every((k) => typeof k === "string" && (FEATURE_KEYS.includes(k) || MARKERS.includes(k))))) {
        return fail(400, "features must be null or a list of known feature keys");
      }
      let next: string[] | null = f === null ? null : [...new Set(f as string[])];
      const allowed = grantableFeatures(actor);
      if (next && next.some((k) => FEATURE_KEYS.includes(k) && !allowed.includes(k))) return fail(403, "You may not grant a feature you do not hold");
      const kept = (Array.isArray(t.allowed_features) ? t.allowed_features : []).filter((k: string) => MARKERS.includes(k));
      if (next && kept.length) next = [...new Set([...next, ...kept])];
      const after = await deps.patchUser(t.id, { allowed_features: next });
      if (!after) return fail(409, "The account changed or was removed. Reload and try again.");
      await done(deps, actor, action, t, { allowed_features: t.allowed_features ?? null }, { allowed_features: after.allowed_features ?? null });
      return ok({ user: shown(after) });
    }
    case "role.set": {
      const t = await target(actor, deps, body.userId); if (isRes(t)) return t;
      if (self(actor, t)) return fail(409, "You cannot change your own role");
      const role = String(body.role || "");
      if (!ROLES.includes(role)) return fail(400, "Unknown role");
      if (!assignableRoles(actor).includes(role)) return fail(403, "You may not assign that role");
      if (!assignableRoles(actor).includes(t.role)) return fail(403, "You may not change this account's role");
      if (role !== "MANAGEMENT" && await lastAdmin(deps, t)) return fail(409, "This is the company's last Management account");
      const after = await deps.patchUser(t.id, { role });
      if (!after) return fail(409, "The account changed or was removed. Reload and try again.");
      await done(deps, actor, action, t, { role: t.role }, { role });
      return ok({ user: shown(after) });
    }
    case "profile.set": {
      // Another account's name and phone (EditAgentModal). Own profile edits go
      // straight to PostgREST under the users_update_self policy instead.
      const t = await teamOrManaged(actor, deps, body.userId); if (isRes(t)) return t;
      const patch: Row = {};
      if ("name" in body) { const n = String(body.name ?? "").trim(); if (!n) return fail(400, "Name required"); patch.name = n.slice(0, 120); }
      if ("phone" in body) patch.phone = String(body.phone ?? "").trim().slice(0, 40);
      if (!Object.keys(patch).length) return ok({ user: shown(t) });
      const after = await deps.patchUser(t.id, patch);
      if (!after) return fail(409, "The account changed or was removed. Reload and try again.");
      await done(deps, actor, action, t, { name: t.name, phone: t.phone ?? "" }, patch);
      return ok({ user: shown(after) });
    }
    case "projects.set": {
      // Which projects an agent deals on.
      const t = await teamOrManaged(actor, deps, body.userId); if (isRes(t)) return t;
      const p = body.projects;
      if (!(p === "ALL" || (Array.isArray(p) && p.every((x) => typeof x === "string")))) return fail(400, "projects must be 'ALL' or a list of project ids");
      const after = await deps.patchUser(t.id, { projects: p });
      if (!after) return fail(409, "The account changed or was removed. Reload and try again.");
      await done(deps, actor, action, t, { projects: t.projects ?? null }, { projects: p });
      return ok({ user: shown(after) });
    }
    case "active.set": {
      const t = await target(actor, deps, body.userId); if (isRes(t)) return t;
      if (self(actor, t)) return fail(409, "You cannot deactivate yourself");
      if (typeof body.active !== "boolean") return fail(400, "active must be true or false");
      const active = body.active;
      if (!active && await lastAdmin(deps, t)) return fail(409, "This is the company's last Management account");
      const after = await deps.patchUser(t.id, { is_active: active });
      if (!after) return fail(409, "The account changed or was removed. Reload and try again.");
      const revoked = active || !t.auth_user_id || await deps.authSignOut(t.auth_user_id);
      await done(deps, actor, action, t, { is_active: t.is_active }, { is_active: active });
      // The row is deactivated either way (RLS refuses it); only its refresh tokens may still work.
      if (!revoked) return fail(502, "Account deactivated, but its sessions could not be ended. Try again.");
      return ok({ user: shown(after) });
    }
    case "password.reset": {
      const t = await target(actor, deps, body.userId); if (isRes(t)) return t;
      const pw = String(body.password || "");
      if (pw.length < MIN_PASSWORD) return fail(400, `Password must be at least ${MIN_PASSWORD} characters`);
      if (!t.auth_user_id) return fail(409, "This account has no sign-in yet");
      if (!(await deps.authSetPassword(t.auth_user_id, pw))) return fail(502, "Could not set the password");
      const revoked = await deps.authSignOut(t.auth_user_id);
      await done(deps, actor, action, t, {}, { password: "reset" });
      if (!revoked) return fail(502, "Password changed, but older sessions could not be ended. Try again.");
      return ok();
    }
    case "create": {
      // Account managers create any role they may assign (access-rules.js); a
      // Team Lead creates front-line accounts in its own team (the Team page).
      const role = String(body.role || "");
      const tlCreate = actor.role === "TEAM_LEAD" && actor.is_active !== false && !!actor.team_id && ["AGENT", "MEETING_AGENT", "EXECUTIVE"].includes(role);
      if (!ROLES.includes(role) || (!assignableRoles(actor).includes(role) && !tlCreate)) return fail(403, "You may not create that role");
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const pw = String(body.password || "");
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, "Name and a valid email are required");
      if (pw.length < MIN_PASSWORD) return fail(400, `Password must be at least ${MIN_PASSWORD} characters`);
      const company = actor.role === "MASTER" ? (body.companyId ?? null) : actor.company_id;
      if (!company && role !== "MASTER") return fail(400, "companyId required");
      const draft = { id: deps.newId(), role, company_id: company };
      const manages = canManageUser(actor, draft);
      if (!manages && !tlCreate) return fail(403, "You may not create accounts here");
      if (await deps.userByEmail(email)) return fail(409, "Email already in use");
      const a = await deps.authCreate(email, pw);
      if (!a.id) return fail(a.error === "exists" ? 409 : 502, a.error === "exists" ? "Email already in use" : "Could not create the sign-in");
      // A Team Lead's own team for a Team Lead; the Team Lead's team for its
      // agents; otherwise the picked team (Management rows carry none).
      const teamId = role === "TEAM_LEAD" ? "t" + draft.id.slice(1)
        : !manages ? actor.team_id
        : role === "MANAGEMENT" ? null : (typeof body.teamId === "string" && body.teamId ? body.teamId : actor.team_id ?? null);
      const row = {
        ...draft, auth_user_id: a.id, name, email, phone: String(body.phone || ""), is_active: true,
        team_id: teamId, allowed_features: role === "EXECUTIVE" ? [] : null,
      };
      let teamMade = false;
      let saved: Row;
      try {
        if (role === "TEAM_LEAD") { await deps.insertTeam({ id: teamId, name: `${name}'s Team`, lead_id: draft.id, company_id: company }); teamMade = true; }
        saved = await deps.insertUser(row);
      } catch {
        // Never leave a sign-in or a team that maps to no CRM row.
        if (teamMade) await deps.deleteTeam(teamId as string).catch(() => false);
        await deps.authDelete(a.id);
        return fail(502, "Could not create the account");
      }
      // Outside the try: the account is whole by now; a failed audit fails the request, not the account.
      await done(deps, actor, action, saved, {}, shown(saved));
      return ok({ user: shown(saved) });
    }
    case "delete": {
      const t = await target(actor, deps, body.userId); if (isRes(t)) return t;
      if (self(actor, t)) return fail(409, "You cannot delete yourself");
      if (await lastAdmin(deps, t)) return fail(409, "This is the company's last Management account");
      if (!(await deps.deleteUser(t.id))) return fail(409, "The account changed or was removed. Reload and try again.");
      if (t.auth_user_id) await deps.authDelete(t.auth_user_id);
      await done(deps, actor, action, t, shown(t), null);
      return ok();
    }
    default:
      return fail(400, "Unknown action");
  }
}
