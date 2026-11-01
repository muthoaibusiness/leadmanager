// The one permission source. src/lib/constants.js re-exports these for the
// browser; the Edge Functions import them to check the verified caller. Plain
// JS with no imports, so Vite, Node and Deno all load the same file.
// Rows here are users-table rows (snake_case), or the browser's camelCase user.

const ALL_ROLES = ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT'];
export const NAV_SCOPES = {
  dashboard: ALL_ROLES,
  leads: ALL_ROLES,
  add_customer: ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD'],
  // WhatsApp chat is never granted by role — access comes from the allow-list in
  // wa_settings (or an explicit allowedFeatures grant). See waCanChat() in wa.js.
  conversations: [],
  calendar: ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT'],
  meeting: ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD'],
  pipeline: ALL_ROLES,
  properties: ALL_ROLES,
  // Management's Reports charts now live on their Home dashboard — the
  // standalone page is Team Lead only.
  reports: ['TEAM_LEAD'],
  agentperf: ['MANAGEMENT', 'TEAM_LEAD'],
  // Reports page listed right after Performance (blank for now). Not the
  // Team Lead's older `reports` analytics page above.
  perfreports: ['MANAGEMENT', 'TEAM_LEAD'],
  // The running ad campaign (Citizen Avenue) across both WhatsApp numbers.
  campaign: ['MANAGEMENT'],
  requests: ['MANAGEMENT'],
  inventory: ['MANAGEMENT'],
  team: ['TEAM_LEAD'],
  // The old separate Users tab is merged into Accounts (one roster page).
  accounts: ['MANAGEMENT'],
  relay: ['MANAGEMENT'],
  aitrainer: ['MANAGEMENT'],
  // Meta CAPI lead-event delivery and recovery. The meta-capi Edge Function
  // checks the same rule (role, or a saved 'metacapi' grant) on every call.
  metacapi: ['MANAGEMENT', 'MASTER'],
  companies: ['MASTER'],   // master-admin company-wise overview
  profile: [...ALL_ROLES, 'MASTER'],
};

// Features an admin can grant/revoke per user, in display order (nav features only;
// 'companies' is master-only overview and 'profile' is always-on, so both excluded).
// 'finance_approve' is not a page. The key is kept as it was saved on accounts;
// since budget approval was turned off it is shown as "Manage all budgets":
// an Inventory user holding it can edit, archive and restore budgets other
// people created (without it, only their own) and add corrections to finance
// history. Checked again server-side by the finance Edge Function, which reads
// the same allowed_features column.
export const FEATURE_KEYS = ['dashboard', 'leads', 'add_customer', 'conversations', 'calendar', 'meeting', 'pipeline', 'properties', 'reports', 'agentperf', 'perfreports', 'campaign', 'requests', 'inventory', 'finance_approve', 'team', 'accounts', 'relay', 'aitrainer', 'metacapi', 'self_forward'];

// Default features for a standard role (from NAV_SCOPES). Executive resolves to none.
export const defaultFeatures = (role) => FEATURE_KEYS.filter(k => (NAV_SCOPES[k] || []).includes(role));

const featuresOf = (u) => {
  const f = u.allowed_features !== undefined ? u.allowed_features : u.allowedFeatures;
  return Array.isArray(f) ? f : null;
};

// A saved feature list fully decides; otherwise the role's NAV_SCOPES entry does.
// Profile is always available. Inactive accounts get nothing.
export function hasFeature(u, key) {
  if (!u || (u.is_active ?? u.isActive) === false) return false;
  if (key === 'profile') return true;
  // MANAGEMENT is the admin role: Users & Accounts can never be switched off
  // for it by a saved feature list, so an admin cannot lock itself out.
  if (key === 'accounts' && u.role === 'MANAGEMENT') return true;
  const af = featuresOf(u);
  if (af) {
    // A grant saved before Users merged into Accounts still opens the merged page.
    if (key === 'accounts' && af.includes('users')) return true;
    return af.includes(key);
  }
  return (NAV_SCOPES[key] || []).includes(u.role);
}

const companyOf = (u) => (u.company_id !== undefined ? u.company_id : u.companyId) ?? null;

// Who may change another account: Master anywhere; anyone holding the Users &
// Accounts feature inside their own company, and only for accounts whose role
// they could themselves assign. Without that last check a delegated grant
// (say, an Agent with 'accounts') could reset a Management password and sign
// in as Management. Master accounts are Master-only.
export function canManageUser(actor, target) {
  if (!actor || !target || (actor.is_active ?? actor.isActive) === false) return false;
  if (actor.role === 'MASTER') return true;
  if (target.role === 'MASTER') return false;
  if (!hasFeature(actor, 'accounts')) return false;
  if (!assignableRoles(actor).includes(target.role)) return false;
  const co = companyOf(actor);
  return !!co && co === companyOf(target);
}

// Features an account manager may grant: Management and Master any; a
// delegated manager only features it holds itself, and never 'accounts'
// (which would let it re-delegate account management).
export function grantableFeatures(actor) {
  if (actor && (actor.role === 'MASTER' || actor.role === 'MANAGEMENT')) return FEATURE_KEYS;
  return FEATURE_KEYS.filter((k) => k !== 'accounts' && hasFeature(actor, k));
}

// Roles an account manager may hand out. Only Management and Master create
// Team Leads and Management; a delegated accounts grant stops below that.
export function assignableRoles(actor) {
  if (actor && (actor.role === 'MASTER' || actor.role === 'MANAGEMENT')) return ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT', 'EXECUTIVE'];
  return ['AGENT', 'MEETING_AGENT', 'EXECUTIVE'];
}
