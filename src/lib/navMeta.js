// Icon + label for every nav page, shared by the sidebar and the phone
// bottom bar (BottomNav.jsx) so both always name a page the same way.
export const NAV_META = {
  dashboard: { ico: 'home', lbl: 'Home' },
  conversations: { ico: 'forum', lbl: 'Conversations' },
  calendar: { ico: 'calendar_month', lbl: 'Calendar' },
  leads: { ico: 'person_search', lbl: 'Leads' },
  pipeline: { ico: 'view_kanban', lbl: 'Pipeline' },
  clients: { ico: 'account_circle', lbl: 'Contacts' },
  bookings: { ico: 'event_note', lbl: 'Sales Activity' },
  reports: { ico: 'bar_chart', lbl: 'Reports' },
  agentperf: { ico: 'analytics', lbl: 'Analytics' },
  perfreports: { ico: 'description', lbl: 'Reports' },
  fbleads: { ico: 'dynamic_form', lbl: 'Facebook Leads' },
  requests: { ico: 'inbox', lbl: 'Requests' },
  properties: { ico: 'folder', lbl: 'Projects' },
  booking: { ico: 'event_seat', lbl: 'Booking' },
  inventory: { ico: 'inventory_2', lbl: 'Inventory' },
  team: { ico: 'groups', lbl: 'Team' },
  accounts: { ico: 'manage_accounts', lbl: 'Users' },
  aitrainer: { ico: 'smart_toy', lbl: 'AI Trainer' },
  metacapi: { ico: 'campaign', lbl: 'Meta CAPI' },
  publicproject: { ico: 'language', lbl: 'Public Project' },
  companies: { ico: 'corporate_fare', lbl: 'Companies' },
  profile: { ico: 'account_circle', lbl: 'Profile' },
};

// Pages kept out of the menus (sidebar and phone bottom bar). They still open from a link or a button.
export const HIDDEN_NAV = ['reports', 'perfreports', 'pipeline', 'calendar', 'properties', 'inventory', 'publicproject', 'fbleads', 'metacapi'];
