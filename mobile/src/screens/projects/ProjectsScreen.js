// The project catalog: the phone version of the web Projects page
// (src/components/views/PropertiesView.jsx). Same list, same filters (search,
// city, type, status) and the same numbers: units, rates, sizes and status come
// from each project's blocks through projectInventory() (src/lib/projects.js).
// Adding, editing and deleting projects stay on the web.
import { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, View } from 'react-native';
import { Badge, Button, Chip, ChipBar, Empty, Icon, Row, Screen, SearchField, Sheet, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { getProperties } from '../../../../src/lib/db.js';
import { PROPERTY_TYPES, PROPERTY_STATUS } from '../../../../src/lib/constants.js';
import { projectInventory, projectTypeOf } from '../../../../src/lib/projects.js';
import { PROJECT_STATUS_TONE, coverOf, fmtSft, span } from './bits';

const STATUS_OPTIONS = [{ value: 'ALL', label: 'All status' }, ...Object.entries(PROPERTY_STATUS).map(([value, label]) => ({ value, label }))];

function ProjectCard({ p, iv, onPress }) {
  const t = useTheme();
  const [broken, setBroken] = useState(false);
  const img = coverOf(p);
  const kind = [...new Set([projectTypeOf(p), p.type].filter(Boolean))].join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, backgroundColor: t.card, borderRadius: radius.lg, padding: space.md, opacity: pressed ? 0.7 : 1 })}>
      {/* The icon shows when there is no photo, or the photo fails to load. */}
      <View style={{ width: 76, height: 76, borderRadius: radius.md, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {img && !broken
          ? <Image source={{ uri: img }} onError={() => setBroken(true)} resizeMode="cover" style={{ width: 76, height: 76 }} />
          : <Icon name="apartment" size={30} color={t.mute} />}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="strong" numberOfLines={1} style={{ flex: 1 }}>{p.name || 'Untitled project'}</T>
          <Icon name="chevron-right" color={t.mute} />
        </Row>
        <T v="small" tone="sub" numberOfLines={1}>{[[p.area, p.district].filter(Boolean).join(', '), kind].filter(Boolean).join('  ·  ') || '—'}</T>
        <T v="small" numberOfLines={1}>
          {iv.rateMin != null ? `${span(iv.rateMin, iv.rateMax, '৳')}/sft` : 'No rate yet'}
          {iv.sizeMin != null ? `  ·  ${span(iv.sizeMin, iv.sizeMax, '', ' sqft')}` : p.sizeText ? `  ·  ${p.sizeText}` : ''}
        </T>
        <T v="small" tone="mute" numberOfLines={1}>
          {iv.total
            ? `${iv.available} of ${iv.total} available${iv.hold ? ` · ${iv.hold} on hold` : ''}${iv.sold ? ` · ${iv.sold} sold` : ''}`
            : 'No units yet'}
        </T>
        <Row wrap style={{ marginTop: 2 }}>
          {iv.status
            ? <Badge label={PROPERTY_STATUS[iv.status]} tone={PROJECT_STATUS_TONE[iv.status]} />
            : <Badge label="No units" />}
          {p.handover ? <Badge label={`Handover ${p.handover}`} icon="event" /> : null}
        </Row>
      </View>
    </Pressable>
  );
}

export default function ProjectsScreen({ navigation }) {
  const { dbVersion } = useApp();
  const t = useTheme();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const all = useMemo(() => getProperties(), [dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- the store changes in place
  const inv = useMemo(() => new Map(all.map((p) => [p.id, projectInventory(p)])), [all, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const cities = useMemo(() => [...new Set(all.map((p) => p.district).filter(Boolean))], [all]);

  // PropertiesView's filter chain, in its order.
  let props = all;
  if (city !== 'ALL') props = props.filter((p) => p.district === city);
  if (type !== 'ALL') props = props.filter((p) => p.type === type);
  if (status !== 'ALL') props = props.filter((p) => inv.get(p.id).status === status);
  if (q) { const s = q.toLowerCase(); props = props.filter((p) => ((p.name || '') + ' ' + (p.district || '') + ' ' + (p.area || '') + ' ' + (p.address || '')).toLowerCase().includes(s)); }

  // Totals over the projects listed (filters apply), as the web KPI strip.
  const sum = (k) => props.reduce((s, p) => s + inv.get(p.id)[k], 0);
  const totalSft = sum('area');
  const extra = (city !== 'ALL' ? 1 : 0) + (type !== 'ALL' ? 1 : 0);

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.md }}>
      <Row style={{ paddingHorizontal: space.lg }}>
        <View style={{ flex: 1 }}>
          <SearchField value={q} onChangeText={setQ} placeholder={`Search ${all.length} project${all.length === 1 ? '' : 's'}`} />
        </View>
        <Pressable onPress={() => setFiltersOpen(true)} accessibilityRole="button" accessibilityLabel="City and type filters"
          style={{ minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: extra ? t.brand : t.card }}>
          <Icon name="tune" size={18} color={extra ? t.onBrand : t.sub} />
          <T v="small" color={extra ? t.onBrand : t.text} style={{ fontWeight: '600' }}>{extra ? `Filters ${extra}` : 'Filters'}</T>
        </Pressable>
      </Row>
      <ChipBar options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      <View style={{ paddingHorizontal: space.lg, gap: 2 }}>
        <T v="small" tone="sub">
          {`${props.length} project${props.length === 1 ? '' : 's'} · ${sum('total')} units · ${sum('available')} available · ${sum('hold')} on hold · ${sum('sold')} sold`}
        </T>
        {totalSft ? <T v="small" tone="mute">{`Total area ${fmtSft(totalSft)} sft`}</T> : null}
      </View>
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={props}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space.lg }}>
            <ProjectCard p={item} iv={inv.get(item.id)} onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id })} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.sm }}
        ListEmptyComponent={all.length
          ? <Empty icon="apartment" title="No projects match" hint="Try another word, status or filter." />
          : <Empty icon="apartment" title="No projects yet" hint="Projects are added from the web app." />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
        keyboardShouldPersistTaps="handled"
      />

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters"
        footer={(
          <>
            <Button label="Show projects" onPress={() => setFiltersOpen(false)} />
            {extra ? <Button label="Clear filters" variant="ghost" onPress={() => { setCity('ALL'); setType('ALL'); }} /> : null}
          </>
        )}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Type</T>
        <Row wrap>
          <Chip label="All types" active={type === 'ALL'} onPress={() => setType('ALL')} />
          {PROPERTY_TYPES.map((x) => <Chip key={x} label={x} active={type === x} onPress={() => setType(x)} />)}
        </Row>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>City</T>
        <Row wrap>
          <Chip label="All cities" active={city === 'ALL'} onPress={() => setCity('ALL')} />
          {cities.map((x) => <Chip key={x} label={x} active={city === x} onPress={() => setCity(x)} />)}
        </Row>
      </Sheet>
    </Screen>
  );
}
