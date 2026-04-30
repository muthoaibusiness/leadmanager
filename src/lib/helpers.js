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
  if (pct >= 80) return '#16A34A';
  if (pct >= 50) return '#D97706';
  return '#DC2626';
}

export function actIcon(t) {
  const m = {
    CALL: 'call', MISSED_CALL: 'call_missed', SMS: 'sms', WHATSAPP: 'chat_bubble',
    VISIT: 'location_on', NOTE: 'sticky_note_2', STATUS_CHANGE: 'swap_horiz',
    FORWARDED: 'forward_to_inbox', CREATED: 'person_add', DEAL: 'handshake', OFFER: 'price_check',
    FOLLOW_UP: 'alarm', LOST_REASON: 'sentiment_dissatisfied',
  };
  return m[t] || 'radio_button_checked';
}

export function actClr(t) {
  const m = {
    CALL: '#2563EB', MISSED_CALL: '#DC2626', SMS: '#2563EB', WHATSAPP: '#2563EB',
    VISIT: '#16A34A', NOTE: '#64748B', STATUS_CHANGE: '#64748B',
    FORWARDED: '#2563EB', CREATED: '#2563EB', DEAL: '#16A34A', OFFER: '#7C3AED',
    FOLLOW_UP: '#D97706', LOST_REASON: '#DC2626',
  };
  return m[t] || '#64748B';
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
  };
  return m[r] || r;
}

export function slabel(s) { return STATUS_LABELS[s] || s; }
export function sclass(s) { return 's-' + (s || '').toLowerCase(); }
export function srclabel(s) { return SRC_LABELS[s] || s; }
export function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }
