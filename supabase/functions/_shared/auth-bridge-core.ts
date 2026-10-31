// auth-bridge: sign-in for an account whose password still lives only in
// users.password (the transition before migration 0054). The password is
// checked here, with the service role, never in the browser and never sent
// back. A match links (or creates) the account's Supabase Auth user and returns
// a one-time token hash; the browser exchanges it at GoTrue /verify for a real
// session, so every later request carries a verified JWT. No password is
// changed or copied: the Auth user gets a random one nobody knows.
//
// Retired by the cutover runbook once every active account has its own Auth
// password: then signIn() stops falling back here and this function is removed.
// Deno-free: storage and GoTrue are passed in as deps.

type Row = Record<string, any>;
export type BridgeDeps = {
  // The users row by exact lower-cased email: id, email, password, is_active, auth_user_id.
  userByEmail(email: string): Promise<Row | null>;
  // Store the Auth link once. False when the row already links a different Auth user.
  link(id: string, authUserId: string): Promise<boolean>;
  // A new Auth user with a random password; "exists" when the email is taken.
  authCreate(email: string): Promise<{ id?: string; error?: string }>;
  // The existing Auth user's id for this email, or null.
  authIdByEmail(email: string): Promise<string | null>;
  // A one-time magic-link token hash for this email, or null.
  tokenHash(email: string): Promise<{ hash: string; authUserId: string } | null>;
  hasLinkColumn(): Promise<boolean>;
};
type Res = { status: number; body: Row };
const fail = (status: number, error: string): Res => ({ status, body: { ok: false, error } });
const WRONG = "Incorrect email or password.";

// Constant-time on equal lengths; unequal lengths fail without a loop.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function handleBridge(body: Row, deps: BridgeDeps): Promise<Res> {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !password || email.length > 254 || password.length > 200) return fail(400, "Enter email and password.");
  const u = await deps.userByEmail(email);
  // One answer for "no such account", "wrong password" and "placeholder row".
  if (!u || typeof u.password !== "string" || u.password.startsWith("!") || !same(u.password, password)) return fail(401, WRONG);
  if (u.is_active === false) return fail(403, "This account is deactivated.");
  const linkable = await deps.hasLinkColumn();
  let authId: string | null = linkable ? (u.auth_user_id ?? null) : null;
  if (!authId) {
    const made = await deps.authCreate(email);
    authId = made.id ?? (made.error === "exists" ? await deps.authIdByEmail(email) : null);
    if (!authId) return fail(502, "Could not prepare the sign-in. Try again.");
    if (linkable && !(await deps.link(u.id, authId))) return fail(409, "This account is linked to another sign-in. Ask an admin.");
  }
  const t = await deps.tokenHash(email);
  // The token must belong to the account's own Auth user, never another one.
  if (!t || t.authUserId !== authId) return fail(502, "Could not prepare the sign-in. Try again.");
  return { status: 200, body: { ok: true, token_hash: t.hash, type: "magiclink" } };
}
