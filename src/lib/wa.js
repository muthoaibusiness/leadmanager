// WhatsApp (Wasender) chat client.
//
// Mirrors the conventions in supabase.js: raw REST against PostgREST with the
// anon key, snake_case ↔ camelCase converters, and a hand-rolled realtime
// socket. Nothing here ever sees the Wasender API token — outbound sends are
// POSTed to a server-side relay (Supabase Edge Function or n8n) whose URL comes
// from wa_settings. The relay holds the credential.

import { SB_URL, SB_KEY, SB_H, sbGet, sbUpsert } from './supabase.js';
import { normalizePhone, getDB } from './db.js';

export const WA_BUCKET = 'wa-media';

// ── accounts ────────────────────────────────────────────────────────────────
// Two Wasender sessions. The Dubai team's leads go through the Dubai number;
// every other lead through Eyad's. Thread ids are <account>:<jid>.
export const WA_ACCOUNTS = ['dubai', 'eyad'];
export const WA_DEFAULT_ACCOUNT = 'eyad';
export const WA_ACCOUNT_LABEL = { dubai: 'Dubai WhatsApp', eyad: 'Eyad WhatsApp' };
// Team name (case-insensitive substring) that routes to the Dubai account.
const DUBAI_TEAM_MATCH = (import.meta.env.VITE_WA_DUBAI_TEAM || 'dubai').toLowerCase();

export const normAccount = (a) => (WA_ACCOUNTS.includes(String(a || '').toLowerCase()) ? String(a).toLowerCase() : WA_DEFAULT_ACCOUNT);
export const waConvId = (account, jid) => `${normAccount(account)}:${jid}`;
// The WhatsApp JID behind a thread id (strips the account prefix if present).
export const waConvJid = (id) => {
  const s = String(id || '');
  for (const a of WA_ACCOUNTS) if (s.startsWith(a + ':')) return s.slice(a.length + 1);
  return s;
};

const teamName = (teamId) => (getDB().teams || []).find(t => t.id === teamId)?.name || '';
const isDubaiTeam = (teamId) => !!teamId && teamName(teamId).toLowerCase().includes(DUBAI_TEAM_MATCH);

// Which number a lead should be contacted from. Team of the lead first, then
// the team of whoever it is assigned to, then that user's own name/email as a
// last resort (how the Dubai agent was recognised before teams carried it).
export function waAccountForLead(lead) {
  if (!lead) return WA_DEFAULT_ACCOUNT;
  if (isDubaiTeam(lead.teamId)) return 'dubai';
  const owner = (getDB().users || []).find(u => u.id === lead.assignedTo);
  if (owner) {
    if (isDubaiTeam(owner.teamId)) return 'dubai';
    const tag = `${owner.name || ''} ${owner.email || ''}`.toLowerCase();
    if (tag.includes(DUBAI_TEAM_MATCH)) return 'dubai';
  }
  return WA_DEFAULT_ACCOUNT;
}

// Message lifecycle, in the order WhatsApp reports it.
export const WA_STATUS = { PENDING: 'PENDING', SENT: 'SENT', DELIVERED: 'DELIVERED', READ: 'READ', FAILED: 'FAILED' };
const STATUS_RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
// Never let a late-arriving webhook drag a message backwards (e.g. a delayed
// SENT landing after DELIVERED). FAILED always wins.
export function mergeStatus(prev, next) {
  if (!prev) return next;
  if (next === 'FAILED' || prev === 'FAILED') return 'FAILED';
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[prev] ?? 0) ? next : prev;
}

// ── row converters ──────────────────────────────────────────────────────────
export function rToConv(r) {
  return {
    id: r.id, phone: r.phone, name: r.name || '', avatarUrl: r.avatar_url || '',
    leadId: r.lead_id || null, lastMessageAt: r.last_message_at, lastMessagePreview: r.last_message_preview || '',
    lastMessageDir: r.last_message_dir || 'IN', unreadCount: r.unread_count || 0,
    source: r.source || 'WHATSAPP', adMeta: r.ad_meta || null,
    assignedTo: r.assigned_to || null, companyId: r.company_id || null,
    archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
    account: normAccount(r.account), lid: r.lid || '',
  };
}

export function convToR(c) {
  return {
    id: c.id, phone: c.phone, name: c.name || '', avatar_url: c.avatarUrl || '',
    lead_id: c.leadId || null, last_message_at: c.lastMessageAt || null,
    last_message_preview: c.lastMessagePreview || '', last_message_dir: c.lastMessageDir || 'IN',
    unread_count: c.unreadCount || 0, source: c.source || 'WHATSAPP', ad_meta: c.adMeta || null,
    assigned_to: c.assignedTo || null, company_id: c.companyId || null, archived: !!c.archived,
    account: normAccount(c.account),
  };
}

export function rToMsg(r) {
  return {
    id: r.id, waId: r.wa_id || null, conversationId: r.conversation_id, phone: r.phone || '',
    direction: r.direction, type: r.type || 'text', body: r.body || '', caption: r.caption || '',
    mediaUrl: r.media_url || '', mediaMime: r.media_mime || '', mediaName: r.media_name || '',
    mediaSize: r.media_size || 0, status: r.status || 'SENT', error: r.error || '',
    senderName: r.sender_name || '', sentBy: r.sent_by || null, clientRef: r.client_ref || null,
    waTimestamp: r.wa_timestamp || r.created_at, createdAt: r.created_at,
    account: normAccount(r.account),
  };
}

export function msgToR(m) {
  return {
    id: m.id, conversation_id: m.conversationId, phone: m.phone || '',
    direction: m.direction, type: m.type || 'text', body: m.body || '', caption: m.caption || '',
    media_url: m.mediaUrl || '', media_mime: m.mediaMime || '', media_name: m.mediaName || '',
    media_size: m.mediaSize || 0, status: m.status || 'PENDING', error: m.error || '',
    sender_name: m.senderName || '', sent_by: m.sentBy || null, client_ref: m.clientRef || null,
    wa_timestamp: m.waTimestamp || new Date().toISOString(),
    account: normAccount(m.account),
  };
}

// ── settings ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  id: 'default', relayUrl: '', sessionName: '', enabled: true,
  allowedUserIds: [], tokenSet: false, webhookUrl: '', updatedAt: null, updatedBy: '',
};

export function rToSettings(r) {
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    id: r.id, relayUrl: r.relay_url || '', sessionName: r.session_name || '',
    enabled: r.enabled !== false, allowedUserIds: Array.isArray(r.allowed_user_ids) ? r.allowed_user_ids : [],
    tokenSet: !!r.token_set, webhookUrl: r.webhook_url || '',
    updatedAt: r.updated_at, updatedBy: r.updated_by || '',
  };
}

export async function waLoadSettings() {
  const rows = await sbGet('wa_settings?id=eq.default');
  return rToSettings(rows && rows[0]);
}

export async function waSaveSettings(s, user) {
  const row = {
    id: 'default', relay_url: s.relayUrl || '', session_name: s.sessionName || '',
    enabled: s.enabled !== false, allowed_user_ids: s.allowedUserIds || [],
    webhook_url: s.webhookUrl || '', updated_at: new Date().toISOString(),
    updated_by: user?.id || null,
  };
  return sbUpsert('wa_settings', [row]);
}

// Store/rotate the Wasender token. Deliberately goes through the relay, never
// into a browser-readable table — wa_secrets has RLS on with no policies, so
// only the service role behind the relay can write it.
export async function waSaveToken(settings, { account, apiToken, webhookSecret }, user) {
  if (!settings?.relayUrl) return { ok: false, error: 'Set the relay URL first.' };
  try {
    const r = await fetch(settings.relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-credentials', account: normAccount(account), apiToken, webhookSecret, userId: user?.id }),
    });
    if (!r.ok) return { ok: false, error: `Relay returned HTTP ${r.status}` };
    await sbUpsert('wa_settings', [{ id: 'default', token_set: true, updated_at: new Date().toISOString(), updated_by: user?.id || null }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Could not reach the relay.' };
  }
}

// ── access control ──────────────────────────────────────────────────────────
// Two doors:
//   waCanChat     — the full Conversations inbox (every thread). Management
//                   and Master only; no per-user grant opens it.
//   waCanChatLead — the per-lead chat opened from a lead's WhatsApp button.
//                   Any signed-in agent, unless chat is switched off globally.
export function isChatAdmin(user) {
  return !!user && (user.role === 'MANAGEMENT' || user.role === 'MASTER');
}

export function waCanChat(user) {
  return isChatAdmin(user);
}

export function waCanChatLead(user, settings) {
  if (!user) return false;
  if (isChatAdmin(user)) return true;
  return !(settings && settings.enabled === false);
}

// The JID WhatsApp uses for a phone-addressed 1:1 chat. Matches what the
// webhook stores for inbound messages, so a thread started from the CRM and
// the customer's reply land in the same row.
export const waJidForPhone = (phone) => {
  const d = normalizePhone(phone);
  return d ? `${d}@s.whatsapp.net` : '';
};

// Find the lead's thread on the account its team uses, or open a fresh one.
// Existing threads are matched on the last 9 digits (same rule as matchLead)
// so a LID-addressed thread that already learned its number is reused.
export async function waFindOrCreateConversation(lead) {
  const digits = normalizePhone(lead?.phone);
  if (!digits) return { ok: false, error: 'This customer has no valid phone number.' };
  const tail = digits.slice(-9);
  const account = waAccountForLead(lead);

  try {
    const rows = await sbGet(`wa_conversations?account=eq.${account}&phone=like.*${encodeURIComponent(tail)}&archived=is.false&order=last_message_at.desc.nullslast&limit=5`);
    const hit = (rows || []).map(rToConv).find(c => (normalizePhone(c.phone) || '').slice(-9) === tail);
    if (hit) {
      if (!hit.leadId && lead.id) { waLinkLead(hit.id, lead.id); hit.leadId = lead.id; }
      return { ok: true, conversation: hit, created: false };
    }
  } catch (e) {
    return { ok: false, error: e.message || 'Could not look up the conversation.' };
  }

  const conv = {
    id: waConvId(account, waJidForPhone(digits)), account, phone: digits, name: lead.name || digits,
    leadId: lead.id || null, lastMessageAt: new Date().toISOString(), lastMessagePreview: '',
    lastMessageDir: 'OUT', unreadCount: 0, source: 'WHATSAPP', adMeta: null,
    assignedTo: lead.assignedTo || null, companyId: lead.companyId || null, archived: false,
  };
  try {
    await sbUpsert('wa_conversations', [convToR(conv)]);
    return { ok: true, conversation: conv, created: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Could not start the conversation.' };
  }
}

// ── reads ───────────────────────────────────────────────────────────────────
export async function waLoadConversations({ limit = 200 } = {}) {
  const rows = await sbGet(`wa_conversations?archived=is.false&order=last_message_at.desc.nullslast&limit=${limit}`);
  return (rows || []).map(rToConv);
}

export async function waLoadMessages(conversationId, { limit = 300 } = {}) {
  if (!conversationId) return [];
  const rows = await sbGet(
    `wa_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&order=wa_timestamp.desc&limit=${limit}`
  );
  return (rows || []).map(rToMsg).reverse(); // oldest → newest for rendering
}

// Match a conversation to an existing CRM lead by phone. Uses the same
// normaliser the lead importer uses, then compares the last 9 digits so
// +880 / 880 / 0-prefixed variants of one number still line up.
export function matchLead(conv, leads) {
  if (conv.leadId) {
    const direct = leads.find(l => l.id === conv.leadId);
    if (direct) return direct;
  }
  const tail = (s) => (normalizePhone(s) || '').replace(/\D/g, '').slice(-9);
  const t = tail(conv.phone);
  if (!t) return null;
  return leads.find(l => tail(l.phone) === t) || null;
}

// ── writes ──────────────────────────────────────────────────────────────────
export async function waMarkRead(conversationId) {
  if (!conversationId) return;
  try {
    await fetch(`${SB_URL}/rest/v1/wa_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ unread_count: 0 }),
    });
  } catch (e) { console.warn('[wa] markRead failed', e); }
}

export async function waLinkLead(conversationId, leadId) {
  try {
    await fetch(`${SB_URL}/rest/v1/wa_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_id: leadId }),
    });
    return true;
  } catch { return false; }
}

export const waClientRef = () => 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// What Wasender should address the message to. A LID thread (…@lid) carries an
// internal identity, not a phone number, and the API rejects those digits with
// "The provided JID does not exist on WhatsApp." Such a thread is only sendable
// once the webhook has learned the real number from a later message.
export function waSendTarget(conversation) {
  const id = waConvJid(conversation?.id);
  const idDigits = id.split('@')[0].split(':')[0].replace(/\D/g, '');
  const phone = String(conversation?.phone || '').replace(/\D/g, '');
  if (id.endsWith('@lid') && (!phone || phone === idDigits)) return '';
  return phone || idDigits;
}

// Upload an outbound attachment to Supabase Storage and return its public URL.
// Wasender takes a URL for media, so the file never round-trips through the relay.
export async function waUploadMedia(file, onProgress) {
  const safe = (file.name || 'file').replace(/[^\w.-]/g, '_');
  const path = `out/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
  try {
    if (onProgress) onProgress(10);
    const r = await fetch(`${SB_URL}/storage/v1/object/${WA_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!r.ok) {
      let b = ''; try { b = await r.text(); } catch { /* ignore */ }
      console.error('[wa] media upload failed', r.status, b);
      return { ok: false, error: `Upload failed (HTTP ${r.status})` };
    }
    if (onProgress) onProgress(100);
    return { ok: true, url: `${SB_URL}/storage/v1/object/public/${WA_BUCKET}/${path}`, path };
  } catch (e) {
    return { ok: false, error: e.message || 'Upload failed' };
  }
}

// Persist the outgoing message immediately so it survives a reload and shows a
// PENDING tick, then ask the relay to actually deliver it. The relay rewrites
// the row with the real Wasender id once accepted.
export async function waSendMessage(settings, { conversation, user, type = 'text', body = '', mediaUrl = '', mediaMime = '', mediaName = '', mediaSize = 0 }) {
  const clientRef = waClientRef();
  const account = normAccount(conversation.account);
  const optimistic = {
    id: clientRef,
    conversationId: conversation.id,
    account,
    phone: conversation.phone,
    direction: 'OUT',
    type, body, caption: type === 'text' ? '' : body,
    mediaUrl, mediaMime, mediaName, mediaSize,
    status: WA_STATUS.PENDING,
    senderName: user?.name || '',
    sentBy: user?.id || null,
    clientRef,
    waTimestamp: new Date().toISOString(),
  };

  await sbUpsert('wa_messages', [msgToR(optimistic)]);
  await sbUpsert('wa_conversations', [{
    id: conversation.id,
    account,
    phone: conversation.phone,
    last_message_at: optimistic.waTimestamp,
    last_message_preview: type === 'text' ? body : (mediaName || type),
    last_message_dir: 'OUT',
  }]);

  if (!settings?.relayUrl) {
    await waFailMessage(clientRef, 'No relay URL configured — set it in Chat Settings.');
    return { ok: false, optimistic, error: 'No relay URL configured.' };
  }

  const to = waSendTarget(conversation);
  if (!to) {
    const reason = 'No phone number on this thread yet — WhatsApp identified it by LID. It becomes sendable after the next message arrives.';
    await waFailMessage(clientRef, reason);
    return { ok: false, optimistic, error: reason };
  }

  try {
    const r = await fetch(settings.relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        account,
        to,
        conversationId: conversation.id,
        clientRef,
        type,
        text: type === 'text' ? body : '',
        caption: type === 'text' ? '' : body,
        mediaUrl, mediaName, mediaMime,
        userId: user?.id || null,
        sessionName: settings.sessionName || undefined,
      }),
    });
    if (!r.ok) {
      let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch { /* ignore */ }
      await waFailMessage(clientRef, `Relay HTTP ${r.status}${detail ? ': ' + detail : ''}`);
      return { ok: false, optimistic, error: `Send failed (HTTP ${r.status})` };
    }
    return { ok: true, optimistic };
  } catch (e) {
    await waFailMessage(clientRef, e.message || 'Network error');
    return { ok: false, optimistic, error: 'Could not reach the relay.' };
  }
}

export async function waFailMessage(id, error) {
  try {
    await fetch(`${SB_URL}/rest/v1/wa_messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'FAILED', error: (error || '').slice(0, 500) }),
    });
  } catch { /* the UI already shows FAILED optimistically */ }
}

// Retry = delete the failed row and send a fresh one, so the thread doesn't
// accumulate dead bubbles.
export async function waRetry(settings, msg, conversation, user) {
  try {
    await fetch(`${SB_URL}/rest/v1/wa_messages?id=eq.${encodeURIComponent(msg.id)}`, {
      method: 'DELETE', headers: { ...SB_H, Prefer: 'return=minimal' },
    });
  } catch { /* ignore — worst case a stale failed bubble lingers */ }
  return waSendMessage(settings, {
    conversation, user, type: msg.type,
    body: msg.type === 'text' ? msg.body : msg.caption,
    mediaUrl: msg.mediaUrl, mediaMime: msg.mediaMime, mediaName: msg.mediaName, mediaSize: msg.mediaSize,
  });
}

// ── realtime ────────────────────────────────────────────────────────────────
// Same Phoenix protocol the notification socket uses, scoped to the two chat
// tables. Reports connection state so the view can show a reconnect banner.
export function waSubscribe({ onMessage, onConversation, onState }) {
  if (!SB_URL || !SB_KEY) return () => {};
  const wsUrl = `${SB_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${SB_KEY}&vsn=1.0.0`;
  let ws, hbTimer, reconnTimer, attempt = 0;
  let dead = false;

  function connect() {
    onState?.('connecting');
    try { ws = new WebSocket(wsUrl); } catch { schedule(); return; }

    ws.onopen = () => {
      attempt = 0;
      onState?.('online');
      // Must be `realtime:public` — under vsn=1.0.0 a third segment names a
      // single TABLE (realtime:public:notifications), so an invented segment
      // binds to a table that doesn't exist and silently delivers nothing.
      ws.send(JSON.stringify({
        topic: 'realtime:public',
        event: 'phx_join',
        payload: {
          config: {
            postgres_changes: [
              { event: '*', schema: 'public', table: 'wa_messages' },
              { event: '*', schema: 'public', table: 'wa_conversations' },
            ],
          },
        },
        ref: '1',
      }));
      hbTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(Date.now()) }));
      }, 25000);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // Surface a rejected join instead of sitting there looking connected.
        if (msg.event === 'phx_reply' && msg.payload?.status === 'error') {
          console.error('[wa] realtime join rejected:', msg.payload?.response);
          onState?.('error');
          return;
        }

        if (msg.event !== 'postgres_changes') return;
        const p = msg.payload?.data;
        if (!p) return;
        if (p.table === 'wa_messages' && p.record) onMessage?.(rToMsg(p.record), p.type);
        if (p.table === 'wa_conversations' && p.record) onConversation?.(rToConv(p.record), p.type);
      } catch { /* malformed frame — ignore */ }
    };

    ws.onclose = () => { clearInterval(hbTimer); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  function schedule() {
    if (dead) return;
    onState?.('offline');
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt++)); // 1s → 30s backoff
    reconnTimer = setTimeout(connect, delay);
  }

  connect();
  return () => { dead = true; clearInterval(hbTimer); clearTimeout(reconnTimer); try { ws?.close(); } catch { /* ignore */ } };
}
