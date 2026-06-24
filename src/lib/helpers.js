import { AVC, STATUS_LABELS, SRC_LABELS } from './constants.js';

export const uid = () => 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
export const now_ = () => new Date().toISOString();

export function dAgo(n, h = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, Math.floor(Math.random() * 55));
  return d.toISOString();
}

export function inMonth(day, h = 10) {
  const d = new Date();
  d.setDate(day);
  d.setHours(h, Math.floor(Math.random() * 55));
  return d.toISOString();
}

export function fmtD(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.floor(m / 60) + 'h ago';
  return Math.floor(m / 1440) + 'd ago';
}

export function fmtBDT(n) {
  if (!n || n === 0) return 'BDT 0';
  if (n >= 10000000) return 'BDT ' + (n / 10000000).toFixed(2) + 'Cr';
  if (n >= 100000) return 'BDT ' + (n / 100000).toFixed(1) + 'L';
  return 'BDT ' + Number(n).toLocaleString('en-IN');
}

export function ini(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

export function avc(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVC[h % AVC.length];
}

export function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function progColor(pct) {
  if (pct >= 80) return '#34D399';
  if (pct >= 50) return '#F0A92B';
  return '#F87171';
}

export function actIcon(t) {
  const m = {
    CALL: 'call', MISSED_CALL: 'call_missed', SMS: 'sms', WHATSAPP: 'chat_bubble',
    VISIT: 'location_on', NOTE: 'sticky_note_2', STATUS_CHANGE: 'swap_horiz',
    FORWARDED: 'forward_to_inbox', CREATED: 'person_add', DEAL: 'handshake', OFFER: 'price_check',
    FOLLOW_UP: 'alarm', LOST_REASON: 'sentiment_dissatisfied', CART: 'shopping_cart', BOOKING: 'event_seat',
  };
  return m[t] || 'radio_button_checked';
}

export function actClr(t) {
  const m = {
    CALL: '#C8FF00', MISSED_CALL: '#F87171', SMS: '#C8FF00', WHATSAPP: '#C8FF00',
    VISIT: '#34D399', NOTE: '#9CA3AF', STATUS_CHANGE: '#9CA3AF',
    FORWARDED: '#C8FF00', CREATED: '#C8FF00', DEAL: '#34D399', OFFER: '#DDB948',
    FOLLOW_UP: '#F0A92B', LOST_REASON: '#F87171', CART: '#C8FF00', BOOKING: '#2DD4BF',
  };
  return m[t] || '#9CA3AF';
}

export function daysLeftInMonth() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate() - n.getDate();
}

export function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function curMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0');
}

export function rlabel(r) {
  const m = {
    INITIAL_AGENT: 'Initial Agent',
    MEETING_AGENT: 'Meeting Agent',
    TEAM_LEAD: 'Team Lead',
    MANAGEMENT: 'Management',
    MASTER: 'Master Admin',
  };
  return m[r] || r;
}

export function slabel(s) { return STATUS_LABELS[s] || s; }
export function sclass(s) { return 's-' + (s || '').toLowerCase(); }

// Display badge for a lead — overlays a "Follow-up" state when one is scheduled
// on an early-stage lead, without touching the real workflow status.
const FU_OVERLAY = ['NEW', 'CONTACTED', 'INTERESTED'];
export function leadDisplayStatus(lead) {
  if (lead.nextFollowup && FU_OVERLAY.includes(lead.status)) {
    return { label: 'Follow-up', cls: 's-follow_up' };
  }
  return { label: STATUS_LABELS[lead.status] || lead.status, cls: 's-' + (lead.status || '').toLowerCase() };
}
export function srclabel(s) { return SRC_LABELS[s] || s; }
export function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }

export function scoreLead(lead, acts) {
  if (!lead) return 0;
  let score = 0;
  // Status progression (0–45)
  const statusPts = { NEW: 5, CONTACTED: 12, INTERESTED: 22, MEETING_SET: 32, SITE_VISIT_SCHEDULED: 38, SITE_VISIT_DONE: 45, NEGOTIATING: 45 };
  score += statusPts[lead.status] || 0;
  // Budget (0–12)
  if (lead.budget >= 10000000) score += 12;
  else if (lead.budget >= 5000000) score += 8;
  else if (lead.budget >= 1000000) score += 5;
  else if (lead.budget > 0) score += 2;
  // Call activity (0–10)
  score += Math.min(lead.callCount || 0, 5) * 2;
  // Visit done (+8)
  if (lead.visitCount > 0) score += 8;
  // Has property interest (+5)
  if (lead.propertyInterest) score += 5;
  // Priority (+6/+3)
  if ((lead.priority || '').toLowerCase().includes('high')) score += 6;
  else if ((lead.priority || '').toLowerCase().includes('med')) score += 3;
  // Follow-up set (+4)
  if (lead.nextFollowup) score += 4;
  // Recent activity within 5 days (+6)
  const lastAct = (acts || []).reduce((latest, a) => !latest || new Date(a.timestamp) > new Date(latest.timestamp) ? a : latest, null);
  if (lastAct && (Date.now() - new Date(lastAct.timestamp)) < 5 * 86400000) score += 6;
  // Has email (+2)
  if (lead.email) score += 2;
  // Lost/not interested = 0
  if (['DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(lead.status)) return 0;

  return Math.min(Math.round(score), 99);
}

export function scoreLabel(s) {
  if (s >= 75) return { label: 'Hot', color: '#F87171', bg: 'rgba(248,113,113,.14)' };
  if (s >= 35) return { label: 'Warm', color: '#F0A92B', bg: 'rgba(240,169,43,.14)' };
  return { label: 'Cold', color: '#9CA3AF', bg: 'rgba(255,255,255,.06)' };
}
