// CRM Chat · Parse — normalise one Wasender delivery for the Conversations
// tables. Runs in parallel with the bot's own Parse Event; it never sends
// anything. Text only: media messages are recorded by type, no file mirroring.
//
// Which number this session is comes from the webhook URL:
//   …/webhook/wecon-whatsapp?account=dubai   or   ?account=eyad
// No account → eyad. Thread ids are <account>:<jid>.
const item = $input.first().json;
const payload = item.body ?? item;
const event = String(payload?.event ?? payload?.type ?? 'unknown');
const data = payload?.data ?? payload;

const rawAccount = item.query?.account ?? payload?.account ?? item.headers?.['x-wa-account']
  ?? (/[?&]account=(dubai|eyad)/i.test(String(item.webhookUrl || '')) ? RegExp.$1 : '');
const account = String(rawAccount).toLowerCase() === 'dubai' ? 'dubai' : 'eyad';

const STATUS_MAP = {
  pending: 'PENDING', sent: 'SENT', server_ack: 'SENT',
  delivered: 'DELIVERED', delivery_ack: 'DELIVERED',
  read: 'READ', played: 'READ', failed: 'FAILED', error: 'FAILED',
};

const msgNode = data?.messages ?? data?.message ?? data;
const key = msgNode?.key ?? data?.key ?? {};
const inner = msgNode?.message ?? msgNode ?? {};

const text = String(
  inner?.conversation ?? inner?.extendedTextMessage?.text ?? inner?.imageMessage?.caption ??
  inner?.videoMessage?.caption ?? inner?.documentMessage?.caption ??
  inner?.buttonsResponseMessage?.selectedDisplayText ?? inner?.listResponseMessage?.title ??
  msgNode?.messageBody ?? inner?.messageBody ?? inner?.text ?? ''
).trim();

let type = 'text', mediaName = '';
if (inner?.imageMessage) { type = 'image'; mediaName = 'image.jpg'; }
else if (inner?.videoMessage) { type = 'video'; mediaName = 'video.mp4'; }
else if (inner?.audioMessage) { type = 'audio'; mediaName = 'audio.ogg'; }
else if (inner?.documentMessage) { type = 'document'; mediaName = inner.documentMessage.fileName || 'document'; }
else if (inner?.stickerMessage) { type = 'sticker'; mediaName = 'sticker.webp'; }
else {
  const flat = String(msgNode?.messageType ?? '').replace(/Message$/, '').toLowerCase();
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(flat)) { type = flat; mediaName = msgNode?.fileName || flat; }
}
const hasContent = !!(text || type !== 'text');

// Delivery receipts for messages the CRM sent.
if (!hasContent && (event.includes('update') || event.includes('receipt') || event === 'message.sent')) {
  const updates = Array.isArray(data) ? data : [data];
  return updates
    .map(u => ({ id: u?.key?.id ?? u?.msgId ?? u?.id, status: STATUS_MAP[String(u?.status ?? u?.update?.status ?? '').toLowerCase()] }))
    .filter(x => x.id && x.status)
    .map(x => ({ json: { kind: 'receipt', waId: String(x.id), status: x.status } }));
}

const jid = String(key.remoteJid ?? msgNode?.remoteJid ?? data?.from ?? '');
if (!hasContent || !jid || jid.endsWith('@g.us')) return [];

const fromMe = key.fromMe === true;
const msgId = String(key.id ?? msgNode?.id ?? `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const phoneJidCandidates = [
  key.remoteJid, key.remoteJidAlt, msgNode?.remoteJidAlt, data?.remoteJidAlt,
  ...(fromMe ? [] : [key.senderPn, key.participantPn, key.cleanedSenderPn, msgNode?.senderPn, data?.senderPn]),
  data?.from,
].filter(Boolean).map(String);
const phoneJid = phoneJidCandidates.find(j => j.endsWith('@s.whatsapp.net')) ?? '';
// Phone only when WhatsApp actually told us one. A LID's digits are NOT a
// phone number; a LID-only delivery is matched to its thread via the lid.
const phone = phoneJid ? phoneJid.split('@')[0].split(':')[0].replace(/\D/g, '') : '';
const lid = ([jid, key.senderLid, key.remoteJidAlt, msgNode?.remoteJidAlt].filter(Boolean).map(String)
  .find(j => j.endsWith('@lid')) ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
const pushName = String(msgNode?.pushName ?? data?.pushName ?? '');
const ts = Number(msgNode?.messageTimestamp ?? data?.timestamp ?? 0);
const at = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();
const deliveryId = String(payload?.id ?? payload?.eventId ?? key.id ?? msgId);

// One thread per customer per number. WhatsApp may address the same person
// by LID (…@lid) on inbound and by phone JID on outbound — keying the thread
// on the phone JID whenever the number is known keeps both sides together.
// A LID-only delivery is looked up by lid so it joins the phone thread.
const threadJid = phone ? `${phone}@s.whatsapp.net` : jid;
const threadId = `${account}:${threadJid}`;
const lookupQs = `account=eq.${account}&` + (lid
  ? `or=(id.eq.${encodeURIComponent(threadId)},lid.eq.${encodeURIComponent(lid)})`
  : `id=eq.${encodeURIComponent(threadId)}`) + `&order=last_message_at.desc.nullslast&limit=1&select=id,name,lead_id,source,phone,lid`;

return [{ json: {
  kind: 'message', account, event,
  eventId: `${account}:${event}:${deliveryId}`,
  threadId, jid: threadJid, lid, lookupQs, phone, phoneTail: phone.slice(-9) || 'NOPHONE',
  fromMe, msgId, text, type, mediaName, pushName, at,
  preview: String(text || mediaName || type).slice(0, 180),
} }];
