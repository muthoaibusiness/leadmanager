// One WhatsApp thread: the phone version of ConversationsView.jsx (open thread),
// ChatThread.jsx, MessageBubble.jsx and the text half of ChatComposer.jsx.
// Opened two ways, like the web:
//   { conversationId }   from the Conversations list (ConversationsView.jsx)
//   { leadId, phone? }   from a lead (LeadChatModal.jsx and its `chatTarget`)
// Every read, the send (through the server relay; the app holds no WhatsApp
// token), the read marks and the realtime socket are src/lib/wa.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Badge, Button, Empty, Icon, Loading, Row, Screen, T, useUI } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { getLead, ensureLead } from '../../../../src/lib/db.js';
import {
  waLoadConversations, waLoadMessages, waMarkRead, waSendMessage, waRetry, waSubscribe, waAiState,
  waFindOrCreateConversation, waCanChat, mergeStatus, isLeadAssignedOrForwardedTo, WA_ACCOUNT_LABEL,
} from '../../../../src/lib/wa.js';
import { mergeThreads } from '../../../../src/lib/waGroup.js';
import { senderDisplayTag } from '../../../../src/lib/senderTag.js';
import { dayLabel, docIcon, fmtSize, fmtTime, leadOfThread, recallThread, useWaSettings, visibleThreads } from './shared';

const PAGE = 300;      // waLoadMessages' own page size; a full page means there may be older ones
const LIST_PAGE = 200; // waLoadConversations' page size
const IMG = 220;

// MessageBubble.jsx TICK: one tick sent, two delivered, two accented read, a
// clock while the relay has not confirmed, a warning on failure.
const TICK = {
  PENDING: { icon: 'schedule', label: 'Sending' },
  SENT: { icon: 'done', label: 'Sent' },
  DELIVERED: { icon: 'done-all', label: 'Delivered' },
  READ: { icon: 'done-all', label: 'Read' },
  FAILED: { icon: 'error-outline', label: 'Failed to send' },
};

const openUrl = (url) => Linking.openURL(url).catch(() => {});

function Bubble({ msg, replyTo, onRetry }) {
  const t = useTheme();
  const [imgErr, setImgErr] = useState(false);
  const out = msg.direction === 'OUT';
  const failed = msg.status === 'FAILED';
  const tick = TICK[msg.status] || TICK.SENT;
  const tickColor = failed ? t.danger : msg.status === 'READ' ? t.info : msg.status === 'PENDING' ? t.mute : t.sub;
  // Media carries its text in `caption`; a plain text message uses `body`.
  const text = msg.type === 'text' ? msg.body : msg.caption;
  const replySnippet = replyTo ? ((replyTo.type === 'text' ? replyTo.body : replyTo.caption) || 'Media').slice(0, 60) : null;
  const isFile = msg.type === 'document' || msg.type === 'video' || msg.type === 'audio';

  return (
    <View style={{ flexDirection: 'row', justifyContent: out ? 'flex-end' : 'flex-start', paddingHorizontal: space.md, paddingVertical: 3 }}>
      <View style={{
        maxWidth: '82%', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg,
        borderBottomRightRadius: out ? radius.sm / 2 : radius.lg, borderBottomLeftRadius: out ? radius.lg : radius.sm / 2,
        backgroundColor: out ? t.brandSoft : t.card, borderWidth: 1, borderColor: failed ? t.danger : out ? t.brandSoft : t.line,
      }}>
        {out && msg.senderName ? <T v="tiny" tone="brand">{senderDisplayTag(msg.senderName)}</T> : null}

        {replySnippet ? (
          <Row gap={4} style={{ borderLeftWidth: 3, borderLeftColor: t.brand, paddingLeft: space.sm }}>
            <Icon name="reply" size={14} color={t.sub} />
            <T v="small" tone="sub" numberOfLines={1} style={{ flexShrink: 1 }}>{replySnippet}</T>
          </Row>
        ) : null}

        {msg.type === 'image' && msg.mediaUrl && !imgErr ? (
          <Pressable onPress={() => openUrl(msg.mediaUrl)} accessibilityRole="imagebutton" accessibilityLabel="Open image">
            <Image source={{ uri: msg.mediaUrl }} onError={() => setImgErr(true)} resizeMode="cover"
              style={{ width: IMG, height: IMG, maxWidth: '100%', borderRadius: radius.md, backgroundColor: t.line }} />
          </Pressable>
        ) : null}
        {msg.type === 'image' && (!msg.mediaUrl || imgErr) ? (
          <Row gap={6}><Icon name="broken-image" size={18} color={t.mute} /><T v="small" tone="mute">Image unavailable</T></Row>
        ) : null}

        {isFile ? (msg.mediaUrl ? (
          <Pressable onPress={() => openUrl(msg.mediaUrl)} accessibilityRole="button" accessibilityLabel={`Open ${msg.mediaName || msg.type}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, minWidth: 200, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={msg.type === 'document' ? docIcon(msg.mediaMime, msg.mediaName) : msg.type === 'video' ? 'movie' : 'graphic_eq'} size={20} color={t.sub} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="strong" numberOfLines={1}>{msg.mediaName || msg.type}</T>
              <T v="small" tone="mute" numberOfLines={1}>{[msg.mediaMime?.split('/')[1]?.toUpperCase(), fmtSize(msg.mediaSize)].filter(Boolean).join(' · ') || 'Tap to open'}</T>
            </View>
            <Icon name="download" size={18} color={t.sub} />
          </Pressable>
        ) : (
          <Row gap={6}><Icon name="attach-file" size={18} color={t.mute} /><T v="small" tone="mute">Attachment unavailable</T></Row>
        )) : null}

        {text ? <T selectable>{text}</T> : null}

        <Row gap={4} style={{ alignSelf: 'flex-end' }}>
          <T v="tiny" tone="mute" style={{ fontWeight: '400', letterSpacing: 0 }}>{fmtTime(msg.waTimestamp)}</T>
          {out ? <View accessibilityLabel={tick.label}><Icon name={tick.icon} size={15} color={tickColor} /></View> : null}
        </Row>

        {failed ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="small" tone="danger" style={{ flex: 1 }} numberOfLines={3}>{msg.error ? msg.error.slice(0, 90) : 'Not delivered'}</T>
            <Button label="Retry" icon="refresh" variant="soft" tone="danger" small full={false} onPress={() => onRetry(msg)} />
          </Row>
        ) : null}
      </View>
    </View>
  );
}

function DaySeparator({ label }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.sm }}>
      <View style={{ backgroundColor: t.line, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 }}>
        <T v="tiny" tone="sub">{label}</T>
      </View>
    </View>
  );
}

export default function ChatScreen({ navigation, route }) {
  const { conversationId = null, leadId = null, phone = null } = route.params || {};
  const { user, dbVersion, refresh } = useApp();
  const t = useTheme();
  const { toast } = useUI();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const settings = useWaSettings(user);
  const settingsReady = !!settings;
  const fromLead = !conversationId && !!(leadId || phone);

  const [conv, setConv] = useState(null);
  const [gate, setGate] = useState('loading'); // loading | ready | denied | restricted | error
  const [err, setErr] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [msgs, setMsgs] = useState([]); // oldest → newest, as wa.js returns them
  const [older, setOlder] = useState({ cursor: null, id: null, has: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [aiState, setAiState] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // Realtime callbacks are registered once, so they read live values via refs.
  const membersRef = useRef(new Set());
  const memberIds = useMemo(() => (conv ? (conv.memberIds?.length ? conv.memberIds : [conv.id]) : []), [conv]);
  useEffect(() => { membersRef.current = new Set(memberIds); }, [memberIds]);
  const memberKey = memberIds.join('|');

  // ── which thread ──────────────────────────────────────────────────────────
  const chatOk = settingsReady && !settings.failed && waCanChat(user, settings);
  useEffect(() => {
    let alive = true;
    const fail = (message) => { if (alive) { setErr(message); setGate('error'); } };
    (async () => {
      setGate('loading'); setConv(null); setMsgs([]);
      let c = null;
      if (conversationId) {
        // The Conversations page is behind the chat allow-list (waCanChat).
        if (!settingsReady) return;
        if (!chatOk) { setGate(settings.failed ? 'error' : 'denied'); setErr('Could not load chat settings.'); return; }
        c = recallThread(conversationId);
        // Opened without the list (a link, a notification): find it the way the
        // list would, so the "assigned to me" rule and the one-row-per-customer
        // grouping apply here too.
        for (let offset = 0, all = []; !c && offset < LIST_PAGE * 5; offset += LIST_PAGE) {
          const page = await waLoadConversations({ offset });
          if (!alive) return;
          all = all.concat(page);
          c = visibleThreads(all, user).find((x) => x.id === conversationId || x.memberIds.includes(conversationId)) || null;
          if (page.length < LIST_PAGE) break;
        }
        if (!c) return fail('This conversation is not available to your account.');
      } else if (fromLead) {
        // LeadChatModal.jsx: the lead's own thread, on the number the team rule
        // picks, created when there is none yet.
        if (leadId && !getLead(leadId)) await ensureLead(leadId).catch(() => false);
        if (!alive) return;
        const lead = leadId ? getLead(leadId) : null;
        if (leadId && !lead) return fail('This customer could not be loaded.');
        const target = lead ? (phone ? { ...lead, phone } : lead) : { phone, name: '' };
        if (!isLeadAssignedOrForwardedTo(target, user)) { setGate('restricted'); return; }
        const res = await waFindOrCreateConversation(target, user);
        if (!alive) return;
        if (!res.ok || !res.conversation) return fail(res.error || 'Could not find or open chat for this lead.');
        c = { ...res.conversation, memberIds: [res.conversation.id] };
      } else {
        return fail('No conversation was given.');
      }

      // A customer who reached us on two threads reads as one conversation.
      const ids = c.memberIds?.length ? c.memberIds : [c.id];
      const lists = await Promise.all(ids.map((id) => waLoadMessages(id)));
      if (!alive) return;
      const list = mergeThreads(lists);
      setConv(c); setMsgs(list);
      setOlder({ cursor: list[0]?.waTimestamp || null, id: list[0]?.id || null, has: lists.some((l) => l.length >= PAGE) });
      setGate('ready');
      if (c.unreadCount > 0) ids.forEach((id) => waMarkRead(id));
    })().catch((e) => fail(e?.message || 'Could not load that conversation.'));
    return () => { alive = false; };
    // settings is read only once it has arrived (settingsReady / chatOk).
    // Keyed on the account id: a fresh user object for the same account must not reload the thread.
  }, [conversationId, leadId, phone, fromLead, user?.id, settingsReady, chatOk, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the CRM record behind the thread ──────────────────────────────────────
  const lead = useMemo(() => { void dbVersion; return (fromLead && leadId ? getLead(leadId) : null) || leadOfThread(conv); }, [conv, fromLead, leadId, dbVersion]);
  // The lead cache holds only what has been looked at: fetch the linked one.
  const linkedId = conv?.leadId || null;
  useEffect(() => {
    if (!linkedId || getLead(linkedId)) return;
    ensureLead(linkedId).then((changed) => { if (changed) refresh(); }).catch(() => {});
  }, [linkedId, refresh]);

  // AI reply / takeover state of the open thread (read-only, as on the web).
  const convId = conv?.id || null;
  useEffect(() => {
    if (!convId) return undefined;
    let alive = true;
    waAiState(convId).then((s) => { if (alive) setAiState({ convId, ...s }); }).catch(() => {});
    return () => { alive = false; };
  }, [convId]);

  useEffect(() => { navigation.setOptions({ title: conv ? (conv.name || conv.phone || 'Chat') : lead?.name || 'Chat' }); }, [navigation, conv, lead]);

  // ── live updates ──────────────────────────────────────────────────────────
  const mergeIn = useCallback((incoming) => {
    setMsgs((prev) => {
      let next = prev;
      for (const m of incoming) {
        const i = next.findIndex((x) => x.id === m.id);
        if (next === prev) next = prev.slice();
        if (i === -1) next.push(m);
        else next[i] = { ...m, status: mergeStatus(next[i].status, m.status) };
      }
      return next === prev ? prev : mergeThreads([next]);
    });
  }, []);

  useEffect(() => {
    if (!memberKey) return undefined;
    return waSubscribe({
      onMessage: (m) => {
        if (!membersRef.current.has(m.conversationId)) return;
        mergeIn([m]);
        if (m.direction === 'IN') waMarkRead(m.conversationId);
      },
      // A thread first known by its LID gains its phone number later; sending needs it.
      onConversation: (c) => { setConv((prev) => (prev && prev.id === c.id ? { ...prev, ...c, memberIds: prev.memberIds, unreadCount: 0 } : prev)); },
    });
  }, [memberKey, mergeIn]);

  // Back from the background: the socket was cut while the phone slept, so
  // re-read the newest page and fold it in.
  useEffect(() => {
    if (!memberKey) return undefined;
    const ids = memberKey.split('|');
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      Promise.all(ids.map((id) => waLoadMessages(id))).then((lists) => {
        const fresh = lists.flat();
        mergeIn(fresh);
        if (fresh.some((m) => m.direction === 'IN')) ids.forEach((id) => waMarkRead(id));
      }).catch(() => {});
    });
    return () => sub.remove();
  }, [memberKey, mergeIn]);

  // ── older pages (keyset on wa_timestamp + id, as ConversationsView.jsx) ────
  const loadOlder = async () => {
    if (!conv || !older.has || !older.cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const pages = await Promise.all(memberIds.map((id) => waLoadMessages(id, { before: older.cursor, beforeId: older.id })));
      const page = mergeThreads(pages);
      setMsgs((prev) => { const seen = new Set(prev.map((m) => m.id)); return mergeThreads([page.filter((m) => !seen.has(m.id)), prev]); });
      const oldest = page[0] || null;
      setOlder({
        cursor: oldest ? oldest.waTimestamp : older.cursor, id: oldest ? oldest.id : older.id,
        has: !!oldest && pages.some((p) => p.length >= PAGE),
      });
    } catch {
      toast('Could not load earlier messages.', 'err');
    } finally {
      setLoadingOlder(false);
    }
  };

  // ── send / retry ──────────────────────────────────────────────────────────
  // The send endpoint is fixed at build time (WA_RELAY_URL), so it is never missing.
  const disabledReason = settings?.failed ? 'Chat settings could not be loaded.'
    : !settings?.enabled ? 'Chat is switched off in Chat Settings.'
    : !conv ? 'Preparing conversation…'
    : '';

  const send = async () => {
    const body = text.trim();
    if (disabledReason || busy || !body || !conv) return;
    setBusy(true);
    try {
      const res = await waSendMessage(settings, { conversation: conv, user, type: 'text', body });
      if (res.optimistic) setMsgs((prev) => (prev.some((m) => m.id === res.optimistic.id) ? prev : [...prev, res.optimistic]));
      if (!res.ok) {
        setMsgs((prev) => prev.map((m) => (m.id === res.optimistic?.id ? { ...m, status: 'FAILED', error: res.error } : m)));
        toast(res.error || 'Message failed to send.', 'err');
      }
      setText('');
    } catch (e) {
      // Nothing was saved (the first write failed): keep the text to send again.
      toast(e?.message ? `Message failed to send. ${e.message}`.slice(0, 120) : 'Message failed to send.', 'err');
    } finally {
      setBusy(false);
    }
  };

  const retry = async (msg) => {
    if (!conv || disabledReason) return;
    setMsgs((prev) => prev.filter((m) => m.id !== msg.id));
    try {
      const res = await waRetry(settings, msg, conv, user);
      if (res.optimistic) setMsgs((prev) => [...prev, res.optimistic]);
      if (!res.ok) {
        setMsgs((prev) => prev.map((m) => (m.id === res.optimistic?.id ? { ...m, status: 'FAILED', error: res.error } : m)));
        toast(res.error || 'Retry failed.', 'err');
      }
    } catch {
      setMsgs((prev) => (prev.some((m) => m.id === msg.id) ? prev : mergeThreads([prev, [msg]])));
      toast('Retry failed.', 'err');
    }
  };

  // The list is inverted (newest at the bottom, scrolling up reaches older
  // messages), so it takes the transcript newest first. A day separator goes
  // above the first message of each day (ChatThread.jsx).
  const items = useMemo(() => {
    const byId = new Map(msgs.map((m) => [m.id, m]));
    let prevDay = '';
    return msgs.map((m) => {
      const day = dayLabel(m.waTimestamp);
      const sep = day !== prevDay ? day : null;
      prevDay = day;
      return { m, sep, replyTo: m.replyToMessageId ? byId.get(m.replyToMessageId) || null : null };
    }).reverse();
  }, [msgs]);

  // ── gates ─────────────────────────────────────────────────────────────────
  if (gate === 'denied') {
    return <Screen><Empty icon="lock" title="Conversations isn't enabled for your account" hint="Ask an administrator to grant chat access from Chat Settings." /></Screen>;
  }
  if (gate === 'restricted') {
    return <Screen><Empty icon="lock" title="Restricted access" hint="You can only view and participate in chats for leads that are assigned or forwarded to you." /></Screen>;
  }
  if (gate === 'error') {
    return (
      <Screen>
        <Empty icon="error-outline" title="Could not open the chat" hint={err}
          action={<Button label="Try again" icon="refresh" variant="ghost" full={false} onPress={() => setAttempt((n) => n + 1)} />} />
      </Screen>
    );
  }
  if (gate === 'loading' || !conv) return <Screen><Loading label="Loading conversation…" /></Screen>;

  const ai = aiState && aiState.convId === conv.id ? aiState : null;
  const aiLabel = !ai ? null
    : ai.takeover ? 'Human takeover. AI paused'
    : ai.repliesOn === false ? 'AI replies off'
    : ai.repliesOn ? (ai.trainerTest ? 'AI Trainer on' : 'AI replies on')
    : 'AI state: global';

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm, backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.line }}>
          <Row wrap>
            <T v="small" tone="sub">{conv.phone}</T>
            <Badge icon="send" tone={conv.account === 'dubai' ? 'info' : 'brand'} label={`via ${WA_ACCOUNT_LABEL[conv.account] || 'WhatsApp'}`} />
            {conv.source === 'AD' ? <Badge icon="campaign" tone="info" label="From ad" /> : null}
            {aiLabel ? <Badge icon="smart-toy" label={aiLabel} tone={ai.takeover ? 'warn' : 'neutral'} /> : null}
          </Row>
          {lead ? (
            <Pressable onPress={() => navigation.navigate('LeadDetail', { leadId: lead.id })} accessibilityRole="button" accessibilityLabel={`Open lead ${lead.name || ''}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
              <Icon name="link" size={18} color={t.brand} />
              <T v="strong" tone="brand" numberOfLines={1} style={{ flex: 1 }}>{lead.name || 'Unnamed customer'}</T>
              <T v="small" tone="sub">Open lead</T>
              <Icon name="chevron-right" size={20} color={t.mute} />
            </Pressable>
          ) : null}
        </View>

        {items.length ? (
          <FlatList
            inverted
            data={items}
            keyExtractor={(it) => it.m.id}
            renderItem={({ item }) => (
              <View>
                {item.sep ? <DaySeparator label={item.sep} /> : null}
                <Bubble msg={item.m} replyTo={item.replyTo} onRetry={retry} />
              </View>
            )}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: space.sm }}
            // Inverted: the footer is the top of the transcript.
            ListFooterComponent={loadingOlder ? <Loading label="Loading earlier messages…" /> : null}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Empty icon="waving-hand" title="No messages yet" hint="Send the first message to start this conversation." />
          </View>
        )}

        <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.sm), backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.line }}>
          {disabledReason ? (
            <Row style={{ minHeight: 44, justifyContent: 'center' }}>
              <Icon name="lock" size={18} color={t.mute} />
              <T v="small" tone="mute">{disabledReason}</T>
            </Row>
          ) : (
            <Row style={{ alignItems: 'flex-end' }}>
              <TextInput
                value={text}
                onChangeText={setText}
                editable={!busy}
                multiline
                placeholder="Type a message"
                placeholderTextColor={t.mute}
                accessibilityLabel="Message"
                style={{ flex: 1, minHeight: 44, maxHeight: 132, paddingHorizontal: space.md, paddingTop: 11, paddingBottom: 11, borderRadius: 22, borderWidth: 1, borderColor: t.line, backgroundColor: t.input, color: t.text, fontSize: 16, lineHeight: 21 }}
              />
              <Pressable onPress={send} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: busy || !text.trim() }}
                style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand, opacity: busy || !text.trim() ? 0.45 : pressed ? 0.75 : 1 })}>
                <Icon name={busy ? 'hourglass-top' : 'send'} size={20} color={t.onBrand} />
              </Pressable>
            </Row>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
