// node --test — access-admin (access-admin-core.ts): who may change which
// account, with an in-memory users table and a scripted GoTrue admin API.
// The actor always comes from verifiedActor; tests hand it in directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAccessAdmin, type AdminDeps } from "./access-admin-core.ts";

function world() {
  const users: any[] = [
    { id: "mgr", auth_user_id: "a-mgr", name: "M", email: "m@x.co", role: "MANAGEMENT", is_active: true, company_id: "c1", team_id: null, allowed_features: null },
    { id: "agent", auth_user_id: "a-agent", name: "A", email: "a@x.co", role: "AGENT", is_active: true, company_id: "c1", team_id: "t1", allowed_features: null },
    { id: "other", auth_user_id: "a-other", name: "O", email: "o@y.co", role: "AGENT", is_active: true, company_id: "c2", team_id: null, allowed_features: null },
    { id: "delegate", auth_user_id: "a-del", name: "D", email: "d@x.co", role: "AGENT", is_active: true, company_id: "c1", team_id: null, allowed_features: ["accounts"] },
    { id: "master", auth_user_id: "a-master", name: "Ms", email: "ms@x.co", role: "MASTER", is_active: true, company_id: null, team_id: null, allowed_features: null },
  ];
  const auth: any[] = [];
  const teams: any[] = [];
  const audit: any[] = [];
  const signedOut: string[] = [];
  const deps: AdminDeps = {
    async user(id) { return users.find((u) => u.id === id) ?? null; },
    async userByEmail(email) { return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null; },
    async patchUser(id, patch) { const u = users.find((x) => x.id === id); if (!u) return null; Object.assign(u, patch); return { ...u }; },
    async insertUser(row) { users.push({ ...row }); return { ...row }; },
    async deleteUser(id) { const i = users.findIndex((u) => u.id === id); if (i < 0) return false; users.splice(i, 1); return true; },
    async authCreate(email, password) { if (auth.some((a) => a.email === email)) return { error: "exists" }; const a = { id: "auth-" + email, email, password }; auth.push(a); return { id: a.id }; },
    async authDelete(id) { const i = auth.findIndex((a) => a.id === id); if (i >= 0) auth.splice(i, 1); return true; },
    async authSetPassword(id, password) { const a = auth.find((x) => x.id === id); if (a) a.password = password; return !!a; },
    async authSignOut(id) { signedOut.push(id); return true; },
    async audit(row) { audit.push(row); },
    async insertTeam(row) { teams.push({ ...row }); return { ...row }; },
    async deleteTeam(id) { const i = teams.findIndex((t) => t.id === id); if (i >= 0) teams.splice(i, 1); return true; },
    async activeManagers(co) { return users.filter((u) => u.role === "MANAGEMENT" && u.is_active !== false && u.company_id === co).length; },
    newId: () => "u-new",
  };
  return { users, auth, audit, signedOut, teams, deps };
}
const actor = (w: any, id: string) => w.users.find((u: any) => u.id === id);
const call = (w: any, who: string, action: string, payload: any = {}) => handleAccessAdmin(actor(w, who), { action, ...payload }, w.deps);

test("Management saves a feature list; the response is the row as stored", async () => {
  const w = world();
  const r = await call(w, "mgr", "features.set", { userId: "agent", features: ["leads", "calendar"] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.user.allowed_features, ["leads", "calendar"]);
  assert.deepEqual(w.users.find((u) => u.id === "agent").allowed_features, ["leads", "calendar"]);
  assert.equal(w.audit.at(-1).action, "features.set");
  assert.equal(w.audit.at(-1).actor_id, "mgr");
});

test("null restores role defaults; [] is a real 'nothing' setting; unknown keys are refused", async () => {
  const w = world();
  assert.equal((await call(w, "mgr", "features.set", { userId: "agent", features: null })).body.user.allowed_features, null);
  assert.deepEqual((await call(w, "mgr", "features.set", { userId: "agent", features: [] })).body.user.allowed_features, []);
  assert.equal((await call(w, "mgr", "features.set", { userId: "agent", features: ["leads", "rootshell"] })).status, 400);
});

test("ni_only is a marker the feature editor cannot drop by accident", async () => {
  const w = world();
  w.users.find((u) => u.id === "agent").allowed_features = ["leads", "ni_only"];
  const r = await call(w, "mgr", "features.set", { userId: "agent", features: ["leads"] });
  assert.deepEqual(r.body.user.allowed_features, ["leads", "ni_only"]);
});

test("an agent, another company's manager, or a missing account gets 403/404", async () => {
  const w = world();
  assert.equal((await call(w, "agent", "features.set", { userId: "agent", features: ["accounts"] })).status, 403, "no self-grant");
  assert.equal((await call(w, "mgr", "features.set", { userId: "other", features: [] })).status, 403, "cross-tenant");
  assert.equal((await call(w, "mgr", "features.set", { userId: "nope", features: [] })).status, 404);
  assert.equal((await call(w, "mgr", "features.set", { userId: "master", features: [] })).status, 403, "Master is Master-only");
});

test("role: Management may promote; a delegated accounts grant may not hand out TL/Management", async () => {
  const w = world();
  assert.equal((await call(w, "delegate", "role.set", { userId: "agent", role: "MANAGEMENT" })).status, 403);
  assert.equal((await call(w, "delegate", "role.set", { userId: "agent", role: "EXECUTIVE" })).status, 200);
  assert.equal((await call(w, "mgr", "role.set", { userId: "agent", role: "TEAM_LEAD" })).status, 200);
  // ...and once the account is a Team Lead, the delegate cannot demote it either.
  assert.equal((await call(w, "delegate", "role.set", { userId: "agent", role: "AGENT" })).status, 403);
  assert.equal((await call(w, "mgr", "role.set", { userId: "agent", role: "MASTER" })).status, 403);
  assert.equal((await call(w, "mgr", "role.set", { userId: "agent", role: "WIZARD" })).status, 400);
});

test("nobody changes their own role, access or status, or deletes themselves", async () => {
  const w = world();
  for (const [a, p] of [["role.set", { role: "AGENT" }], ["features.set", { features: [] }], ["active.set", { active: false }], ["delete", {}]] as const) {
    assert.equal((await call(w, "mgr", a, { userId: "mgr", ...p })).status, 409, a);
  }
});

test("deactivating ends the account's sessions; reactivating does not", async () => {
  const w = world();
  assert.equal((await call(w, "mgr", "active.set", { userId: "agent", active: false })).body.user.is_active, false);
  assert.deepEqual(w.signedOut, ["a-agent"]);
  await call(w, "mgr", "active.set", { userId: "agent", active: true });
  assert.deepEqual(w.signedOut, ["a-agent"]);
});

test("create makes the sign-in and the CRM row together, in the actor's company; no password is stored in users", async () => {
  const w = world();
  const r = await call(w, "mgr", "create", { name: "New", email: "New@X.co", role: "AGENT", password: "s3cret-pass", phone: "" });
  assert.equal(r.status, 200);
  const row = w.users.find((u) => u.id === "u-new");
  assert.equal(row.company_id, "c1");
  assert.equal(row.auth_user_id, "auth-new@x.co");
  assert.ok(!("password" in row), "users.password is not written");
  assert.equal(w.auth[0].email, "new@x.co");
  assert.ok(!JSON.stringify(w.audit).includes("s3cret-pass"), "the password never reaches the audit log");
});

test("create refuses weak passwords, duplicate emails and roles above the actor", async () => {
  const w = world();
  assert.equal((await call(w, "mgr", "create", { name: "N", email: "n@x.co", role: "AGENT", password: "1234" })).status, 400);
  assert.equal((await call(w, "mgr", "create", { name: "N", email: "A@x.co", role: "AGENT", password: "long-enough-1" })).status, 409);
  assert.equal((await call(w, "delegate", "create", { name: "N", email: "n@x.co", role: "MANAGEMENT", password: "long-enough-1" })).status, 403);
});

test("delete removes the CRM row and its sign-in", async () => {
  const w = world();
  w.auth.push({ id: "a-agent", email: "a@x.co" });
  assert.equal((await call(w, "mgr", "delete", { userId: "agent" })).status, 200);
  assert.ok(!w.users.some((u) => u.id === "agent"));
  assert.ok(!w.auth.some((a) => a.id === "a-agent"));
});

test("password.reset sets a new password and signs the account out everywhere", async () => {
  const w = world();
  w.auth.push({ id: "a-agent", email: "a@x.co", password: "old" });
  assert.equal((await call(w, "mgr", "password.reset", { userId: "agent", password: "short" })).status, 400);
  assert.equal((await call(w, "mgr", "password.reset", { userId: "agent", password: "brand-new-pass-9" })).status, 200);
  assert.equal(w.auth[0].password, "brand-new-pass-9");
  assert.deepEqual(w.signedOut, ["a-agent"]);
});

test("projects: 'ALL', a list of ids, or []; a Team Lead may set them for its own team's agents", async () => {
  const w = world();
  w.users.push({ id: "tl", auth_user_id: "a-tl", name: "T", email: "t@x.co", role: "TEAM_LEAD", is_active: true, company_id: "c1", team_id: "t1", allowed_features: null });
  assert.deepEqual((await call(w, "mgr", "projects.set", { userId: "agent", projects: "ALL" })).body.user.projects, "ALL");
  assert.deepEqual((await call(w, "tl", "projects.set", { userId: "agent", projects: ["p1"] })).body.user.projects, ["p1"]);
  assert.equal((await call(w, "tl", "projects.set", { userId: "delegate", projects: [] })).status, 403, "not in the Team Lead's team");
  assert.equal((await call(w, "mgr", "projects.set", { userId: "agent", projects: [1, 2] })).status, 400);
});

test("profile.set: name and phone of another account, same rule as projects; nothing else rides along", async () => {
  const w = world();
  w.users.push({ id: "tl", auth_user_id: "a-tl", name: "T", email: "t@x.co", role: "TEAM_LEAD", is_active: true, company_id: "c1", team_id: "t1", allowed_features: null });
  const r = await call(w, "tl", "profile.set", { userId: "agent", name: "Renamed", phone: "+880", role: "MANAGEMENT", allowed_features: ["accounts"] });
  assert.equal(r.status, 200);
  const a = w.users.find((u) => u.id === "agent");
  assert.equal(a.name, "Renamed"); assert.equal(a.phone, "+880");
  assert.equal(a.role, "AGENT"); assert.equal(a.allowed_features, null);
  assert.equal((await call(w, "tl", "profile.set", { userId: "delegate", name: "x" })).status, 403);
  assert.equal((await call(w, "mgr", "profile.set", { userId: "agent", name: "  " })).status, 400);
});

test("creating a Team Lead also creates its team, led by it", async () => {
  const w = world();
  const r = await call(w, "mgr", "create", { name: "Tara", email: "tara@x.co", role: "TEAM_LEAD", password: "long-enough-1" });
  assert.equal(r.status, 200);
  const team = w.teams.at(-1);
  assert.equal(team.lead_id, "u-new"); assert.equal(team.company_id, "c1"); assert.equal(team.name, "Tara's Team");
  assert.equal(w.users.find((u) => u.id === "u-new").team_id, team.id);
});

test("a Team Lead creates Agents, Meeting Agents and Executives in its own team only", async () => {
  const w = world();
  w.users.push({ id: "tl", auth_user_id: "a-tl", name: "T", email: "t@x.co", role: "TEAM_LEAD", is_active: true, company_id: "c1", team_id: "t1", allowed_features: null });
  const r = await call(w, "tl", "create", { name: "Ag", email: "ag@x.co", role: "AGENT", password: "long-enough-1", teamId: "t9" });
  assert.equal(r.status, 200);
  const row = w.users.find((u) => u.id === "u-new");
  assert.equal(row.team_id, "t1", "a caller-picked team is ignored for a Team Lead");
  assert.equal(row.company_id, "c1");
  assert.equal((await call(w, "tl", "create", { name: "M", email: "m2@x.co", role: "MANAGEMENT", password: "long-enough-1" })).status, 403);
});

test("Master creates a company's first Management account in that company", async () => {
  const w = world();
  const r = await call(w, "master", "create", { name: "Boss", email: "boss@z.co", role: "MANAGEMENT", password: "long-enough-1", companyId: "c9" });
  assert.equal(r.status, 200);
  assert.equal(w.users.find((u) => u.id === "u-new").company_id, "c9");
  assert.equal((await call(w, "mgr", "create", { name: "X", email: "x9@z.co", role: "AGENT", password: "long-enough-1", companyId: "c9" })).body.user.company_id, "c1", "only Master picks the company");
});

test("the last active Management account of a company cannot be demoted, deactivated or deleted", async () => {
  const w = world();
  w.users.push({ id: "mgr2", auth_user_id: "a-mgr2", name: "M2", email: "m2@x.co", role: "MANAGEMENT", is_active: true, company_id: "c1", team_id: null, allowed_features: null });
  // Two active managers: one may be removed by the other.
  assert.equal((await call(w, "mgr2", "active.set", { userId: "mgr", active: false })).status, 200);
  // Now mgr2 is the last one; mgr (inactive) cannot be left as the only path back,
  // and nobody may take mgr2 away. Master is the only other actor that could try.
  for (const [a, p] of [["role.set", { role: "AGENT" }], ["active.set", { active: false }], ["delete", {}]] as const) {
    assert.equal((await call(w, "master", a, { userId: "mgr2", ...p })).status, 409, a);
  }
});

test("a Management account with a saved feature list still administers accounts", async () => {
  const w = world();
  w.users.find((u) => u.id === "mgr").allowed_features = ["leads"];
  assert.equal((await call(w, "mgr", "create", { name: "New Boss", email: "nb@x.co", role: "MANAGEMENT", password: "long-enough-1" })).status, 200);
  assert.equal((await call(w, "mgr", "features.set", { userId: "agent", features: [] })).status, 200);
});

test("a delegated accounts grant cannot touch Management or Team Lead accounts in any way", async () => {
  const w = world();
  w.users.push({ id: "tl", auth_user_id: "a-tl", name: "T", email: "t@x.co", role: "TEAM_LEAD", is_active: true, company_id: "c1", team_id: "t1", allowed_features: null });
  w.auth.push({ id: "a-mgr", email: "m@x.co", password: "orig" });
  for (const victim of ["mgr", "tl"]) {
    assert.equal((await call(w, "delegate", "password.reset", { userId: victim, password: "takeover-pass-123" })).status, 403, `password.reset ${victim}`);
    assert.equal((await call(w, "delegate", "active.set", { userId: victim, active: false })).status, 403, `active.set ${victim}`);
    assert.equal((await call(w, "delegate", "delete", { userId: victim })).status, 403, `delete ${victim}`);
    assert.equal((await call(w, "delegate", "features.set", { userId: victim, features: [] })).status, 403, `features.set ${victim}`);
  }
  assert.equal(w.auth.find((a) => a.id === "a-mgr").password, "orig", "Management password unchanged");
  assert.deepEqual(w.signedOut, [], "nobody signed out");
  assert.ok(w.users.some((u) => u.id === "mgr") && w.users.some((u) => u.id === "tl"));
  // It can still manage the front-line accounts it was delegated.
  assert.equal((await call(w, "delegate", "active.set", { userId: "agent", active: false })).status, 200);
});

test("a delegated accounts grant cannot hand out features it does not hold", async () => {
  const w = world();
  for (const f of [["accounts"], ["aitrainer"], ["inventory"], ["metacapi"], ["leads", "relay"]]) {
    assert.equal((await call(w, "delegate", "features.set", { userId: "agent", features: f })).status, 403, f.join(","));
  }
  // Features the delegate itself holds are fine ("accounts" is its own, but granting it would re-delegate).
  w.users.find((u) => u.id === "delegate").allowed_features = ["accounts", "leads", "calendar"];
  assert.equal((await call(w, "delegate", "features.set", { userId: "agent", features: ["leads", "calendar"] })).status, 200);
  // Management may hand out anything.
  assert.equal((await call(w, "mgr", "features.set", { userId: "agent", features: ["aitrainer", "accounts"] })).status, 200);
});

test("defect 8: a Team Lead create whose user insert fails leaves no team and no sign-in behind", async () => {
  const w = world();
  w.deps.insertUser = async () => { throw new Error("insert failed"); };
  const r = await call(w, "mgr", "create", { name: "Tara", email: "tara@x.co", role: "TEAM_LEAD", password: "long-enough-1" });
  assert.equal(r.status, 502);
  assert.deepEqual(w.teams, [], "no orphan team");
  assert.deepEqual(w.auth, [], "no orphan sign-in");
});

test("active.set needs a real boolean: a missing or string `active` changes nothing", async () => {
  const w = world();
  for (const active of [undefined, "true", "false", 1, null]) {
    const r = await call(w, "mgr", "active.set", { userId: "agent", active });
    assert.equal(r.status, 400, String(active));
  }
  assert.equal(w.users.find((u: any) => u.id === "agent").is_active, true);
  assert.deepEqual(w.signedOut, []);
});

test("a failed session revoke is reported, not swallowed", async () => {
  const w = world();
  w.deps.authSignOut = async () => false;
  w.auth.push({ id: "a-agent", email: "a@x.co", password: "old" });
  const d = await call(w, "mgr", "active.set", { userId: "agent", active: false });
  assert.equal(d.status, 502, "deactivate");
  assert.match(d.body.error, /session/i);
  assert.equal(w.users.find((u: any) => u.id === "agent").is_active, false, "the row is still deactivated (RLS refuses it)");
  assert.equal(w.audit.at(-1)?.action, "active.set", "and audited");
  const p = await call(w, "mgr", "password.reset", { userId: "agent", password: "brand-new-pass-9" });
  assert.equal(p.status, 502, "password reset");
});

test("a failed audit write fails the request (access-admin answers 500) instead of succeeding silently", async () => {
  const w = world();
  w.deps.audit = async () => { throw new Error("access_audit insert 500"); };
  await assert.rejects(call(w, "mgr", "role.set", { userId: "agent", role: "TEAM_LEAD" }), /access_audit/);
});

test("create: a failed audit write fails the request but leaves a whole account, never a row without its sign-in", async () => {
  const w = world();
  w.deps.audit = async () => { throw new Error("access_audit insert 500"); };
  await assert.rejects(call(w, "mgr", "create", { role: "AGENT", name: "New", email: "new@x.co", password: "a-strong-pass-1" }), /access_audit/);
  const row = w.users.find((u: any) => u.email === "new@x.co");
  assert.ok(row, "the users row exists");
  assert.ok(w.auth.some((a: any) => a.id === row.auth_user_id), "and its sign-in exists");
});

test("unknown actions are 400", async () => {
  const w = world();
  assert.equal((await call(w, "mgr", "sudo", {})).status, 400);
});
