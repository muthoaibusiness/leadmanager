// Facebook Lead Ads intake: what the admin configures (Admin > Facebook Leads) and
// the rules for it. Pure, so it is tested on its own. The tables are migration 0059:
//   fb_lead_settings   one row: on/off, the Page, new-lead status, duplicate policy
//   fb_lead_forms      one row per Facebook form: where its leads go and how
//   fb_lead_events     what the intake received (written by the intake function)
// No credential is kept here: the Page token, app secret and verify token are Edge
// Function secrets, named in SECRETS below.

// The address to paste into Meta's webhook settings.
export const webhookUrl = (supabaseUrl) => `${String(supabaseUrl || '').replace(/\/+$/, '')}/functions/v1/fb-leads`;

export const SECRETS = [
  { name: 'FB_VERIFY_TOKEN', what: 'A word you choose. Paste the same word into Meta when you add the webhook.' },
  { name: 'FB_APP_SECRET', what: "Your Facebook app's secret. The intake uses it to check a request really came from Meta." },
  { name: 'FB_PAGE_ACCESS_TOKEN', what: 'A long-lived Page access token (leads_retrieval permission). The intake uses it to read each lead.' },
];

// CRM fields a form answer can fill, in display order, and the Facebook field keys
// that usually carry them (Facebook's own names for the default question set).
export const FIELD_TARGETS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' },
  { key: 'budget', label: 'Budget' },
  { key: 'profession', label: 'Profession' },
];
export const DEFAULT_FIELD_MAP = {
  name: ['full_name', 'name'],
  phone: ['phone_number', 'phone'],
  email: ['email'],
  city: ['city'],
  budget: ['budget'],
  profession: ['job_title', 'profession'],
};

export const ASSIGN_MODES = [
  { key: 'none', label: 'Leave unassigned', hint: 'Lands in the company pool; a manager hands it out.' },
  { key: 'agent', label: 'One agent', hint: 'Every lead from this form goes to the same agent.' },
  { key: 'team', label: "A team's lead", hint: "Goes to the team lead, who forwards it." },
  { key: 'round_robin', label: 'Round robin', hint: 'Shared out in turn among the agents you pick.' },
];
export const DUPLICATE_POLICIES = [
  { key: 'note', label: 'Add to the existing lead', hint: 'The new answers are saved as a note on the lead that already has this phone.' },
  { key: 'new', label: 'Create another lead', hint: 'Every submission becomes its own lead.' },
  { key: 'skip', label: 'Ignore it', hint: 'Nothing is saved for a phone that is already a lead.' },
];
export const NEW_LEAD_STATUSES = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
];

export const emptyForm = () => ({
  id: '', form_id: '', label: '', active: true, project: '', source: 'META_ADS', status: '',
  assign_mode: 'none', assign_agent_id: '', assign_team_id: '', assign_pool: [],
  field_map: structuredClone(DEFAULT_FIELD_MAP),
});

// Facebook form ids are long digit strings; people paste them with spaces or a label.
export const cleanFormId = (v) => String(v || '').replace(/\D/g, '');
export const cleanPageId = (v) => String(v || '').replace(/\D/g, '');

// A field map accepts "full_name, name" as text and keeps lists of keys.
export const keysOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);

// Problems that stop a form from saving, in plain words; empty list = fine.
export function validateForm(f, { existingFormIds = [] } = {}) {
  const e = [];
  const fid = cleanFormId(f.form_id);
  if (fid.length < 8) e.push('Enter the Facebook form id (the long number from Meta).');
  else if (existingFormIds.includes(fid)) e.push('This form is already set up.');
  if (!String(f.label || '').trim()) e.push('Give the form a name you will recognise.');
  if (!String(f.project || '').trim()) e.push('Choose the project these leads are for.');
  for (const t of FIELD_TARGETS.filter((x) => x.required)) {
    if (!keysOf(f.field_map?.[t.key]).length) e.push(`Say which form question fills "${t.label}".`);
  }
  if (f.assign_mode === 'agent' && !f.assign_agent_id) e.push('Pick the agent who gets these leads.');
  if (f.assign_mode === 'team' && !f.assign_team_id) e.push('Pick the team.');
  if (f.assign_mode === 'round_robin' && (f.assign_pool || []).length < 2) e.push('Round robin needs at least two agents.');
  return e;
}

// DB row <-> form object. The id is made once, when the form is first saved.
export function formToRow(f, companyId, newId) {
  const map = {};
  for (const t of FIELD_TARGETS) { const k = keysOf(f.field_map?.[t.key]); if (k.length) map[t.key] = k; }
  return {
    id: f.id || newId, company_id: companyId || null, form_id: cleanFormId(f.form_id), label: String(f.label).trim(),
    active: f.active !== false, project: String(f.project).trim(), source: f.source || 'META_ADS', status: f.status || null,
    assign_mode: f.assign_mode || 'none',
    assign_agent_id: f.assign_mode === 'agent' ? f.assign_agent_id || null : null,
    assign_team_id: f.assign_mode === 'team' ? f.assign_team_id || null : null,
    assign_pool: f.assign_mode === 'round_robin' ? f.assign_pool || [] : [],
    field_map: map, updated_at: new Date().toISOString(),
  };
}
export const rowToForm = (r) => ({
  ...emptyForm(), ...r,
  status: r.status || '', assign_agent_id: r.assign_agent_id || '', assign_team_id: r.assign_team_id || '',
  assign_pool: Array.isArray(r.assign_pool) ? r.assign_pool : [],
  field_map: { ...structuredClone(DEFAULT_FIELD_MAP), ...(r.field_map || {}) },
});

// What the settings row must hold to be saved.
export function validateSettings(s) {
  const e = [];
  if (s.enabled && cleanPageId(s.page_id).length < 8) e.push('Enter the Facebook Page id before switching intake on.');
  return e;
}

// Short time-ago for the log.
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
