// WhatsApp (Wasender) chat client.
//
// Mirrors the conventions in supabase.js: raw REST against PostgREST with the
// anon key, snake_case ↔ camelCase converters, and a hand-rolled realtime
// socket. Nothing here ever sees the Wasender API token — outbound sends are
// POSTed to a server-side relay (Supabase Edge Function or n8n) whose URL comes
// from wa_settings. The relay holds the credential.

import { SB_URL, SB_KEY, SB_H, bearer, accessToken, ensureFreshToken, onAccessToken, sbGet, sbUpsert } from './supabase.js';

// The send endpoint is fixed at build time (CR-001 CR-2). wa_settings.relay_url
// can be rewritten with the anon key, so trusting it would hand every human
// message, and the sender's session token, to whoever planted the URL. The
// stored value is shown read-only in Chat Settings and never fetched.
export const WA_RELAY_URL = import.meta.env.VITE_WA_RELAY_URL || `${SB_URL}/functions/v1/wa-send`;
const relayHeaders = () => ({ 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: bearer() });
// Every request that carries the session token refreshes it first if it has
// expired (ensureFreshToken), the same as the requests in supabase.js.
// The header is rebuilt after the refresh: callers built it from the old token.
const authedFetch = async (url, init) => { await ensureFreshToken(); return fetch(url, { ...init, headers: { ...init.headers, Authorization: bearer() } }); };
import { normalizePhone, getDB } from './db.js';

export const WA_BUCKET = 'wa-media';

// ── accounts ────────────────────────────────────────────────────────────────
// Two Wasender sessions: Dubai WhatsApp and Eyad WhatsApp.
// Dubai agent / Dubai team leads send through the Dubai number;
// all other agents / leads send through Eyad's number.
export const WA_ACCOUNTS = ['dubai', 'eyad'];
export const WA_DEFAULT_ACCOUNT = 'eyad';
export const WA_ACCOUNT_LABEL = { dubai: 'Dubai WhatsApp', eyad: 'Eyad WhatsApp' };

const DUBAI_MATCH = (import.meta.env.VITE_WA_DUBAI_TEAM || 'dubai').toLowerCase();

export function isDubaiAgent(user) {
  if (!user) return false;
  const teams = getDB().teams || [];
  if (user.teamId) {
    const team = teams.find(t => t.id === user.teamId);
    if (team && (team.name || '').toLowerCase().includes(DUBAI_MATCH)) return true;
  }
  if ((user.teamName || '').toLowerCase().includes(DUBAI_MATCH)) return true;
  const tag = `${user.name || ''} ${user.email || ''}`.toLowerCase();
  return tag.includes(DUBAI_MATCH);
}

// Determines which number (Dubai or Eyad) should be used:
// Dubai agent -> Dubai WhatsApp
// Otherwise -> Eyad WhatsApp
export function waAccountForUser(user, lead) {
  if (isDubaiAgent(user)) return 'dubai';
  if (lead?.teamId) {
    const teams = getDB().teams || [];
    const team = teams.find(t => t.id === lead.teamId);
    if (team && (team.name || '').toLowerCase().includes(DUBAI_MATCH)) return 'dubai';
  }
  return WA_DEFAULT_ACCOUNT;
}

export const normAccount = (a) => (WA_ACCOUNTS.includes(String(a || '').toLowerCase()) ? String(a).toLowerCase() : WA_DEFAULT_ACCOUNT);
export const waJidForPhone = (phone) => {
  const d = normalizePhone(phone);
  return d ? `${d}@s.whatsapp.net` : '';
};
export const waConvId = (account, jid) => `${normAccount(account)}:${jid}`;
export const waConvJid = (id) => {
  const s = String(id || '');
  for (const a of WA_ACCOUNTS) if (s.startsWith(a + ':')) return s.slice(a.length + 1);
  return s;
};

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

// relay_url is never written: the send endpoint is fixed at build time
// (WA_RELAY_URL), and the stored value is left as it is so a rollback to an
// older client still finds it.
export async function waSaveSettings(s, user) {
  const row = {
    id: 'default', session_name: s.sessionName || '',
    enabled: s.enabled !== false, allowed_user_ids: s.allowedUserIds || [],
    webhook_url: s.webhookUrl || '', updated_at: new Date().toISOString(),
    updated_by: user?.id || null,
  };
  return sbUpsert('wa_settings', [row]);
}

// ── access control ──────────────────────────────────────────────────────────
export function isChatAdmin(user) {
  return !!user && (user.role === 'MANAGEMENT' || user.role === 'MASTER');
}

// Front-line agents are off by default — turned back on by flipping this one
// line (or re-adding 'AGENT'/'EXECUTIVE' here) when the team is ready for
// them to read/write WhatsApp chat themselves. Team Lead/Management/Master
// keep access to monitor and reply.
const CHAT_DENIED_ROLES = ['AGENT', 'EXECUTIVE'];

export function waCanChat(user, settings) {
  if (!user) return false;
  if (CHAT_DENIED_ROLES.includes(user.role)) return false;
  if (settings && settings.enabled === false) return false;
  return true;
}

export function waCanChatLead(user, settings) {
  if (!user) return false;
  if (settings && settings.enabled === false) return false;
  return true;
}

// Requirement 3: agent sees only chats for leads forwarded/assigned to that agent
export function isLeadAssignedOrForwardedTo(lead, user) {
  if (!user) return false;
  if (isChatAdmin(user)) return true;
  if (!lead) return false;
  if (lead.assignedTo === user.id) return true;
  if (Array.isArray(lead.previousAssignees) && lead.previousAssignees.includes(user.id)) return true;
  if (user.role === 'TEAM_LEAD' && user.teamId && lead.teamId === user.teamId) return true;
  return false;
}

// ── reads ───────────────────────────────────────────────────────────────────
export async function waLoadConversations({ limit = 200, offset = 0 } = {}) {
  const rows = await sbGet(`wa_conversations?archived=is.false&order=last_message_at.desc.nullslast&limit=${limit}&offset=${offset}`);
  return (rows || []).map(rToConv);
}

export async function waLoadMessages(conversationId, { limit = 300, before = null, beforeId = null } = {}) {
  if (!conversationId) return [];
  // Keyset pagination on (wa_timestamp, id) ordered descending: strictly before
  // the oldest loaded message, so messages sharing its exact timestamp are not
  // dropped or repeated at the page boundary.
  const beforeParam = before
    ? beforeId
      ? `&or=(wa_timestamp.lt.${encodeURIComponent(before)},and=(wa_timestamp.eq.${encodeURIComponent(before)},id.lt.${encodeURIComponent(beforeId)}))`
      : `&wa_timestamp=lt.${encodeURIComponent(before)}`
    : '';
  const rows = await sbGet(
    `wa_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&order=wa_timestamp.desc,id.desc&limit=${limit}${beforeParam}`
  );
  return (rows || []).map(rToMsg).reverse(); // oldest → newest for rendering
}

// Match a conversation to an existing CRM lead by phone or lead_id.
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
    await authedFetch(`${SB_URL}/rest/v1/wa_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ unread_count: 0 }),
    });
  } catch (e) { console.warn('[wa] markRead failed', e); }
}

export async function waLinkLead(conversationId, leadId) {
  try {
    await authedFetch(`${SB_URL}/rest/v1/wa_conversations?id=eq.${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ lead_id: leadId }),
    });
    return true;
  } catch { return false; }
}

// AI reply + takeover state for one conversation, for the Conversations UI.
// The reply switch is wa_bot_settings.faq_agent_enabled on the bot's row; a
// human takeover is an active ai_handoffs row for this thread.
export async function waAiState(conversationId) {
  const bot = String(conversationId || '').split(':')[0] || 'eyad';
  const [s, h] = await Promise.all([
    sbGet(`wa_bot_settings?bot=eq.${bot}&select=faq_agent_enabled,trainer_test_mode`),
    sbGet(`ai_handoffs?conversation_id=eq.${encodeURIComponent(conversationId)}&select=status&limit=1`),
  ]);
  const row = s?.[0];
  return {
    bot,
    repliesOn: row ? row.faq_agent_enabled !== false : null,
    trainerTest: !!row?.trainer_test_mode,
    takeover: !!(h?.[0]),
  };
}

export const waClientRef = () => 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// What Wasender should address the message to.
export function waSendTarget(conversation) {
  let id = String(conversation?.id || '');
  for (const a of WA_ACCOUNTS) {
    if (id.startsWith(a + ':')) {
      id = id.slice(a.length + 1);
      break;
    }
  }
  const idDigits = id.split('@')[0].split(':')[0].replace(/\D/g, '');
  const phone = String(conversation?.phone || '').replace(/\D/g, '');
  if (id.endsWith('@lid') && (!phone || phone === idDigits)) return '';
  return phone || idDigits;
}

// Find existing conversation for lead or create new on appropriate account (Dubai vs Eyad)
export async function waFindOrCreateConversation(lead, user) {
  const digits = normalizePhone(lead?.phone);
  if (!digits) return { ok: false, error: 'This customer has no valid phone number.' };
  const tail = digits.slice(-9);
  const account = waAccountForUser(user, lead);
  const jid = waJidForPhone(digits);
  const convId = waConvId(account, jid);

  try {
    const rows = await sbGet(`wa_conversations?account=eq.${account}&phone=like.*${encodeURIComponent(tail)}&archived=is.false&order=last_message_at.desc.nullslast&limit=5`);
    const hit = (rows || []).map(rToConv).find(c => (normalizePhone(c.phone) || '').slice(-9) === tail);
    if (hit) {
      if (!hit.leadId && lead.id) { waLinkLead(hit.id, lead.id); hit.leadId = lead.id; }
      return { ok: true, conversation: hit, created: false };
    }
  } catch (e) {
    console.warn('[wa] lookup error, will create new', e);
  }

  const conv = {
    id: convId,
    account,
    phone: digits,
    name: lead.name || digits,
    leadId: lead.id || null,
    lastMessageAt: new Date().toISOString(),
    lastMessagePreview: '',
    lastMessageDir: 'OUT',
    unreadCount: 0,
    source: 'WHATSAPP',
    adMeta: null,
    assignedTo: lead.assignedTo || null,
    companyId: lead.companyId || null,
    archived: false,
  };
  try {
    await sbUpsert('wa_conversations', [convToR(conv)]);
    return { ok: true, conversation: conv, created: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Could not start the conversation.' };
  }
}

// Upload an outbound attachment to Supabase Storage and return its public URL.
export async function waUploadMedia(file, onProgress) {
  const safe = (file.name || 'file').replace(/[^\w.-]/g, '_');
  const path = `out/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
  try {
    if (onProgress) onProgress(10);
    const r = await authedFetch(`${SB_URL}/storage/v1/object/${WA_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: bearer(), 'Content-Type': file.type || 'application/octet-stream' },
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
// PENDING tick, then ask the relay to actually deliver it.
// Uses Dubai session for Dubai agents and Eyad session for other agents.
export async function waSendMessage(settings, { conversation, user, type = 'text', body = '', mediaUrl = '', mediaMime = '', mediaName = '', mediaSize = 0 }) {
  const clientRef = waClientRef();
  const account = normAccount(conversation?.account || waAccountForUser(user));
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

  const to = waSendTarget(conversation);
  if (!to) {
    const reason = 'No phone number on this thread yet — WhatsApp identified it by LID. It becomes sendable after the next message arrives.';
    await waFailMessage(clientRef, reason);
    return { ok: false, optimistic, error: reason };
  }

  try {
    const r = await authedFetch(WA_RELAY_URL, {
      method: 'POST',
      headers: relayHeaders(),
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
        sessionName: settings?.sessionName || undefined,
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
    await authedFetch(`${SB_URL}/rest/v1/wa_messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...SB_H, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'FAILED', error: (error || '').slice(0, 500) }),
    });
  } catch { /* the UI already shows FAILED optimistically */ }
}

export async function waRetry(settings, msg, conversation, user) {
  try {
    await authedFetch(`${SB_URL}/rest/v1/wa_messages?id=eq.${encodeURIComponent(msg.id)}`, {
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
export function waSubscribe({ onMessage, onConversation, onState }) {
  if (!SB_URL || !SB_KEY) return () => {};
  const wsUrl = `${SB_URL.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${SB_KEY}&vsn=1.0.0`;
  let ws, hbTimer, reconnTimer, attempt = 0;
  let dead = false;
  // Realtime drops a channel when its token expires: hand it each refreshed one.
  const offToken = onAccessToken((t) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ topic: 'realtime:public', event: 'access_token', payload: { access_token: t }, ref: String(Date.now()) })); });

  async function connect() {
    onState?.('connecting');
    await ensureFreshToken().catch(() => null);
    if (dead) return;
    try { ws = new WebSocket(wsUrl); } catch { schedule(); return; }

    ws.onopen = () => {
      attempt = 0;
      onState?.('online');
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
          // RLS on these tables (0055) admits only a signed-in account.
          access_token: accessToken(),
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
    const delay = Math.min(30000, 1000 * Math.pow(2, attempt++));
    reconnTimer = setTimeout(connect, delay);
  }

  connect();
  return () => { dead = true; offToken(); clearInterval(hbTimer); clearTimeout(reconnTimer); try { ws?.close(); } catch { /* ignore */ } };
}
