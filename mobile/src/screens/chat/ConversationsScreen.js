// The WhatsApp thread list: the phone version of ConversationsView.jsx +
// ChatList.jsx. Loading, the realtime socket and the access rules are the web's
// own (src/lib/wa.js); only the layout is new. A row opens ChatScreen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Badge, Button, Chip, Empty, Icon, Loading, Row, Screen, SearchField, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import {
  waLoadConversations, waSubscribe, waFetchAvatar, waCanChat, WA_ACCOUNTS, WA_ACCOUNT_LABEL,
} from '../../../../src/lib/wa.js';
import { ChatAvatar, fmtWhen, needsAvatar, rememberThread, useWaSettings, visibleThreads } from './shared';

const PAGE = 200;          // waLoadConversations' own page size
const AVATAR_PREFETCH = 8; // ConversationsView.jsx: enough for what is on screen, easy on the relay

function ThreadRow({ conv, onPress }) {
  const t = useTheme();
  const unread = conv.unreadCount > 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: t.card, borderRadius: radius.lg, padding: space.md, minHeight: 68, opacity: pressed ? 0.7 : 1 })}>
      <ChatAvatar conv={conv} />
      <View style={{ flex: 1, gap: 3 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="strong" numberOfLines={1} style={{ flex: 1, fontWeight: unread ? '700' : '600' }}>{conv.name || conv.phone}</T>
          <T v="small" tone={unread ? 'brand' : 'mute'}>{fmtWhen(conv.lastMessageAt)}</T>
        </Row>
        <Row gap={4}>
          {conv.lastMessageDir === 'OUT' ? <Icon name="reply" size={15} color={t.mute} /> : null}
          <T v="small" tone={unread ? undefined : 'sub'} numberOfLines={1} style={{ flex: 1 }}>{conv.lastMessagePreview || '-'}</T>
          {unread ? (
            <View accessibilityLabel={`${conv.unreadCount} unread`} style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
              <T v="tiny" color={t.onBrand}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</T>
            </View>
          ) : null}
        </Row>
        {conv.source === 'AD' ? <Badge icon="campaign" tone="info" label={conv.adMeta?.title ? conv.adMeta.title.slice(0, 28) : 'Ad click'} /> : null}
      </View>
    </Pressable>
  );
}

export default function ConversationsScreen({ navigation }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const settings = useWaSettings(user);
  const chatOk = !!settings && !settings.failed && waCanChat(user, settings);

  const [convs, setConvs] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [loadErr, setLoadErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [connState, setConnState] = useState('connecting');

  const [q, setQ] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [account, setAccount] = useState('all');

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Missing profile photos, one request at a time with a short gap; each thread
  // is tried once per visit (ConversationsView.jsx backfillAvatars).
  const triedAvatars = useRef(new Set());
  const backfillAvatars = useCallback(async (list) => {
    const targets = list.filter((c) => needsAvatar(c) && !triedAvatars.current.has(c.id)).slice(0, AVATAR_PREFETCH);
    for (const c of targets) {
      if (!alive.current) return;
      triedAvatars.current.add(c.id);
      const res = await waFetchAvatar(c);
      if (!alive.current) return;
      if (res.ok) setConvs((prev) => prev.map((x) => (x.id === c.id ? { ...x, avatarUrl: res.avatarUrl } : x)));
      await new Promise((r) => setTimeout(r, 1200));
    }
  }, []);

  const fetchConvs = useCallback(async () => {
    try {
      const list = await waLoadConversations();
      if (!alive.current) return;
      setConvs(list); setCanLoadMore(list.length >= PAGE); setLoadErr(''); setState('ready');
      backfillAvatars(list);
    } catch (e) {
      if (!alive.current) return;
      // Keep what is on screen: a failed refresh is not "no conversations".
      setLoadErr(e.message || 'Could not load conversations.');
      setState((s) => (s === 'loading' ? 'error' : s));
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, [backfillAvatars]);

  // First load, and again each time the page comes back into view (a thread
  // read in ChatScreen has lost its badge by then).
  useEffect(() => {
    if (!chatOk) return undefined;
    fetchConvs();
    return navigation.addListener('focus', fetchConvs);
  }, [chatOk, fetchConvs, navigation]);

  // Live changes, through the web's own socket (ConversationsView.jsx). No
  // thread is open on this page, so an inbound message always counts as unread.
  useEffect(() => {
    if (!chatOk) return undefined;
    return waSubscribe({
      onState: setConnState,
      onMessage: (m) => {
        setConvs((prev) => {
          const i = prev.findIndex((c) => c.id === m.conversationId);
          if (i === -1) { fetchConvs(); return prev; } // first message of a brand-new thread
          const c = prev[i];
          const next = prev.slice();
          next[i] = {
            ...c,
            lastMessageAt: m.waTimestamp,
            lastMessagePreview: m.type === 'text' ? m.body : (m.mediaName || m.type),
            lastMessageDir: m.direction,
            unreadCount: m.direction === 'IN' ? (c.unreadCount || 0) + 1 : c.unreadCount,
          };
          return next;
        });
      },
      onConversation: (c) => {
        setConvs((prev) => {
          const i = prev.findIndex((x) => x.id === c.id);
          if (i === -1) return [c, ...prev];
          const next = prev.slice();
          next[i] = c;
          return next;
        });
      },
    });
  }, [chatOk, fetchConvs]);

  const loadMore = async () => {
    if (!canLoadMore || loadingMore || state !== 'ready') return;
    setLoadingMore(true);
    try {
      const more = await waLoadConversations({ offset: convs.length });
      if (!alive.current) return;
      setConvs((prev) => { const seen = new Set(prev.map((c) => c.id)); return [...prev, ...more.filter((c) => !seen.has(c.id))]; });
      if (more.length < PAGE) setCanLoadMore(false);
    } catch (e) {
      if (alive.current) setLoadErr(e.message || 'Could not load more conversations.');
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  // dbVersion: the "assigned to me" filter reads the lead cache.
  const visible = useMemo(() => { void dbVersion; return visibleThreads(convs, user); }, [convs, user, dbVersion]);

  // ChatList.jsx: the number picker shows only when there is more than one.
  const accountCounts = useMemo(() => {
    const m = {};
    for (const c of visible) m[c.account] = (m[c.account] || 0) + 1;
    return m;
  }, [visible]);
  const accounts = WA_ACCOUNTS.filter((a) => accountCounts[a]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return visible
      .filter((c) => account === 'all' || c.account === account)
      .filter((c) => !onlyUnread || c.unreadCount > 0)
      .filter((c) => !ql
        || (c.name || '').toLowerCase().includes(ql)
        || (c.phone || '').includes(ql)
        || (c.lastMessagePreview || '').toLowerCase().includes(ql))
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
  }, [visible, q, onlyUnread, account]);

  const scoped = account === 'all' ? visible : visible.filter((c) => c.account === account);
  const totalUnread = scoped.reduce((s, c) => s + (c.unreadCount || 0), 0);

  if (!settings) return <Screen><Loading label="Loading conversations…" /></Screen>;
  if (settings.failed) return <Screen><Empty icon="cloud-off" title="Could not load chat settings" hint="Check the connection and open this page again." /></Screen>;
  if (!chatOk) {
    return (
      <Screen>
        <Empty icon="lock" title="Conversations isn't enabled for your account" hint="Ask an administrator to grant chat access from Chat Settings." />
      </Screen>
    );
  }

  const open = (c) => { rememberThread(c); navigation.navigate('Chat', { conversationId: c.id }); };

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.md, paddingHorizontal: space.lg }}>
      <SearchField value={q} onChangeText={setQ} placeholder="Search name, number or message" />
      <Row wrap>
        <Chip label="All" active={!onlyUnread} onPress={() => setOnlyUnread(false)} />
        <Chip label="Unread" count={totalUnread > 0 ? totalUnread : undefined} active={onlyUnread} onPress={() => setOnlyUnread(true)} />
      </Row>
      {accounts.length > 1 ? (
        <Row wrap>
          <Chip label="Both" count={visible.length} active={account === 'all'} onPress={() => setAccount('all')} />
          {accounts.map((a) => (
            <Chip key={a} label={(WA_ACCOUNT_LABEL[a] || a).replace(' WhatsApp', '')} count={accountCounts[a]} active={account === a} onPress={() => setAccount(a)} />
          ))}
        </Row>
      ) : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="small" tone="mute">{state === 'ready' ? `${visible.length} thread${visible.length === 1 ? '' : 's'}` : ' '}</T>
        {connState !== 'online' ? (
          <Row gap={4}>
            <Icon name="cloud-off" size={14} color={t.mute} />
            <T v="small" tone="mute">{connState === 'connecting' ? 'Connecting…' : connState === 'error' ? 'Live updates rejected' : 'Reconnecting…'}</T>
          </Row>
        ) : null}
      </Row>
      {loadErr && state === 'ready' ? <T v="small" tone="danger">{loadErr}</T> : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={state === 'ready' ? rows : []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <ThreadRow conv={item} onPress={() => open(item)} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={state === 'loading' ? <Loading label="Loading conversations…" />
          : state === 'error' ? <Empty icon="cloud-off" title="Could not load conversations" hint={loadErr} action={<Button label="Retry" variant="ghost" full={false} onPress={() => { setState('loading'); fetchConvs(); }} />} />
          : q || onlyUnread ? <Empty icon="chat-bubble-outline" title="No conversation matches" />
          : <Empty icon="chat-bubble-outline" title="No conversations yet" hint="Incoming WhatsApp messages will appear here." />}
        ListFooterComponent={loadingMore ? <Loading /> : <View style={{ height: space.xl }} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchConvs(); }} tintColor={t.brand} />}
      />
    </Screen>
  );
}
