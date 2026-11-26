// Users & accounts: the company roster. Port of the web
// src/components/views/AccountsView.jsx (Users tab): the same company sandbox,
// counts, role and team filters, search and sort orders. A row opens the
// account (AccountFormScreen), which holds what the web splits between the
// View card, the Edit modal, the Delete modal and the Access tab.
//
// Not on the phone: bulk create and paste, CSV/JSON export, multi-select
// remove and the Appearance tab. The web page has no team create/rename; a
// team is made by creating its Team Lead, so there is none here either.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Avatar, Badge, Button, ChipBar, Empty, Icon, Row, Screen, SearchField, Stat, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { getDB } from '../../../../src/lib/db.js';
import { ROLES, canSee } from '../../../../src/lib/constants.js';
import { rlabel } from '../../../../src/lib/helpers.js';

// Copied from AccountsView.jsx (module constants there, not in src/lib).
const ROLE_FILTER_OPTS = [
  { v: ROLES.AGENT, l: 'Agent' }, { v: ROLES.MA, l: 'Meeting Agent' }, { v: ROLES.TL, l: 'Team Lead' },
  { v: ROLES.MGMT, l: 'Management' }, { v: ROLES.EXEC, l: 'Executive' },
];
const ROLE_ORDER = { TEAM_LEAD: 0, AGENT: 1, MEETING_AGENT: 1, EXECUTIVE: 2, MANAGEMENT: 3 };
const SENIORITY = { MANAGEMENT: 0, TEAM_LEAD: 1, AGENT: 2, MEETING_AGENT: 2, EXECUTIVE: 3 };
const SORT_OPTS = [
  { value: 'team', label: 'Team' }, { value: 'name', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' }, { value: 'role', label: 'Role' },
];
const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
const nAccounts = (n) => `${n} account${n === 1 ? '' : 's'}`;
export const ROLE_TONE = { MANAGEMENT: 'purple', TEAM_LEAD: 'info', AGENT: 'brand', MEETING_AGENT: 'brand', EXECUTIVE: 'warn', MASTER: 'purple' };

export default function AccountsScreen({ navigation }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [sort, setSort] = useState('team');
  const allowed = canSee(user, 'accounts');

  // Company sandbox, as on the web: an admin only ever sees their own company
  // (a missing companyId is tolerated so unsynced rows do not disappear).
  const { coUsers, teams, teamOf } = useMemo(() => {
    const db = getDB();
    const sameCo = (x) => !user.companyId || !x || x === user.companyId;
    const us = db.users.filter((u) => sameCo(u.companyId) && u.role !== ROLES.MASTER);
    const ts = (db.teams || []).filter((x) => sameCo(x.companyId));
    const teamById = Object.fromEntries(ts.map((x) => [x.id, x]));
    const teamByLead = Object.fromEntries(ts.map((x) => [x.leadId, x]));
    // A Team Lead heads a team; everyone else is stamped with one.
    return { coUsers: us, teams: ts, teamOf: (u) => (u.role === ROLES.TL ? teamByLead[u.id] : teamById[u.teamId]) || null };
  }, [user.companyId, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- dbVersion tracks the store

  const counts = useMemo(() => {
    const c = { total: coUsers.length, inactive: 0 };
    coUsers.forEach((u) => { c[u.role] = (c[u.role] || 0) + 1; if (u.isActive === false) c.inactive++; });
    return c;
  }, [coUsers]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return coUsers
      .filter((u) => roleFilter === 'ALL' || u.role === roleFilter)
      .filter((u) => {
        if (teamFilter === 'ALL') return true;
        const tm = teamOf(u);
        return teamFilter === 'NONE' ? !tm : tm?.id === teamFilter;
      })
      .filter((u) => !term || (u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term) || (u.phone || '').includes(term))
      .sort((a, b) => {
        if (sort === 'name') return byName(a, b);
        if (sort === 'name-desc') return byName(b, a);
        if (sort === 'role') return (SENIORITY[a.role] ?? 9) - (SENIORITY[b.role] ?? 9) || byName(a, b);
        const ta = teamOf(a)?.name; const tb = teamOf(b)?.name;
        if (ta !== tb) return !ta ? 1 : !tb ? -1 : ta.localeCompare(tb);
        return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || byName(a, b);
      });
  }, [coUsers, teamOf, q, roleFilter, teamFilter, sort]);

  const filtered = !!(q.trim() || roleFilter !== 'ALL' || teamFilter !== 'ALL');
  const clearFilters = () => { setQ(''); setRoleFilter('ALL'); setTeamFilter('ALL'); };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (allowed ? (
        <Pressable onPress={() => navigation.navigate('AccountForm')} accessibilityRole="button" accessibilityLabel="Add user" hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand }}>
          <Icon name="person-add" color={t.onBrand} />
        </Pressable>
      ) : null),
    });
  }, [navigation, allowed, t]);

  // Same rule as the menu entry and the access-admin function (access-rules.js).
  if (!allowed) return <Screen><Empty icon="lock" title="No access" hint="Users & accounts is not enabled for this account." /></Screen>;

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.md }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <Row wrap>
          <Stat label="Total accounts" value={counts.total} icon="group" />
          <Stat label="Team leads" value={counts[ROLES.TL] || 0} icon="supervisor-account" tone="info" />
        </Row>
        <Row wrap>
          <Stat label="Agents" value={counts[ROLES.AGENT] || 0} icon="support-agent" tone="brand" />
          <Stat label="Management" value={counts[ROLES.MGMT] || 0} icon="bolt" tone="purple" />
        </Row>
        <T v="small" tone="mute">{counts.inactive ? `${counts.inactive} inactive` : 'all active'} · {teams.length} team{teams.length === 1 ? '' : 's'}</T>
        <SearchField value={q} onChangeText={setQ} placeholder="Search name, email or phone" />
      </View>
      <ChipBar value={roleFilter} onChange={setRoleFilter}
        options={[{ value: 'ALL', label: 'All', count: counts.total }, ...ROLE_FILTER_OPTS.map((o) => ({ value: o.v, label: o.l, count: counts[o.v] || 0 }))]} />
      <ChipBar value={teamFilter} onChange={setTeamFilter}
        options={[{ value: 'ALL', label: 'All teams' }, ...teams.map((x) => ({ value: x.id, label: x.name })), { value: 'NONE', label: 'No team' }]} />
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg }}>
        <T v="small" tone="mute">{filtered ? `${list.length} of ${counts.total} accounts` : nAccounts(counts.total)}</T>
        <Pressable onPress={() => setSort(SORT_OPTS[(SORT_OPTS.findIndex((s) => s.value === sort) + 1) % SORT_OPTS.length].value)} accessibilityRole="button" hitSlop={8}>
          <Row gap={4}><Icon name="swap-vert" size={16} color={t.sub} /><T v="small" tone="sub">Sort: {SORT_OPTS.find((s) => s.value === sort).label}</T></Row>
        </Pressable>
      </Row>
    </View>
  );

  const renderItem = ({ item: u }) => {
    const team = teamOf(u);
    return (
      <View style={{ paddingHorizontal: space.lg }}>
        <Pressable onPress={() => navigation.navigate('AccountForm', { userId: u.id })} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: t.card, borderRadius: radius.lg, padding: space.md, opacity: pressed ? 0.7 : u.isActive === false ? 0.6 : 1 })}>
          <Avatar name={u.name} />
          <View style={{ flex: 1, gap: 3 }}>
            <T v="strong" numberOfLines={1}>{u.name}</T>
            <T v="small" tone="sub" numberOfLines={1}>{[u.email, u.phone].filter(Boolean).join('  ·  ') || '—'}</T>
            <Row wrap>
              <Badge label={rlabel(u.role)} tone={ROLE_TONE[u.role] || 'brand'} icon={u.role === ROLES.MGMT ? 'bolt' : undefined} />
              {team ? <Badge label={team.name} icon="groups" /> : null}
              {u.id === user.id ? <Badge label="you" tone="info" /> : null}
              {u.isActive === false ? <Badge label="inactive" tone="danger" /> : null}
            </Row>
          </View>
          <Icon name="chevron-right" color={t.mute} />
        </Pressable>
      </View>
    );
  };

  return (
    <Screen scroll={false}>
      <FlatList
        data={list}
        keyExtractor={(u) => u.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={filtered
          ? <Empty icon="search-off" title="No account matches" hint="Try a different word or clear the filters." action={<Button label="Clear filters" variant="ghost" full={false} onPress={clearFilters} />} />
          : <Empty icon="group" title="No accounts yet" hint="Add a team lead to start." />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}
