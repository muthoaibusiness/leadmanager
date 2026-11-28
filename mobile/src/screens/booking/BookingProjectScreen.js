// One project in Booking: the phone version of the web's ShopBookingView.jsx (its
// project page and ProjectBooking), ShopGrid.jsx and StackGrid.jsx. Three tabs, as on
// the web: Overview, Booking and Documents.
//
// The Booking tab picks a floor, then a unit. A tower whose floors are marked as grid
// floors is booked from one building view (a row per floor, a column per unit type),
// as on the web. Any other project shows its floor drawn as a plan (FloorPlan.js), or,
// switched to Grid, the web phone layout: shop cells five to a row with Open / Held /
// Sold / All filters. A tap opens the unit's sheet (ShopSheet.js).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Chip, Empty, Row, Screen, Segmented, T } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { planProjects, maskProject, projectsFor } from '../../../../src/lib/projects.js';
import { canCustomers, canPrices } from '../../../../src/lib/constants.js';
import { byCode } from '../../../../src/lib/floorPlan.js';
import { textFloor, landmarks, floorCode, shortCode, codeKey, stackOf, takaShort } from '../../../../src/lib/floorText.js';
import { sortPlans, customStatuses, swatch, tileColors } from './bits';
import FloorPlan from './FloorPlan';
import ShopSheet from './ShopSheet';
import { OverviewTab, ProjectDocsTab } from './Overview';

const PTABS = [{ value: 'overview', label: 'Overview' }, { value: 'booking', label: 'Booking' }, { value: 'docs', label: 'Documents' }];
const FILTERS = [
  ['open', 'Open', (s) => s.status === 'available'],
  ['held', 'Held', (s) => s.status === 'hold'],
  ['sold', 'Sold', (s) => s.status === 'sold'],
  ['all', 'All', () => true],
];
const STATUS_LABEL = { available: 'Available', hold: 'On hold', sold: 'Sold' };

function Key({ status, color, label }) {
  const t = useTheme();
  const sw = color ? { bg: color, border: color } : swatch(t, status);
  return (
    <Row gap={5}>
      <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: sw.bg, borderWidth: 1, borderColor: sw.border }} />
      <T v="small" tone="sub">{label}</T>
    </Row>
  );
}

// ShopGrid.jsx's cells: code and size, coloured by status.
function ShopTiles({ shops, shopCode, onPick, empty }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const gap = 6;
  const cell = Math.floor((width - space.lg * 2 - gap * 4) / 5);
  if (!shops.length) return <T v="small" tone="mute" style={{ textAlign: 'center', paddingVertical: space.lg }}>{empty}</T>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {shops.map((s) => {
        const c = tileColors(t, s);
        const on = shopCode === s.code;
        const code = shortCode(s.code);
        return (
          <Pressable key={s.code} onPress={() => onPick(s.code)} accessibilityRole="button" accessibilityLabel={`${s.code}, ${s.size} sq ft, ${s.look.label}`}
            style={({ pressed }) => ({ width: code.length > 6 ? cell * 2 + gap : cell, height: 54, borderRadius: radius.sm, backgroundColor: c.fill, borderWidth: on ? 2.5 : 1, borderColor: on ? t.text : c.stroke, borderStyle: c.dash && !on ? 'dashed' : 'solid', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : s.status === 'sold' && !s.look.color ? 0.6 : 1 })}>
            <T v="small" color={c.text} numberOfLines={1} style={{ fontWeight: '700', textDecorationLine: s.status === 'sold' ? 'line-through' : 'none' }}>{code}</T>
            <T v="tiny" tone="sub">{s.size || '—'}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

// StackGrid.jsx's building view: a row per floor (top first), a column per unit type.
function StackView({ project, plans, shopCode, onPick }) {
  const t = useTheme();
  const { rows, cols, all } = stackOf(project, plans);
  const n = (st, custom) => all.filter((s) => s.status === st && !!s.look.color === custom).length;
  const land = all.filter((s) => s.look.color);
  const colW = 84;
  return (
    <View style={{ gap: space.md }}>
      <Row wrap gap={space.md}>
        <Key status="available" label={`Available ${n('available', false)}`} />
        <Key status="hold" label={`On hold ${n('hold', false)}`} />
        <Key status="sold" label={`Sold ${n('sold', false)}`} />
        {land.length ? <Key color={land[0].look.color} label={`${land[0].look.label} ${land.length}`} /> : null}
      </Row>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={{ width: 72 }} />
            {cols.map((v) => (
              <View key={v.id} style={{ width: colW, alignItems: 'center' }}>
                <T v="small" style={{ fontWeight: '700' }} numberOfLines={1}>{v.name}</T>
                {v.position ? <T v="tiny" tone="mute" numberOfLines={1}>{v.position}</T> : null}
              </View>
            ))}
          </View>
          {rows.map(({ plan, shops }) => (
            <View key={plan.id} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <T v="small" tone="sub" style={{ width: 72 }} numberOfLines={2}>{plan.name}</T>
              {cols.map((v) => {
                const s = shops.find((x) => x.variantId === v.id);
                if (!s) return <View key={v.id} style={{ width: colW, height: 62 }} />;
                const c = tileColors(t, s);
                const on = shopCode === s.code;
                return (
                  <Pressable key={v.id} onPress={() => onPick(s.code)} accessibilityRole="button" accessibilityLabel={`${s.code}, ${plan.name}, ${s.look.label}`}
                    style={({ pressed }) => ({ width: colW, height: 62, borderRadius: radius.sm, padding: 4, backgroundColor: c.fill, borderWidth: on ? 2.5 : 1, borderColor: on ? t.text : c.stroke, borderStyle: c.dash && !on ? 'dashed' : 'solid', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                    <T v="small" color={c.text} style={{ fontWeight: '700' }} numberOfLines={1}>{s.code}</T>
                    <T v="tiny" tone="sub" numberOfLines={1}>{s.look.color ? s.look.label : STATUS_LABEL[s.status] || s.look.label}</T>
                    <T v="tiny" tone="sub" numberOfLines={1}>{s.status === 'available' && s.price ? takaShort(s.price) : `${s.size || ''}${s.size ? ' sft' : ''}`}</T>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function ProjectBooking({ project }) {
  const { dbVersion } = useApp();
  void dbVersion; // re-read the store after a sync or a status change
  const [floorId, setFloorId] = useState(null);
  const [shopCode, setShopCode] = useState(null);
  const [mode, setMode] = useState('plan');
  const [filter, setFilter] = useState('open');

  const plans = sortPlans(project.floorPlans || []);
  // ProjectBooking: the picked floor, else the ground floor if it has units, else the lowest floor that does.
  const hasShops = (p) => textFloor(project, p).counts.total > 0;
  const plan = plans.find((p) => p.id === floorId)
    || [...plans].reverse().find((p) => p.order === 0 && hasShops(p)) || [...plans].reverse().find(hasShops)
    || plans.find((p) => p.order === 0) || plans[0] || null;
  const floor = plan ? textFloor(project, plan) : null;
  const grid = plans.some((p) => p.grid);
  // The sheet's unit: on the floor on screen, or (a tower) anywhere in the building.
  const towerAll = grid ? stackOf(project, plans).all : [];
  const shop = (grid ? towerAll : floor?.shops || []).find((s) => s.code === shopCode) || null;
  const shopPlan = grid ? shop?.plan : plan;

  if (!plan || !floor) return <Empty icon="map" title="No floor plan yet" hint="Add one on the web in Projects → Available Units." />;

  const sheet = shop ? <ShopSheet visible project={project} plan={shopPlan} shop={shop} onClose={() => setShopCode(null)} /> : null;
  if (grid) return <><StackView project={project} plans={plans} shopCode={shopCode} onPick={setShopCode} />{sheet}</>;

  const listed = plans.filter((p) => p.id === plan.id || hasShops(p));
  const rail = listed.length ? listed : plans;
  const shops = [...floor.shops].sort((a, b) => byCode(a.code, b.code));
  const test = (FILTERS.find((f) => f[0] === filter) || FILTERS[0])[2];
  const keys = codeKey(floor.shops.map((s) => s.code));

  return (
    <View style={{ gap: space.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {rail.map((p) => {
          const c = textFloor(project, p).counts;
          return <Chip key={p.id} label={`${floorCode(p.name)} · ${c.total ? c.available : '—'}`} active={plan.id === p.id}
            onPress={() => { setFloorId(p.id); setShopCode(null); }} />;
        })}
      </ScrollView>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h2" style={{ flex: 1 }} numberOfLines={1}>{plan.name}</T>
        <View style={{ width: 150 }}>
          <Segmented options={[{ value: 'plan', label: 'Plan' }, { value: 'grid', label: 'Grid' }]} value={mode} onChange={setMode} />
        </View>
      </Row>

      {!floor.counts.total ? (
        <Empty icon="local-parking" title="No units on this floor" hint={plan.note || 'Pick another floor to book a unit.'} />
      ) : (
        <>
          <Row wrap gap={space.md}>
            <Key status="available" label={`Available ${floor.counts.available}`} />
            <Key status="hold" label={`On hold ${floor.shops.filter((x) => x.status === 'hold' && !x.look.color).length}`} />
            <Key status="sold" label={`Sold ${floor.shops.filter((x) => x.status === 'sold' && !x.look.color).length}`} />
            {customStatuses(floor.shops).map((c) => <Key key={c.label} color={c.color} label={`${c.label} ${c.n}`} />)}
          </Row>
          {keys.length ? <T v="tiny" tone="mute">{keys.map((k) => `${k.code} = ${k.name}`).join('  ·  ')}</T> : null}

          {mode === 'plan' ? (
            <FloorPlan floor={floor} lm={landmarks(plan)} shopCode={shopCode} onPick={setShopCode} />
          ) : (
            <>
              <Row wrap>
                {FILTERS.map(([k, label, fn]) => <Chip key={k} label={`${label} ${shops.filter(fn).length}`} active={filter === k} onPress={() => setFilter(k)} />)}
              </Row>
              <ShopTiles shops={shops.filter(test)} shopCode={shopCode} onPick={setShopCode} empty={`No ${filter === 'all' ? '' : filter + ' '}shops on this floor.`} />
            </>
          )}
        </>
      )}
      {sheet}
    </View>
  );
}

export default function BookingProjectScreen({ route, navigation }) {
  const { user, dbVersion } = useApp();
  const id = route.params?.projectId;
  const [tab, setTab] = useState('booking');
  // ShopBookingView: the account's own projects, masked to what it may see.
  const project = useMemo(() => {
    const access = { customers: canCustomers(user), prices: canPrices(user) };
    return projectsFor(user, planProjects()).map((p) => maskProject(p, access)).find((p) => p.id === id) || null;
  }, [user, id, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- the store changes in place
  useEffect(() => { if (project?.name) navigation.setOptions({ title: project.name }); }, [navigation, project?.name]);

  if (!project) return <Screen><Empty icon="apartment" title="Project not available" hint="It was removed, or your account does not book it." /></Screen>;

  return (
    <Screen>
      <Segmented options={PTABS} value={tab} onChange={setTab} />
      {tab === 'overview' ? <OverviewTab project={project} />
        : tab === 'docs' ? <ProjectDocsTab project={project} />
          : <ProjectBooking project={project} />}
    </Screen>
  );
}
