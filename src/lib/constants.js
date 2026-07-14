export const ROLES = {
  IA: 'INITIAL_AGENT',
  MA: 'MEETING_AGENT',
  TL: 'TEAM_LEAD',
  MGMT: 'MANAGEMENT',
  MASTER: 'MASTER',        // super-admin above Management — oversees all companies
  EXEC: 'EXECUTIVE',       // blank-canvas role — zero default access, admin grants features
};

// Role-scoped navigation (mirrors Muthoclo admin can(role, scope)).
const ALL_ROLES = ['INITIAL_AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT'];
export const NAV_SCOPES = {
  dashboard: ALL_ROLES,
  leads: ALL_ROLES,
  add_customer: ['INITIAL_AGENT', 'TEAM_LEAD'],
  calendar: ['MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT'],
  pipeline: ALL_ROLES,
  properties: ALL_ROLES,
  reports: ['MANAGEMENT', 'TEAM_LEAD'],
  agentperf: ['MANAGEMENT', 'TEAM_LEAD'],
  requests: ['MANAGEMENT'],
  carpool: ['MANAGEMENT'],
  campaigns: ['MANAGEMENT'],
  team: ['TEAM_LEAD'],
  users: ['MANAGEMENT'],
  accounts: ['MANAGEMENT'],
  companies: ['MASTER'],   // master-admin company-wise overview
  profile: [...ALL_ROLES, 'MASTER'],
};
// Access check. If an admin has saved a custom `allowedFeatures` list on the user,
// that list fully dictates access (overrides role defaults). Otherwise fall back to
// the strict role-based NAV_SCOPES. Profile is always available (logout/account).
export const canSee = (user, key) => {
  if (!user) return false;
  if (key === 'profile') return true;
  if (Array.isArray(user.allowedFeatures)) return user.allowedFeatures.includes(key);
  return (NAV_SCOPES[key] || []).includes(user.role);
};

// Features an admin can grant/revoke per user, in display order (nav features only;
// 'companies' is master-only overview and 'profile' is always-on, so both excluded).
export const FEATURE_KEYS = ['dashboard', 'leads', 'add_customer', 'calendar', 'pipeline', 'properties', 'campaigns', 'reports', 'agentperf', 'requests', 'carpool', 'team', 'users', 'accounts'];
export const FEATURE_LABELS = {
  dashboard: 'Home', leads: 'Leads', add_customer: 'Add Customer', calendar: 'Calendar', pipeline: 'Pipeline', properties: 'Projects',
  campaigns: 'Marketing', reports: 'Reports', agentperf: 'Performance', requests: 'Requests', carpool: 'Carpool', team: 'Team',
  users: 'Users', accounts: 'Accounts',
};
// Default features for a standard role (from NAV_SCOPES). Executive resolves to none.
export const defaultFeatures = (role) => FEATURE_KEYS.filter(k => (NAV_SCOPES[k] || []).includes(role));

// Properties catalog
export const PROPERTY_TYPES = ['Apartment', 'Duplex', 'Penthouse', 'Plot', 'Commercial', 'Villa'];
export const PROPERTY_STATUS = {
  AVAILABLE: 'Available',
  FEW_LEFT: 'Few Left',
  SOLD_OUT: 'Sold Out',
  UPCOMING: 'Upcoming',
};

// Marketing campaigns & ads
export const CAMPAIGN_PLATFORMS = ['Meta', 'WhatsApp', 'Google', 'YouTube', 'LinkedIn', 'TikTok', 'Billboard', 'Print', 'Event', 'Other'];
export const CAMPAIGN_STATUS = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
};
// Where an ad runs — free text is allowed, these are just the quick picks.
export const AD_SOURCE_APPS = ['Facebook', 'Instagram', 'WhatsApp', 'Messenger', 'Google', 'YouTube', 'LinkedIn', 'TikTok', 'Website', 'Other'];

export const SRC_LABELS = {
  META_ADS: 'Meta',
  WHATSAPP_ADS: 'WhatsApp',
  LINKEDIN: 'LinkedIn',
  WEBSITE: 'Website',
  HOTLINE: 'Hotline',
  PERSONAL: 'Personal',
  EVENT: 'Event',
  WALKING: 'Walking',
  TEAM_LEAD: 'Team Lead',
};

// Source options shown when adding a lead, by role.
export const SOURCE_OPTIONS_IA = ['EVENT', 'WALKING', 'PERSONAL', 'TEAM_LEAD'];
export const SOURCE_OPTIONS_DEFAULT = ['META_ADS', 'WHATSAPP_ADS', 'LINKEDIN', 'WEBSITE', 'HOTLINE', 'PERSONAL'];

export const STATUS_LABELS = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  MEETING_SET: 'Meeting Set',
  SITE_VISIT_SCHEDULED: 'Visit Scheduled',
  SITE_VISIT_DONE: 'Visit Done',
  NEGOTIATING: 'Negotiating',
  DEAL_CLOSED_WON: 'Deal Won',
  DEAL_CLOSED_LOST: 'Deal Lost',
  NOT_INTERESTED: 'Not Interested',
};

export const AVC = ['#2563EB', '#0891B2', '#7C3AED', '#D97706', '#DC2626', '#059669', '#0F172A', '#9333EA'];

export const NOTIF_ICO = {
  ASSIGNED: 'person_add',
  FORWARDED: 'forward_to_inbox',
  VISIT_SCHED: 'calendar_month',
  VISIT_DONE: 'location_on',
  DEAL_WON: 'emoji_events',
  DEAL_LOST: 'thumb_down',
  NEW_USER: 'person',
  HOLD_REQUEST: 'pan_tool',
  HOLD_APPROVED: 'check_circle',
  HOLD_REJECTED: 'cancel',
};

export const NOTIF_CLR = {
  ASSIGNED: '#2563EB',
  FORWARDED: '#2563EB',
  VISIT_SCHED: '#2563EB',
  VISIT_DONE: '#16A34A',
  DEAL_WON: '#16A34A',
  DEAL_LOST: '#DC2626',
  NEW_USER: '#2563EB',
  HOLD_REQUEST: '#F0A92B',
  HOLD_APPROVED: '#16A34A',
  HOLD_REJECTED: '#DC2626',
};
