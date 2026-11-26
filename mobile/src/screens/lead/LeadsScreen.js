// The lead list. It asks the server for one page at a time through the same
// queryLeads() the web list uses, with the same query options, so the phone and
// the web show the same set for the same filter (src/lib/leadQuery.js).
// Scrolling to the end loads the next page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Avatar, Badge, ChipBar, Empty, Icon, Loading, Row, Screen, SearchField, Segmented, StatusBadge, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { queryLeads, userNameById } from '../../../../src/lib/db.js';
import { ROLES, STATUS_LABELS, effectiveRole, canSee } from '../../../../src/lib/constants.js';
import { fmtRel, fmtDT } from '../../../../src/lib/helpers.js';

const PAGE = 20;
const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All' }, { value: 'FOLLOW_UP', label: 'Follow-up' }, { value: 'FORWARDED', label: 'Forwarded' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];
const SORTS = [{ value: 'newest', label: 'Newest' }, { value: 'updated', label: 'Recently updated' }, { value: 'oldest', label: 'Oldest' }];

export function LeadRow({ lead, onPress, showOwner }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: t.card, borderRadius: radius.lg, padding: space.md, opacity: pressed ? 0.7 : 1 })}>
      <Avatar name={lead.name || lead.phone} />
      <View style={{ flex: 1, gap: 3 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="strong" numberOfLines={1} style={{ flex: 1 }}>{lead.name || 'Unnamed customer'}</T>
          <T v="small" tone="mute">{fmtRel(lead.updatedAt || lead.createdAt)}</T>
        </Row>
        <T v="small" tone="sub" numberOfLines={1}>{[lead.phone, lead.propertyInterest].filter(Boolean).join('  ·  ')}</T>
        <Row wrap>
          <StatusBadge lead={lead} />
          {lead.nextFollowup ? <Badge label={fmtDT(lead.nextFollowup)} tone="warn" icon="alarm" /> : null}
          {showOwner ? <T v="small" tone="mute" numberOfLines={1}>{userNameById(lead.assignedTo, lead.assignedToName) || 'Unassigned'}</T> : null}
        </Row>
      </View>
      <Icon name="chevron-right" color={t.mute} />
    </Pressable>
  );
}

export default function LeadsScreen({ navigation, route }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const role = effectiveRole(user);
  const isAgent = role === ROLES.AGENT;
  // A dashboard card opens the list already narrowed: { kpi, kpiArg, status, title, extra, involved }.
  const preset = route.params?.preset || null;

  const [tab, setTab] = useState('mine');
  const [status, setStatus] = useState(preset?.status || 'ALL');
  const [sort, setSort] = useState('newest');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const id = setTimeout(() => setSearch(typed.trim()), 300); return () => clearTimeout(id); }, [typed]);

  const query = useMemo(() => ({
    user,
    involved: preset?.involved ?? true,
    ownTab: !preset && isAgent ? tab : undefined,
    status,
    search,
    ...(preset?.kpi ? { kpi: preset.kpi, kpiArg: preset.kpiArg } : {}),
    ...(preset?.extra ? { extra: preset.extra } : {}),
    ...(preset?.dateField ? { dateField: preset.dateField } : {}),
    ...(preset?.start ? { start: preset.start, end: preset.end } : {}),
    ...(preset?.agentId ? { agentId: preset.agentId } : {}),
    ...(preset?.teamId ? { teamId: preset.teamId } : {}),
  }), [user, isAgent, tab, status, search, preset]);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | more | error
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const pageRef = useRef(0);

  const loadFirst = useCallback(async () => {
    const mine = ++seq.current;
    const res = await queryLeads(query, { page: 0, size: PAGE, sort });
    if (mine !== seq.current) return;
    setRefreshing(false);
    // null = the request failed: keep what is on screen instead of claiming "none".
    if (!res) { setState((s) => (s === 'loading' ? 'error' : 'ready')); return; }
    pageRef.current = 0;
    setRows(res.rows); setTotal(res.total); setState('ready');
  }, [query, sort]);

  // A new filter clears the list; a data change (dbVersion) refreshes it in place.
  useEffect(() => { setState('loading'); setRows([]); setTotal(null); }, [query, sort]);
  useEffect(() => { loadFirst(); }, [loadFirst, dbVersion]);

  const loadMore = async () => {
    if (state !== 'ready' || total == null || rows.length >= total) return;
    const mine = seq.current;
    setState('more');
    const next = pageRef.current + 1;
    const res = await queryLeads(query, { page: next, size: PAGE, sort });
    if (mine !== seq.current) return;
    if (res) {
      pageRef.current = next;
      setRows((prev) => { const seen = new Set(prev.map((r) => r.id)); return [...prev, ...res.rows.filter((r) => !seen.has(r.id))]; });
      setTotal(res.total);
    }
    setState('ready');
  };

  useEffect(() => {
    navigation.setOptions({
      title: preset?.title || 'Leads',
      headerRight: () => (!preset && canSee(user, 'add_customer') ? (
        <Pressable onPress={() => navigation.navigate('AddLead')} accessibilityRole="button" accessibilityLabel="Add customer" hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand }}>
          <Icon name="add" color={t.onBrand} />
        </Pressable>
      ) : null),
    });
  }, [navigation, preset, user, t]);

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.md }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <SearchField value={typed} onChangeText={setTyped} placeholder="Name, phone or project" />
        {!preset && isAgent ? <Segmented options={[{ value: 'mine', label: 'My leads' }, { value: 'fwd', label: 'Forwarded' }]} value={tab} onChange={setTab} /> : null}
      </View>
      <ChipBar options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg }}>
        <T v="small" tone="mute">{total == null ? ' ' : `${total} customer${total === 1 ? '' : 's'}`}</T>
        <Pressable onPress={() => setSort(SORTS[(SORTS.findIndex((s) => s.value === sort) + 1) % SORTS.length].value)} accessibilityRole="button" hitSlop={8}>
          <Row gap={4}><Icon name="swap-vert" size={16} color={t.sub} /><T v="small" tone="sub">{SORTS.find((s) => s.value === sort).label}</T></Row>
        </Pressable>
      </Row>
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <LeadRow lead={item} showOwner={!isAgent} onPress={() => navigation.navigate('LeadDetail', { leadId: item.id })} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={state === 'loading' ? <Loading label="Loading leads…" />
          : state === 'error' ? <Empty icon="cloud-off" title="Could not load leads" hint="Check the connection and pull down to try again." />
          : <Empty title="No leads here" hint="Nothing matches. Try another word or status." />}
        ListFooterComponent={state === 'more' ? <Loading /> : <View style={{ height: space.xl }} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFirst(); }} tintColor={t.brand} />}
      />
    </Screen>
  );
}
