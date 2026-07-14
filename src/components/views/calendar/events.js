import { getLeads, getBookingByLead, bookingPaid, bookingDue } from '../../../lib/db.js';

// Shared event model for the calendar dashboard. A lead can produce two events:
// a meeting (lead.meetingAt) and a site visit (lead.meetingDate).

export const dayKey = (d) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

export const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Human id for the row — the external id when the lead came from an import/ad.
export const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());

export const eventType = (e) => (e.kind === 'visit' ? 'Site visit' : e.off ? 'Offline meeting' : 'Online meeting');

// Dot colour per event kind — matches the legend the old calendar used.
export const eventColor = (e) => (e.kind === 'visit' ? '#2DD4BF' : e.off ? 'var(--orange)' : 'var(--accent)');

// Status is DERIVED from real lead state — nothing here is mocked.
//   cancelled — the lead is dead, so the booked slot won't happen
//   confirmed — the visit is done, or the meeting was actually attended
//   pending   — scheduled, not yet happened
export function statusOf(e) {
  const l = e.lead;
  if (['DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)) return { label: 'cancelled', tone: 'bad' };
  if (e.kind === 'visit' && l.status === 'SITE_VISIT_DONE') return { label: 'confirmed', tone: 'ok' };
  if (e.kind === 'meeting' && l.meetingAttended) return { label: 'confirmed', tone: 'ok' };
  return { label: 'pending', tone: 'warn' };
}

// Payment comes from the lead's booking (bookings hold the real payments), so
// "Paid (Cash)" reflects an actual recorded payment and its method.
// A lead with no booking has nothing owed yet — that is NOT the same as unpaid,
// so it gets a neutral pill rather than being counted against the day.
export function paymentOf(e) {
  const b = getBookingByLead(e.lead.id);
  if (!b) return { label: 'No booking', tone: 'muted', unpaid: false };
  const paid = bookingPaid(b);
  const due = bookingDue(b);
  const method = (b.payments || []).length ? b.payments[b.payments.length - 1].method : '';
  if (paid > 0 && due === 0) return { label: method ? `Paid (${method})` : 'Paid', tone: 'ok', unpaid: false };
  if (paid > 0) return { label: method ? `Part paid (${method})` : 'Part paid', tone: 'warn', unpaid: true };
  return { label: 'Unpaid', tone: 'bad', unpaid: true };
}

// Every meeting/visit the current user is involved with, oldest first.
export function buildEvents(user) {
  const events = [];
  getLeads(user, { involved: true }).forEach(l => {
    if (l.meetingAt) events.push({ id: l.id + '-m', lead: l, at: l.meetingAt, kind: 'meeting', off: l.meetingType === 'OFFLINE' });
    if (l.meetingDate && ['SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE'].includes(l.status)) {
      events.push({ id: l.id + '-v', lead: l, at: l.meetingDate, kind: 'visit' });
    }
  });
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

export function groupByDay(events) {
  const map = {};
  events.forEach(e => { (map[dayKey(e.at)] ||= []).push(e); });
  return map;
}
