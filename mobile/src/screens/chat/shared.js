// What the two chat screens share. The chat logic itself (loaders, send, read
// marks, the realtime socket, access rules) is src/lib/wa.js and is imported,
// not repeated. The formatters below live inside web components, which the
// phone cannot import, so they are copied here; each names its source.
import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { Avatar } from '../../ui';
import { getDB, getLead } from '../../../../src/lib/db.js';
import {
  waLoadSettings, waSeesAllChats, isLeadAssignedOrForwardedTo, matchLead,
} from '../../../../src/lib/wa.js';
import { groupByNumber } from '../../../../src/lib/waGroup.js';

// The web keeps wa_settings in its app context (App.jsx loads it once per
// account). The phone has no such slot, so each chat screen asks for it.
// null = not answered yet; { failed: true } = the request failed.
export function useWaSettings(user) {
  const [settings, setSettings] = useState(null);
  const userId = user ? user.id : null;
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    waLoadSettings().then((s) => { if (alive) setSettings(s); }, () => { if (alive) setSettings({ failed: true }); });
    return () => { alive = false; };
  }, [userId]);
  return settings;
}

// ConversationsView.jsx `visibleConvs`: Management/Master and accounts granted
// the Conversations feature see every thread; everyone else only the chats of
// leads assigned or forwarded to them. Then one row per customer (waGroup.js).
export function visibleThreads(convs, user) {
  const leads = getDB().leads || [];
  const allowed = waSeesAllChats(user) ? convs : convs.filter((c) => {
    const l = c.leadId ? getLead(c.leadId) || matchLead(c, leads) : matchLead(c, leads);
    return isLeadAssignedOrForwardedTo(l, user);
  });
  return groupByNumber(allowed);
}

// ConversationsView.jsx `lead`: the CRM record behind a thread.
export function leadOfThread(conv) {
  if (!conv) return null;
  const leads = getDB().leads || [];
  return (conv.leadId ? getLead(conv.leadId) || matchLead(conv, leads) : matchLead(conv, leads)) || null;
}

// ConversationsView.jsx `needsAvatar`: no photo yet, or a WhatsApp link (those
// expire within days; the relay saves a stable copy instead).
export const needsAvatar = (c) => !!c.phone && (!c.avatarUrl || /whatsapp.net/.test(c.avatarUrl));

// The thread a row was opened from, handed to the chat screen so it does not
// load the list again. Only a hand-over for the next screen, not a cache: the
// chat screen falls back to the server when the id is not here.
const opened = new Map();
export const rememberThread = (c) => { opened.clear(); for (const id of c.memberIds || [c.id]) opened.set(id, c); };
export const recallThread = (id) => opened.get(id) || null;

// ChatList.jsx `fmtWhen`.
export const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 7 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

// ChatThread.jsx `dayLabel`.
export const dayLabel = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// MessageBubble.jsx `fmtTime`, `fmtSize`, `DOC_ICON`.
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '');
export const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
};
export const docIcon = (mime = '', name = '') => {
  const s = (mime + ' ' + name).toLowerCase();
  if (s.includes('pdf')) return 'picture_as_pdf';
  if (s.includes('sheet') || s.includes('excel') || s.includes('.csv')) return 'table_view';
  if (s.includes('word') || s.includes('document')) return 'description';
  if (s.includes('zip') || s.includes('rar')) return 'folder_zip';
  return 'insert_drive_file';
};

// The customer's WhatsApp photo when the thread has one, else initials.
export function ChatAvatar({ conv, size = 44 }) {
  const [broken, setBroken] = useState(false);
  if (conv.avatarUrl && !broken) {
    return <Image source={{ uri: conv.avatarUrl }} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return <Avatar name={conv.name || conv.phone} size={size} />;
}
