// Walks the WhatsApp chat screens as a manager against the mock server:
// Menu → Conversations (filters, search, grouping), a thread (bubbles, read
// marks), a send through the relay, a retry, and the link to the lead.
// The mock closes the realtime socket, so live updates are NOT exercised here.
import { signInAs, tap, shot, text } from './mock.mjs';

const iso = (minsFromNow) => new Date(Date.now() + minsFromNow * 60000).toISOString();
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const A = 'eyad:8801710000000@s.whatsapp.net'; // lead L001's number
const A_LID = 'eyad:123456789012345@lid';       // the same customer's LID thread
const B = 'dubai:971501234567@s.whatsapp.net';

const conv = (id, extra) => ({
  id, account: id.split(':')[0], phone: '', name: '', avatar_url: '', lead_id: null, last_message_at: iso(-5), last_message_preview: '',
  last_message_dir: 'IN', unread_count: 0, source: 'WHATSAPP', ad_meta: null, assigned_to: null, company_id: 'c1', archived: false,
  created_at: iso(-9000), updated_at: iso(-5), lid: '', ...extra,
});
const CONVS = [
  conv(A, { phone: '8801710000000', name: 'Rahim Ahmed 1', lead_id: 'L001', unread_count: 2, last_message_at: iso(-4), last_message_preview: 'Can I visit on Friday?', source: 'AD', ad_meta: { title: 'Lake View launch' } }),
  conv(A_LID, { phone: '8801710000000', name: '8801710000000', unread_count: 1, last_message_at: iso(-3000), last_message_preview: 'Hello' }),
  conv(B, { phone: '971501234567', name: 'Karim Dubai', last_message_at: iso(-90), last_message_preview: 'Sending the brochure now.', last_message_dir: 'OUT' }),
];

const msg = (id, conversation_id, mins, extra) => ({
  id, wa_id: 'wa-' + id, conversation_id, phone: '8801710000000', direction: 'IN', type: 'text', body: '', caption: '', media_url: '', media_mime: '',
  media_name: '', media_size: 0, status: 'SENT', error: '', sender_name: '', sent_by: null, client_ref: null, reply_to_message_id: null,
  wa_timestamp: iso(mins), created_at: iso(mins), account: conversation_id.split(':')[0], ...extra,
});
const MSGS = [
  msg('m0', A_LID, -3000, { body: 'Hello' }),
  msg('m1', A, -1500, { body: 'Is the Lake View tower still available?' }),
  msg('m2', A, -1499, { direction: 'OUT', body: 'Yes, a few units are open.', sender_name: 'AI Agent', status: 'READ', reply_to_message_id: 'm1' }),
  msg('m3', A, -30, { direction: 'OUT', type: 'image', caption: 'Floor plan', media_url: PNG, media_mime: 'image/png', media_name: 'plan.png', sender_name: 'Mina Manager', status: 'DELIVERED' }),
  msg('m4', A, -20, { type: 'document', media_url: 'https://files.example/brochure.pdf', media_mime: 'application/pdf', media_name: 'brochure.pdf', media_size: 482000 }),
  msg('m5', A, -10, { direction: 'OUT', body: 'Price list attached.', sender_name: 'Mina Manager', status: 'FAILED', error: 'Relay HTTP 500' }),
  msg('m6', A, -4, { body: 'Can I visit on Friday?' }),
];

export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const out = { steps: [] };
  const step = async (name, fn) => { try { await fn(); out.steps.push('ok ' + name); } catch (e) { out.steps.push('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]); } };

  const mock = await signInAs(page, 'MANAGEMENT', {
    wa_settings: (url, data, me) => [{ id: 'default', enabled: true, allowed_user_ids: [me.id], relay_url: '', session_name: 'demo-session', token_set: true, webhook_url: '', updated_at: iso(-100), updated_by: me.id }],
    wa_conversations: (url) => (Number(url.searchParams.get('offset')) > 0 ? [] : CONVS),
    wa_messages: (url) => {
      const q = decodeURIComponent(url.search);
      if (/wa_timestamp[=.]lt\./.test(q)) return []; // an older page: none
      const id = /conversation_id=eq\.([^&]+)/.exec(q)?.[1];
      return MSGS.filter((m) => m.conversation_id === id).slice().reverse(); // the app asks newest first
    },
    wa_bot_settings: [{ faq_agent_enabled: true, trainer_test_mode: false }],
    ai_handoffs: [],
  });

  // The send relay (an Edge Function by default). Registered after the mock, so
  // it wins for this URL; what the app posts is kept to assert on.
  const relay = [];
  await page.route(/\/functions\/v1\/wa-send/, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = req.postData(); }
    relay.push({ url: req.url(), headers: Object.keys(req.headers()), body });
    const ok = body?.action === 'send';
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ ok }) });
  });

  await step('menu shows Conversations for an allow-listed account', async () => {
    await tap(page, 'Menu');
    await tap(page, 'Conversations');
    await page.getByText('Rahim Ahmed 1').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    out.list = (await text(page)).slice(0, 700);
    await shot(page, 'chat-1-list');
  });
  await step('list: two rows (phone + LID threads folded), newest first, unread summed', async () => {
    const body = await text(page);
    out.listChecks = {
      twoThreads: body.includes('2 threads'),
      newestFirst: body.indexOf('Rahim Ahmed 1') < body.indexOf('Karim Dubai'),
      unreadSummed: (await page.getByLabel('3 unread').count()) > 0,
      adChip: body.includes('Lake View launch'),
      accountPicker: body.includes('Both') && body.includes('Dubai') && body.includes('Eyad'),
    };
  });
  await step('unread filter', async () => {
    await tap(page, 'Unread');
    out.unreadOnlyHidesKarim = !(await text(page)).includes('Karim Dubai');
    await tap(page, 'All');
  });
  await step('account filter', async () => {
    await tap(page, 'Dubai');
    const body = await text(page);
    out.dubaiOnly = body.includes('Karim Dubai') && !body.includes('Rahim Ahmed 1');
    await tap(page, 'Both');
  });
  await step('search', async () => {
    await page.getByPlaceholder('Search name, number or message').locator('visible=true').last().fill('brochure');
    await page.waitForTimeout(500);
    const body = await text(page);
    out.searchByPreview = body.includes('Karim Dubai') && !body.includes('Rahim Ahmed 1');
    await shot(page, 'chat-2-search');
    await page.getByPlaceholder('Search name, number or message').locator('visible=true').last().fill('');
    await page.waitForTimeout(300);
  });
  await step('open a thread: bubbles, separators, read marks', async () => {
    await tap(page, 'Rahim Ahmed 1');
    await page.getByText('Can I visit on Friday?').locator('visible=true').last().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    const body = await text(page);
    out.thread = body.slice(-900);
    out.threadChecks = {
      bothThreadsMerged: body.includes('Hello') && body.includes('Is the Lake View tower still available?'),
      daySeparators: body.includes('Today') && body.includes('Yesterday'),
      aiTag: body.includes('AI AGENT'),
      failedWithRetry: body.includes('Relay HTTP 500') && body.includes('Retry'),
      document: body.includes('brochure.pdf') && body.includes('PDF · 471 KB'),
      image: (await page.getByLabel('Open image').count()) > 0,
      readTick: (await page.getByLabel('Read', { exact: true }).count()) > 0,
      leadLink: body.includes('Open lead'),
      aiChip: body.includes('AI replies on'),
      via: body.includes('via Eyad WhatsApp'),
    };
    const reads = mock.writes.filter((w) => w.table === 'wa_conversations' && w.method === 'PATCH' && w.body?.unread_count === 0).map((w) => w.query);
    out.markedRead = { phoneThread: reads.some((q) => q.includes(A)), lidThread: reads.some((q) => q.includes(A_LID)) };
    await shot(page, 'chat-3-thread');
  });
  await step('send a text through the relay', async () => {
    const before = mock.writes.length;
    await page.getByLabel('Message').locator('visible=true').last().fill('Hello from the phone');
    await shot(page, 'chat-4-typed');
    await page.getByLabel('Send', { exact: true }).locator('visible=true').last().click();
    await page.getByText('Hello from the phone').locator('visible=true').last().waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    const w = mock.writes.slice(before);
    const row = w.find((x) => x.table === 'wa_messages' && x.method === 'POST')?.body?.[0];
    const sent = relay.filter((r) => r.body?.action === 'send');
    out.send = {
      messageRow: row && { conversation_id: row.conversation_id, direction: row.direction, status: row.status, body: row.body, sent_by: row.sent_by, hasClientRef: !!row.client_ref },
      threadBumped: w.some((x) => x.table === 'wa_conversations' && x.method === 'POST' && x.body?.[0]?.last_message_preview === 'Hello from the phone'),
      relayCalls: sent.length,
      relayUrl: sent[0]?.url.replace(/^https:\/\/[^/]+/, ''),
      relayBody: sent[0]?.body,
      clientRefMatches: !!row && sent[0]?.body?.clientRef === row.client_ref,
      composerCleared: (await page.getByLabel('Message').locator('visible=true').last().inputValue()) === '',
      pendingTick: (await page.getByLabel('Sending', { exact: true }).count()) > 0,
    };
    // Nothing secret may leave the app: only the anon key and the session token.
    out.relayHeaders = sent[0]?.headers.filter((h) => !['accept', 'accept-language', 'referer', 'user-agent', 'origin', 'content-length'].includes(h) && !h.startsWith('sec-'));
    await shot(page, 'chat-5-sent');
  });
  await step('retry the failed message', async () => {
    const before = mock.writes.length; const calls = relay.length;
    await tap(page, 'Retry');
    await page.waitForTimeout(1500);
    const w = mock.writes.slice(before);
    out.retry = {
      oldRowDeleted: w.some((x) => x.table === 'wa_messages' && x.method === 'DELETE' && x.query.includes('m5')),
      resent: relay.slice(calls).some((r) => r.body?.action === 'send' && r.body?.text === 'Price list attached.'),
      failedBubbleGone: !(await text(page)).includes('Relay HTTP 500'),
    };
    await shot(page, 'chat-6-retried');
  });
  await step('open the linked lead', async () => {
    await tap(page, 'Open lead');
    await page.getByText('ACTIONS').waitFor({ timeout: 15000 });
    out.leadOpened = (await text(page)).includes('Rahim Ahmed 1');
    await shot(page, 'chat-7-lead');
  });
  out.avatarLookups = relay.filter((r) => r.body?.action === 'get-avatar').length;
  return out;
}
