// ============================================================================
// n8n Code node — Wasender webhook → Supabase (WEPRO CRM Conversations)
//
// Paste this into a Code node wired directly after your existing Webhook node
// in the "wecon-whatsapp" workflow. Node settings:
//   Mode: "Run Once for All Items"
//   Language: JavaScript
//
// Two WhatsApp numbers share this one workflow. Give each Wasender session its
// own webhook URL, differing only by the account in the query string:
//   Dubai: https://n8n.mutholab.com/webhook/wecon-whatsapp?account=dubai
//   Eyad : https://n8n.mutholab.com/webhook/wecon-whatsapp?account=eyad
// The Webhook node exposes that as $json.query.account. A URL with no account
// is treated as Eyad. Thread ids are stored as <account>:<jid>.
//
// Required n8n environment variables:
//   SUPABASE_URL               https://sbqmougcvnplgjgihpwe.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role key (NOT the anon key)
//
// If $env comes back undefined, your n8n has env access blocked in Code nodes.
// Fix on the n8n host with:  N8N_BLOCK_ENV_ACCESS_IN_NODE=false
//
// Does everything the wa-webhook Edge Function does: replay guard, media
// mirroring into Storage, ad-referral parsing, conversation upsert, message
// upsert, atomic unread bump. No Edge Function deployment needed.
// ============================================================================

const SUPABASE_URL = $env.SUPABASE_URL;
const SERVICE_KEY = $env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'wa-media';

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as n8n environment variables.');
}

const H = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// The Code sandbox has no global fetch on Node 16 / older n8n builds, so route
// requests through this.helpers.httpRequest and hand back a fetch-shaped object.
const NATIVE_FETCH = typeof fetch === 'function' ? fetch : null;
const HELPER_REQUEST =
  (typeof this !== 'undefined' && this && this.helpers && this.helpers.httpRequest)
    ? this.helpers.httpRequest.bind(this.helpers)
    : (typeof $helpers !== 'undefined' && $helpers && $helpers.httpRequest)
      ? $helpers.httpRequest.bind($helpers)
      : null;

if (!NATIVE_FETCH && !HELPER_REQUEST) {
  throw new Error('No HTTP client in this Code node: run n8n on Node 18+ or a build that exposes this.helpers.httpRequest.');
}

function wrapResponse(res) {
  const status = res.statusCode ?? 0;
  const raw = res.body;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof raw === 'string' ? raw : Buffer.from(raw ?? '').toString('utf8')),
    json: async () => {
      if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
      try { return JSON.parse(typeof raw === 'string' ? (raw || 'null') : Buffer.from(raw ?? '').toString('utf8')); }
      catch { return null; }
    },
    arrayBuffer: async () => Buffer.from(raw ?? ''),
  };
}

// `binary: true` pulls the raw bytes instead of a decoded string.
async function http(url, init = {}) {
  if (NATIVE_FETCH) return NATIVE_FETCH(url, init);
  const res = await HELPER_REQUEST({
    method: init.method || 'GET',
    url,
    headers: init.headers || {},
    ...(init.body === undefined ? {} : { body: init.body }),
    json: false,
    ...(init.binary ? { encoding: 'arraybuffer' } : {}),
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    timeout: 30000,
  });
  return wrapResponse(res);
}

// Wasender status strings → the CRM's ladder.
const STATUS_MAP = {
  pending: 'PENDING', sent: 'SENT', server_ack: 'SENT',
  delivered: 'DELIVERED', delivery_ack: 'DELIVERED',
  read: 'READ', played: 'READ',
  failed: 'FAILED', error: 'FAILED',
};

// Status only ever moves forward, so a late receipt can't undo a later one.
const STATUS_RANK = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

const jidToPhone = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

async function sbFetch(path, init) {
  const r = await http(`${SUPABASE_URL}${path}`, init);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.log(`[wa] ${init?.method || 'GET'} ${path} → ${r.status} ${body.slice(0, 300)}`);
  }
  return r;
}

const upsert = (table, rows) =>
  sbFetch(`/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });

const patch = (table, filter, body) =>
  sbFetch(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });

// Insert-once guard. false = this delivery was already processed.
async function claimEvent(id, eventType) {
  const r = await http(`${SUPABASE_URL}/rest/v1/wa_webhook_events`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify([{ id, event_type: eventType }]),
  });
  if (r.ok) return true;
  if (r.status === 409) return false;
  return true; // fail open — a rare duplicate beats a dropped message
}

const extractText = (m) =>
  m?.conversation ??
  m?.extendedTextMessage?.text ??
  m?.imageMessage?.caption ??
  m?.videoMessage?.caption ??
  m?.documentMessage?.caption ??
  m?.buttonsResponseMessage?.selectedDisplayText ??
  m?.listResponseMessage?.title ??
  // Wasender's flat shape puts the text straight on the message node.
  m?.messageBody ??
  m?.text ??
  '';

function extractMedia(m) {
  if (m?.imageMessage)    return { type: 'image',    url: m.imageMessage.url,    mime: m.imageMessage.mimetype,    name: 'image.jpg',    size: Number(m.imageMessage.fileLength) || 0 };
  if (m?.videoMessage)    return { type: 'video',    url: m.videoMessage.url,    mime: m.videoMessage.mimetype,    name: 'video.mp4',    size: Number(m.videoMessage.fileLength) || 0 };
  if (m?.audioMessage)    return { type: 'audio',    url: m.audioMessage.url,    mime: m.audioMessage.mimetype,    name: 'audio.ogg',    size: Number(m.audioMessage.fileLength) || 0 };
  if (m?.documentMessage) return { type: 'document', url: m.documentMessage.url, mime: m.documentMessage.mimetype, name: m.documentMessage.fileName || 'document', size: Number(m.documentMessage.fileLength) || 0 };
  if (m?.stickerMessage)  return { type: 'sticker',  url: m.stickerMessage.url,  mime: m.stickerMessage.mimetype,  name: 'sticker.webp', size: 0 };
  // Flat shape: messageType: 'imageMessage' with the URL alongside it.
  const flat = String(m?.messageType || '').replace(/Message$/, '').toLowerCase();
  const flatUrl = m?.mediaUrl ?? m?.url ?? '';
  if (flatUrl && ['image', 'video', 'audio', 'document', 'sticker'].includes(flat)) {
    return { type: flat, url: flatUrl, mime: m.mimetype || '', name: m.fileName || flat, size: Number(m.fileLength) || 0 };
  }
  return { type: 'text' };
}

// Click-to-WhatsApp ad referral, accepted at any of the paths Wasender uses.
function extractAd(msg, data) {
  const ctx =
    msg?.extendedTextMessage?.contextInfo?.externalAdReply ??
    msg?.imageMessage?.contextInfo?.externalAdReply ??
    msg?.contextInfo?.externalAdReply ??
    data?.externalAdReply ??
    data?.adReply ??
    null;
  if (!ctx) return null;
  const ad = {
    title: ctx.title ?? ctx.adTitle ?? '',
    description: ctx.description ?? ctx.adDescription ?? '',
    body: ctx.body ?? ctx.adText ?? ctx.text ?? '',
    conversionSource: ctx.conversionSource ?? ctx.sourceType ?? ctx.source ?? '',
    sourceUrl: ctx.sourceUrl ?? ctx.url ?? '',
    greetingMessageBody: ctx.greetingMessageBody ?? ctx.greeting ?? '',
    thumbnailUrl: ctx.thumbnailUrl ?? ctx.thumbnail ?? '',
  };
  return Object.values(ad).some(Boolean) ? ad : null;
}

// WhatsApp media URLs expire and need auth, so copy the bytes into Storage and
// keep the durable public URL. Failure is non-fatal — the message still lands.
async function mirrorMedia(url, name, mime) {
  try {
    const res = await http(url, { binary: true });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    const safe = String(name || 'file').replace(/[^\w.-]/g, '_');
    const path = `in/${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${safe}`;
    const up = await http(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': mime || 'application/octet-stream' },
      body: buf,
    });
    if (!up.ok) return '';
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch { return ''; }
}

// Link the thread to an existing CRM lead by the last 9 digits, so +880 / 880 /
// 0-prefixed variants of the same number still match.
async function findLeadId(phone) {
  const tail = phone.slice(-9);
  if (tail.length < 8) return null;
  const r = await sbFetch(`/rest/v1/leads?phone=like.*${encodeURIComponent(tail)}&select=id&limit=1`, { headers: H });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.id ?? null;
}

// ── main ────────────────────────────────────────────────────────────────────
const out = [];

for (const item of $input.all()) {
  // n8n's Webhook node nests the real payload under `body`.
  const payload = item.json?.body ?? item.json;
  const event = payload?.event ?? payload?.type ?? 'unknown';
  const data = payload?.data ?? payload;

  // Which number this delivery belongs to (see header). Query string first,
  // then a payload field in case a proxy strips the query.
  const rawAccount = item.json?.query?.account ?? payload?.account ?? '';
  const account = String(rawAccount).toLowerCase() === 'dubai' ? 'dubai' : 'eyad';

  const deliveryId =
    payload?.id ?? payload?.eventId ??
    data?.key?.id ?? data?.messages?.key?.id ?? data?.msgId ?? null;

  if (deliveryId && !(await claimEvent(`${account}:${event}:${deliveryId}`, event))) {
    out.push({ json: { skipped: 'duplicate', event, deliveryId } });
    continue;
  }

  // Extract up front: an event that carries a real body is a message, not a
  // receipt. A reply typed on the phone arrives with fromMe true (often as
  // message.sent) and has to land in the thread, not just patch a status.
  const msgNode = data?.messages ?? data?.message ?? data;
  const key = msgNode?.key ?? data?.key ?? {};
  const inner = msgNode?.message ?? msgNode ?? {};
  const text = extractText(inner);
  const media = extractMedia(inner);
  const hasContent = !!(text || media.type !== 'text');

  // Delivery receipts for messages the CRM sent.
  if (!hasContent && (event.includes('update') || event.includes('receipt') || event === 'message.sent')) {
    const updates = Array.isArray(data) ? data : [data];
    for (const u of updates) {
      const id = u?.key?.id ?? u?.msgId ?? u?.id;
      const status = STATUS_MAP[String(u?.status ?? u?.update?.status ?? '').toLowerCase()];
      if (id && status) await patch('wa_messages', `wa_id=eq.${encodeURIComponent(String(id))}`, { status });
    }
    out.push({ json: { ok: true, kind: 'receipt', event } });
    continue;
  }

  // Message: inbound, or outbound typed on the phone (fromMe).
  const jid = key.remoteJid ?? msgNode?.remoteJid ?? data?.from ?? '';

  if (!jid || String(jid).endsWith('@g.us')) {
    out.push({ json: { skipped: 'not a 1:1 chat', jid } });
    continue;
  }

  const fromMe = !!key.fromMe;
  const msgId = key.id ?? msgNode?.id ?? `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // WhatsApp addresses some chats by LID (…@lid), whose digits are not a phone
  // number — sending to them fails with "The provided JID does not exist on
  // WhatsApp." The payload carries the real phone JID alongside, so prefer that
  // for the phone column. senderPn is only the customer's when !fromMe.
  const phoneJidCandidates = [
    key.remoteJid, key.remoteJidAlt, msgNode?.remoteJidAlt, data?.remoteJidAlt,
    ...(fromMe ? [] : [key.senderPn, key.participantPn, msgNode?.senderPn, data?.senderPn]),
    data?.from,
  ].filter(Boolean).map(String);
  const phoneJid = phoneJidCandidates.find((j) => j.endsWith('@s.whatsapp.net')) ?? '';
  const phone = jidToPhone(phoneJid || jid);
  const ad = extractAd(inner, data);
  const pushName = msgNode?.pushName ?? data?.pushName ?? '';
  const ts = Number(msgNode?.messageTimestamp ?? data?.timestamp ?? 0);
  const at = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  const mediaUrl = media.url ? await mirrorMedia(media.url, media.name, media.mime) : '';

  // Conversation first, so the message never points at a missing thread.
  // Threads are keyed per account so one customer can talk to both numbers.
  const threadId = `${account}:${jid}`;
  const existingRes = await sbFetch(`/rest/v1/wa_conversations?id=eq.${encodeURIComponent(threadId)}&select=id,name,lead_id,source`, { headers: H });
  const existing = existingRes.ok ? await existingRes.json().catch(() => []) : [];
  const leadId = existing?.[0]?.lead_id ?? (await findLeadId(phone));

  // pushName on a fromMe message is our own WhatsApp profile name, not the
  // customer's — it must never overwrite the thread title.
  const conv = {
    id: threadId,
    account,
    phone,
    name: (fromMe ? '' : pushName) || existing?.[0]?.name || phone,
    lead_id: leadId,
  };
  // Stamp the ad payload once — it arrives on the first message and must not be
  // wiped by later plain messages in the same thread.
  if (ad) { conv.source = 'AD'; conv.ad_meta = ad; }
  else if (!existing?.length) { conv.source = 'WHATSAPP'; }

  await upsert('wa_conversations', [conv]);

  // A receipt may already have advanced this row past SENT; don't drag it back.
  let status = fromMe ? 'SENT' : 'DELIVERED';
  if (fromMe) {
    const prevRes = await sbFetch(`/rest/v1/wa_messages?id=eq.${encodeURIComponent(msgId)}&select=status`, { headers: H });
    const prevRows = prevRes.ok ? await prevRes.json().catch(() => []) : [];
    const prev = prevRows?.[0]?.status;
    if (prev && (STATUS_RANK[prev] ?? 0) > STATUS_RANK.SENT) status = prev;
  }

  await upsert('wa_messages', [{
    id: msgId,
    wa_id: msgId,
    conversation_id: threadId,
    account,
    phone,
    direction: fromMe ? 'OUT' : 'IN',
    type: media.type,
    body: media.type === 'text' ? text : '',
    caption: media.type === 'text' ? '' : text,
    media_url: mediaUrl,
    media_mime: media.mime ?? '',
    media_name: media.name ?? '',
    media_size: media.size ?? 0,
    status,
    sender_name: fromMe ? '' : pushName,
    wa_timestamp: at,
  }]);

  // Atomic, so two messages landing together can't clobber the count.
  await sbFetch('/rest/v1/rpc/wa_bump_unread', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      p_conv: threadId,
      p_preview: String(text || media.name || media.type).slice(0, 180),
      p_at: at,
      p_dir: fromMe ? 'OUT' : 'IN',
    }),
  });

  out.push({ json: { ok: true, account, jid, msgId, type: media.type, ad: !!ad, mirrored: !!mediaUrl } });
}

return out;
