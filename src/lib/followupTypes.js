// The follow-up vocabulary. Codes are stored in lead_followups (migration 0066
// CHECK lists) and spelled out by the reminder job (0067): add or rename a code
// in all three places together. Labels and order here are free to change.

export const FU_TYPES = [
  { code: 'CALL', label: 'Phone call', icon: 'call' },
  { code: 'MESSAGE', label: 'Message', icon: 'chat' },
  { code: 'PROJECT_VISIT', label: 'Project visit', icon: 'apartment' },
  { code: 'OFFICE_VISIT', label: 'Office visit', icon: 'business' },
  { code: 'MEETING', label: 'Client meeting', icon: 'groups' },
];

export const FU_PURPOSES = [
  { code: 'BUDGET', label: 'Budget discussion', icon: 'payments' },
  { code: 'PRICE_PLAN', label: 'Price & payment plan', icon: 'request_quote' },
  { code: 'PROJECT_DETAILS', label: 'Project details', icon: 'apartment' },
  { code: 'SITE_VISIT', label: 'Site visit planning', icon: 'directions_walk' },
  { code: 'DOCUMENTS', label: 'Documents', icon: 'description' },
  { code: 'BOOKING', label: 'Booking', icon: 'event_available' },
  { code: 'OTHER', label: 'Other', icon: 'edit' },
];

export const FU_NOTES = [
  { code: 'CALL_BACK', label: 'Call back as the client asked' },
  { code: 'PRICE_PLAN', label: 'Share price and payment plan' },
  { code: 'BROCHURE', label: 'Send brochure / floor plan' },
  { code: 'CONFIRM_VISIT', label: 'Confirm site visit' },
  { code: 'DECISION', label: 'Ask for the decision' },
  { code: 'DOCUMENTS', label: 'Collect documents' },
  { code: 'OTHER', label: 'Other' },
];

// Minutes before the follow-up that the bell reminder arrives.
export const REMIND_OPTIONS = [
  { min: 0, label: 'At the time', icon: 'notifications_active' },
  { min: 5, label: '5 min before', icon: 'timer' },
  { min: 15, label: '15 min before', icon: 'timer' },
  { min: 30, label: '30 min before', icon: 'timer' },
  { min: 60, label: '1 hour before', icon: 'schedule' },
  { min: 1440, label: '1 day before', icon: 'event' },
];
export const DEFAULT_REMIND_MIN = 15;

const byCode = (list) => Object.fromEntries(list.map((x) => [x.code, x]));
const TYPE = byCode(FU_TYPES);
const PURPOSE = byCode(FU_PURPOSES);
const NOTE = byCode(FU_NOTES);

export const typeOf = (code) => TYPE[code] || TYPE.CALL;
// "Other" shows the text the agent typed; a missing purpose shows nothing.
export const purposeText = (f) => (!f?.purpose ? '' : f.purpose === 'OTHER' ? (f.purposeOther || '').trim() : PURPOSE[f.purpose]?.label || '');
export const noteText = (f) => (!f?.noteCode ? (f?.note || '').trim() : f.noteCode === 'OTHER' ? (f.note || '').trim() : NOTE[f.noteCode]?.label || '');
