// One customer, one row in Conversations. WhatsApp can reach us under two ids for
// the same person: the phone JID (<number>@s.whatsapp.net) and a LID
// (<digits>@lid), and each lands in its own wa_conversations thread — so the same
// number showed twice, once under its number and once under its name. This folds
// the threads that share an account and a real phone number into a single entry.
//
// The list is only grouped for display; the stored threads are untouched, which
// keeps realtime updates and sending working per thread. A thread whose number is
// unknown (a LID that never resolved to a phone) stays on its own.

const digits = (v) => String(v || '').replace(/\D/g, '');

// A comparable phone number, or '' when the thread has no real number: a LID's own
// digits are not a phone number.
export function phoneKeyOf(c) {
  let d = digits(c.phone);
  if (String(c.id || '').endsWith('@lid') && d === digits(String(c.id).split(':')[1])) return '';
  if (d.length === 11 && d.startsWith('01')) d = '880' + d.slice(1);
  return d.length >= 8 && d.length <= 14 ? d : '';
}

const looksLikeNumber = (s) => !s || /^\+?[\d\s-]+$/.test(String(s).trim());
const time = (c) => new Date(c.lastMessageAt || 0).getTime();

export function groupByNumber(convs) {
  const groups = new Map();
  const order = [];
  for (const c of convs) {
    const pk = phoneKeyOf(c);
    const key = pk ? `${c.account}|${pk}` : `solo|${c.id}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(c);
  }
  return order.map((key) => {
    const members = groups.get(key);
    if (members.length === 1) return { ...members[0], memberIds: [members[0].id] };
    const newest = members.slice().sort((a, b) => time(b) - time(a));
    // The thread to send on and to show: the phone-JID one when there is one.
    const primary = newest.find((m) => String(m.id).endsWith('@s.whatsapp.net')) || newest[0];
    const first = (pick) => [primary, ...newest].map(pick).find(Boolean);
    const last = newest[0];
    return {
      ...primary,
      name: [primary, ...newest].map((m) => m.name).find((n) => !looksLikeNumber(n)) || primary.name,
      avatarUrl: first((m) => m.avatarUrl) || '',
      leadId: first((m) => m.leadId) || null,
      adMeta: first((m) => m.adMeta) || null,
      source: members.some((m) => m.source === 'AD') ? 'AD' : primary.source,
      unreadCount: members.reduce((s, m) => s + (m.unreadCount || 0), 0),
      lastMessageAt: last.lastMessageAt, lastMessagePreview: last.lastMessagePreview, lastMessageDir: last.lastMessageDir,
      memberIds: members.map((m) => m.id),
    };
  });
}

// Messages of several threads as one transcript, oldest first.
export const mergeThreads = (lists) =>
  lists.flat().sort((a, b) => new Date(a.waTimestamp) - new Date(b.waTimestamp) || String(a.id).localeCompare(String(b.id)));
