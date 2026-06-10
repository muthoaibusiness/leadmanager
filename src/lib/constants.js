export const ROLES = {
  IA: 'INITIAL_AGENT',
  MA: 'MEETING_AGENT',
  TL: 'TEAM_LEAD',
  MGMT: 'MANAGEMENT',
};

// Role-scoped navigation (mirrors Muthoclo admin can(role, scope)).
const ALL_ROLES = ['INITIAL_AGENT', 'MEETING_AGENT', 'TEAM_LEAD', 'MANAGEMENT'];
export const NAV_SCOPES = {
  dashboard: ALL_ROLES,
  leads: ALL_ROLES,
  pipeline: ALL_ROLES,
  clients: ALL_ROLES,
  properties: ALL_ROLES,
  bookings: ALL_ROLES,
  reports: ['MANAGEMENT', 'TEAM_LEAD'],
  team: ['TEAM_LEAD'],
  users: ['MANAGEMENT'],
  profile: ALL_ROLES,
};
export const canSee = (role, key) => (NAV_SCOPES[key] || []).includes(role);

// Properties catalog
export const PROPERTY_TYPES = ['Apartment', 'Duplex', 'Penthouse', 'Plot', 'Commercial', 'Villa'];
export const PROPERTY_STATUS = {
  AVAILABLE: 'Available',
  FEW_LEFT: 'Few Left',
  SOLD_OUT: 'Sold Out',
  UPCOMING: 'Upcoming',
};

export const SRC_LABELS = {
  META_ADS: 'Meta',
  WHATSAPP_ADS: 'WhatsApp',
  LINKEDIN: 'LinkedIn',
  WEBSITE: 'Website',
  HOTLINE: 'Hotline',
  PERSONAL: 'Personal',
};

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
};

export const NOTIF_CLR = {
  ASSIGNED: '#2563EB',
  FORWARDED: '#2563EB',
  VISIT_SCHED: '#2563EB',
  VISIT_DONE: '#16A34A',
  DEAL_WON: '#16A34A',
  DEAL_LOST: '#DC2626',
  NEW_USER: '#2563EB',
};
