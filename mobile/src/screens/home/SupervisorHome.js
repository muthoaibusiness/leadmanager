// Home for the two supervising roles: Management and Team Lead. Each export is a
// group of sections for the Home screen's own ScrollView (no Screen, no scroll
// view here), and every list is capped with a "See all" that opens the full page.
//
// The numbers are the web dashboards' numbers: the counting lives in src/lib
// and is called from here. Where the web keeps a calculation inside a component
// or a React hook (which cannot be imported), it is copied and its source named.
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Avatar, Badge, Button, Card, ChipBar, IconButton, Loading, Row, Section, Stat, T } from '../../ui';
import { useTheme, toneColors, space } from '../../theme';
import { useApp } from '../../store';
import { useActWindow, useLeadBook } from '../../hooks';
import {
  getDB, getLeads, getBookings, bookingPaid, queryLeads, calcPipelineValue, hasOffer, hasOfferCol,
  loadLeadUpdates, loadNewLeads, dashboardRollup, agentLeadStats, activityRollup, getTarget, achievement,
} from '../../../../src/lib/db.js';
import { CONTACT_PERIODS, contactPerf, updatesFromActs, periodSince } from '../../../../src/lib/contactPerf.js';
import { leadSourceMix } from '../../../../src/lib/sourceMix.js';
import { buildFunnel, buildStageTrend, panelConfigFor } from '../../../../src/lib/funnel.js';
import { buildAgentPerf } from '../../../../src/lib/agentPerf.js';
import { getPresetRange } from '../../../../src/lib/datePresets.js';
import { eq, or, notNull } from '../../../../src/lib/leadQuery.js';
import { ROLES, SRC_LABELS, canSee } from '../../../../src/lib/constants.js';
import { fmtBDT, fmtAgo, scoreLead, scoreLabel, leadDisplayStatus, srclabel, periodLabel, daysLeftInMonth } from '../../../../src/lib/helpers.js';

const CAP = 10; // rows a Home list shows before "See all"
const TONES = ['brand', 'info', 'purple', 'teal', 'warn', 'danger'];

// ── Small display pieces ────────────────────────────────────────────────────

// A thin bar filled to pct (0–100).
function Track({ pct, tone = 'brand' }) {
  const t = useTheme();
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line, overflow: 'hidden' }}>
      <View style={{ width: `${p}%`, height: 6, borderRadius: 3, backgroundColor: toneColors(t, tone).fg }} />
    </View>
  );
}

// Label left, value right, a bar under them (the web's Meter, MobileBits.jsx).
function Meter({ label, value, pct, tone }) {
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="small" tone="sub" style={{ flex: 1 }} numberOfLines={1}>{label}</T>
        <T v="small" style={{ fontWeight: '700' }}>{value}</T>
      </Row>
      <Track pct={pct} tone={tone} />
    </View>
  );
}

// A trend as a row of small bars, one per point, the tallest filling the height.
function MiniBars({ points, tone = 'brand', height = 40, label }) {
  const t = useTheme();
  const max = Math.max(1, ...points);
  const fg = toneColors(t, tone).fg;
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: points.length > 20 ? 1 : 2, height }}>
      {points.map((v, i) => (
        <View key={i} style={{ flex: 1, height: v > 0 ? Math.max(3, Math.round((v / max) * height)) : 2, borderRadius: 2, backgroundColor: v > 0 ? fg : t.line }} />
      ))}
    </View>
  );
}

// The change against the previous equal period. The percent rule is
// ContactTracker.jsx's and LeadSourcesCard.jsx's (the same in both).
function Change({ total, prevTotal, span }) {
  if (prevTotal == null) return null;
  const diff = total - prevTotal;
  const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const percent = prevTotal ? `${Math.abs((diff / prevTotal) * 100).toFixed(1)}%` : total ? 'New' : '0.0%';
  return (
    <Row>
      <Badge label={`${trend === 'up' ? '+' : trend === 'down' ? '−' : ''}${percent}`} tone={trend === 'up' ? 'brand' : trend === 'down' ? 'danger' : 'neutral'} />
      <T v="small" tone="mute">vs previous {span}</T>
    </Row>
  );
}

function PersonRow({ name, detail, right, onPress, last }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: t.line })}>
      <Avatar name={name} size={36} />
      <View style={{ flex: 1 }}>
        <T v="strong" numberOfLines={1}>{name}</T>
        {detail ? <T v="small" tone="mute" numberOfLines={2}>{detail}</T> : null}
      </View>
      {right}
    </Pressable>
  );
}

const SeeAll = ({ label = 'See all', onPress }) => <Button label={label} small full={false} variant="soft" onPress={onPress} />;

// A clock that ticks once a minute: the 24-hour window rolls, and a period re-loads.
function useMinute() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60e3);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ════════════════════════════════════════════════════════════════════════════
// Management
// ════════════════════════════════════════════════════════════════════════════

// The Overview date filter: the phone Home's period menu on the web
// (PERIOD_OPTIONS in dashboards/MobileBits.jsx), without Custom.
const OVERVIEW_OPTIONS = [
  { value: 'allTime', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: '7 days' },
  { value: 'thisMonth', label: 'Month' },
  { value: 'thisYear', label: 'Year' },
];
// Performance overview: one period for Prospects contacted and Lead sources,
// named by its span (OVERVIEW_PERIODS in ManagementDash.jsx).
const PERF_OPTIONS = CONTACT_PERIODS.map((p) => ({ value: p.label, label: p.span }));

// The headline numbers. Copied from dashboards/KpiRow.jsx (variant "hero"):
// the same scope, the same date rule, the same graph windows. Read-only there,
// so read-only here.
function useKpis(user, dateRange, dbVersion) {
  return useMemo(() => {
    const leads = getLeads(user, { involved: true });
    const leadIds = new Set(leads.map((l) => l.id));
    const inRange = (arr) => {
      if (!dateRange?.range) return arr;
      const { start, end } = dateRange.range;
      return arr.filter((l) => { const d = new Date(l.createdAt); return d >= start && d <= end; });
    };
    const scoped = inRange(leads);
    const won = scoped.filter((l) => l.status === 'DEAL_CLOSED_WON');
    const lost = scoped.filter((l) => l.status === 'DEAL_CLOSED_LOST');
    const closed = won.length + lost.length;
    const rev = won.reduce((s, l) => s + (l.dealValue || 0), 0);
    const wr = closed ? Math.round((won.length / closed) * 100) : 0;

    // Bookings on this scope's leads, minus the dead ones.
    const bookings = getBookings().filter((b) => leadIds.has(b.leadId) && !['EXPIRED', 'CANCELLED'].includes(b.status));
    const collected = bookings.reduce((s, b) => s + bookingPaid(b), 0);
    const booked = bookings.reduce((s, b) => s + (b.total || 0), 0);
    const paidPct = booked ? Math.round((collected / booked) * 100) : 0;

    // Time buckets: daily (14 days) → weekly (12) → monthly (12), whichever first has shape.
    const alive = (arr) => arr.filter((v) => v > 0).length >= 2;
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const bucketsOf = (n, unit) => Array.from({ length: n }, (_, i) => {
      const d = new Date(today0);
      if (unit === 'month') { d.setDate(1); d.setMonth(d.getMonth() - (n - 1 - i)); }
      else d.setDate(d.getDate() - (n - 1 - i) * (unit === 'week' ? 7 : 1));
      const nx = new Date(d);
      if (unit === 'month') nx.setMonth(nx.getMonth() + 1); else nx.setDate(nx.getDate() + (unit === 'week' ? 7 : 1));
      return [d, nx];
    });
    const sumIn = (rows, at, val) => ([d, nx]) => rows.filter((r) => { const x = at(r); return x && x >= d && x < nx; }).reduce((s, r) => s + val(r), 0);
    const sDelta = (arr) => { const a = arr.slice(7).reduce((x, y) => x + y, 0), b = arr.slice(0, 7).reduce((x, y) => x + y, 0); return b ? Math.round(((a - b) / b) * 100) : (a ? 100 : 0); };
    const withShape = (days, rows, at, val) => {
      const daily = bucketsOf(14, 'day').map(sumIn(rows, at, val));
      if (alive(daily)) return { points: daily.slice(-days), delta: sDelta(daily) };
      const weeks = bucketsOf(12, 'week').map(sumIn(rows, at, val));
      if (alive(weeks)) return { points: weeks, window: '12-week trend' };
      return { points: bucketsOf(12, 'month').map(sumIn(rows, at, val)), window: '12-month trend' };
    };
    const at = (k) => (r) => (r[k] ? new Date(r[k]) : null);
    const revGraph = withShape(14, leads.filter((l) => l.status === 'DEAL_CLOSED_WON'), at('updatedAt'), (l) => l.dealValue || 0);
    const newCount = bucketsOf(14, 'day').map(sumIn(leads, at('createdAt'), () => 1)).reduce((s, v) => s + v, 0);

    return { rev, wr, won: won.length, lost: lost.length, collected, booked, paidPct, newCount, revGraph };
  }, [user, dateRange, dbVersion]);
}

function Overview({ dateRange, preset, onPreset, ready }) {
  const { user, dbVersion } = useApp();
  const k = useKpis(user, dateRange, dbVersion);
  const delta = k.revGraph.window ? null : k.revGraph.delta;
  const v = (x) => (ready ? x : '…');
  return (
    <Section title="Overview">
      <ChipBar pad={false} options={OVERVIEW_OPTIONS} value={preset} onChange={onPreset} />
      <Card>
        <T v="small" tone="sub">Revenue won</T>
        <T v="title">{v(fmtBDT(k.rev))}</T>
        {ready && delta != null ? (
          <Row>
            <Badge label={`${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`} tone={delta >= 0 ? 'brand' : 'danger'} />
            <T v="small" tone="mute">vs last week</T>
          </Row>
        ) : null}
        {ready ? (
          <View style={{ gap: 4, marginTop: space.xs }}>
            <MiniBars points={k.revGraph.points} label="Revenue won trend" />
            <T v="small" tone="mute">{k.revGraph.window ? `Won, ${k.revGraph.window}` : 'Won, last 14 days'}</T>
          </View>
        ) : null}
        <Row style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
          {[['Collected', fmtBDT(k.collected)], ['Booked', fmtBDT(k.booked)], ['New · 14 days', String(k.newCount)]].map(([label, value]) => (
            <View key={label} style={{ flex: 1, gap: 2 }}>
              <T v="small" tone="sub" numberOfLines={1}>{label}</T>
              <T v="strong">{v(value)}</T>
            </View>
          ))}
        </Row>
        <View style={{ gap: space.md, marginTop: space.sm }}>
          <Meter label={`Win rate ${v(k.wr + '%')}`} value={v(`${k.won} won · ${k.lost} lost`)} pct={ready ? k.wr : 0} />
          <Meter label="Collected of booked" value={v(k.booked ? `${k.paidPct}%` : 'Nothing booked yet')} pct={ready ? k.paidPct : 0} tone="teal" />
        </View>
      </Card>
    </Section>
  );
}

// Prospects contacted: every counted update in the period, and who logged it.
// Loading and merging follow dashboards/ContactTracker.jsx; the count itself,
// for the company and for each person, is contactPerf() (lib/contactPerf.js).
function Contacted({ period, navigation }) {
  const { user, dbVersion } = useApp();
  const [loaded, setLoaded] = useState({}); // period label → updates from the cloud
  const cloud = loaded[period.label];
  const now = useMinute();

  useEffect(() => {
    if (cloud) return undefined;
    let alive = true;
    loadLeadUpdates(user, periodSince(period)).then((updates) => {
      if (alive) setLoaded((l) => ({ ...l, [period.label]: updates || [] }));
    });
    return () => { alive = false; };
  }, [cloud, period, user]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- db.activities is mutated in place; dbVersion tracks it
  const local = useMemo(() => updatesFromActs(getDB().activities), [dbVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- db.leads is mutated in place; dbVersion tracks it
  const leadStatus = useMemo(() => new Map((getDB().leads || []).map((l) => [l.id, l.status])), [dbVersion]);

  const { points, total, prevTotal, people } = useMemo(() => {
    const updates = cloud ? cloud.concat(local) : local;
    const opts = { companyId: user.companyId, leadStatus, now };
    const whole = contactPerf(updates, period, opts);
    // The same count, once per person: their own updates through the same function.
    const byUser = new Map();
    updates.forEach((u) => {
      if (!u || !u.userId) return;
      if (!byUser.has(u.userId)) byUser.set(u.userId, []);
      byUser.get(u.userId).push(u);
    });
    const users = new Map((getDB().users || []).map((u) => [u.id, u]));
    const rows = [...byUser.entries()]
      .map(([id, list]) => ({ id, u: users.get(id) || null, total: contactPerf(list, period, opts).total }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
    return { ...whole, people: rows };
  }, [cloud, local, period, user.companyId, leadStatus, now]);

  const top = people.length ? people[0].total : 0;
  const more = canSee(user, 'agentperf') ? () => navigation.navigate('Performance') : null;

  return (
    <Card>
      <View>
        <T v="h2">Prospects contacted</T>
        <T v="small" tone="mute">Lead updates by your team</T>
      </View>
      {!cloud ? <Loading /> : (
        <>
          <T v="num">{total}</T>
          <Change total={total} prevTotal={prevTotal} span={period.span} />
          <MiniBars points={points.map((p) => p.value)} label={`Updates per ${period.hours ? 'hour' : 'day'}, ${period.label.toLowerCase()}`} />
          {people.length ? (
            <View style={{ marginTop: space.sm }}>
              {people.slice(0, CAP).map((r, i, arr) => (
                <Pressable key={r.id} disabled={!r.u} accessibilityRole={r.u ? 'button' : undefined}
                  onPress={() => navigation.navigate('AgentDetail', { userId: r.id })}
                  style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', gap: 6, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1, marginBottom: i === arr.length - 1 ? 0 : 2 })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T v="small" style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>{r.u ? r.u.name : 'Former account'}</T>
                    <T v="small" style={{ fontWeight: '700' }}>{r.total}</T>
                  </Row>
                  <Track pct={top ? (r.total / top) * 100 : 0} />
                </Pressable>
              ))}
            </View>
          ) : <T v="small" tone="mute">No updates in the {period.label.toLowerCase()}.</T>}
          {more ? <SeeAll label={people.length > CAP ? `See all ${people.length}` : 'Check now'} onPress={more} /> : null}
        </>
      )}
    </Card>
  );
}

// Each source keeps one colour (its slot in SRC_LABELS), as on the web card.
const SRC_KEYS = Object.keys(SRC_LABELS);
const sourceTone = (key) => { const slot = SRC_KEYS.indexOf(key); return slot >= 0 ? TONES[slot % TONES.length] : 'neutral'; };

// Lead sources: where the leads created in the period came from. Loading and
// merging follow dashboards/LeadSourcesCard.jsx; the mix is leadSourceMix().
function Sources({ period, leads, navigation }) {
  const { user } = useApp();
  const [loaded, setLoaded] = useState({}); // period label → leads from the cloud
  const cloud = loaded[period.label];
  const now = useMinute();

  useEffect(() => {
    let alive = true;
    loadNewLeads(user, periodSince(period, now)).then((rows) => {
      if (alive && rows) setLoaded((l) => ({ ...l, [period.label]: rows }));
    });
    return () => { alive = false; };
  }, [period, user, now]);

  // The lead book first: its copy of a lead is the freshest (realtime edits).
  const { counts, total, prevTotal } = useMemo(
    () => leadSourceMix(cloud ? leads.concat(cloud) : leads, period, { now, companyId: user.companyId }),
    [leads, cloud, period, now, user.companyId],
  );
  const data = Object.entries(counts)
    .map(([key, value]) => ({ key, label: key === 'UNKNOWN' ? 'Unknown' : srclabel(key), value }))
    .sort((a, b) => b.value - a.value);
  const sum = data.reduce((s, d) => s + d.value, 0);
  const SHOWN = 6;

  return (
    <Card>
      <View>
        <T v="h2">Lead sources</T>
        <T v="small" tone="mute">Where new leads came from</T>
      </View>
      {!cloud ? <Loading /> : !data.length ? <T v="small" tone="mute">No new leads in the {period.label.toLowerCase()}.</T> : (
        <>
          <Row style={{ alignItems: 'baseline' }}>
            <T v="num">{sum.toLocaleString('en-US')}</T>
            <T v="small" tone="mute">leads</T>
          </Row>
          <Change total={total} prevTotal={prevTotal} span={period.span} />
          <View style={{ gap: space.md, marginTop: space.sm }}>
            {data.slice(0, SHOWN).map((d) => {
              const pct = sum ? Math.round((d.value / sum) * 100) : 0;
              return <Meter key={d.key} label={d.label} value={`${d.value} · ${pct}%`} pct={pct} tone={sourceTone(d.key)} />;
            })}
          </View>
          {data.length > SHOWN ? <T v="small" tone="mute">and {data.length - SHOWN} more {data.length - SHOWN === 1 ? 'source' : 'sources'}</T> : null}
        </>
      )}
      {canSee(user, 'reports') ? <SeeAll label="View all" onPress={() => navigation.navigate('Reports')} /> : null}
    </Card>
  );
}

// Conversion funnel and the last 30 days of stage events. The cohort rule and
// the two date rules are dashboards/ConversionPanel.jsx's; the stages and the
// counting are lib/funnel.js. (The web panel is switched off at the moment by
// its ENABLED flag; the logic it would run is what runs here.)
function Funnel({ dateRange, ready }) {
  const { user, dbVersion } = useApp();
  const cfg = panelConfigFor(user.role);
  const { funnel, trend, size } = useMemo(() => {
    const db = getDB();
    const leads = getLeads(user);
    const acts = db.activities || {};
    const r = dateRange?.range;
    const cohort = r ? leads.filter((l) => { const d = new Date(l.createdAt); return d >= r.start && d <= r.end; }) : leads;
    return {
      size: cohort.length,
      funnel: buildFunnel(cohort, acts, cfg.stages),
      trend: buildStageTrend(leads, acts, { days: 30, keys: cfg.seriesKeys }),
    };
  }, [user, dateRange, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- the store mutates in place; dbVersion is the change signal

  const top = funnel.length ? funnel[0].value : 0;
  return (
    <Section title={cfg.title}>
      {!ready ? <Card><Loading /></Card> : (
        <>
          <Card>
            <T v="small" tone="mute">Leads received {periodLabel(dateRange)} · cumulative, % of all leads</T>
            {!size ? <T tone="mute">No leads in this period.</T> : (
              <View style={{ gap: space.md }}>
                {funnel.map((s, i) => {
                  const pct = top ? Math.round((s.value / top) * 100) : 0;
                  return <Meter key={s.key} label={s.label} value={`${s.value} · ${pct}%`} pct={pct} tone={TONES[i % TONES.length]} />;
                })}
              </View>
            )}
          </Card>
          <Card>
            <View>
              <T v="h2">Last 30 days</T>
              <T v="small" tone="mute">Dated by when each step happened, whatever the period above</T>
            </View>
            {trend.series.map((s, i) => (
              <View key={s.key} style={{ gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T v="small" tone="sub">{s.label}</T>
                  <T v="small" style={{ fontWeight: '700' }}>{s.points.reduce((a, b) => a + b, 0)}</T>
                </Row>
                <MiniBars points={s.points} height={28} tone={TONES[(i + 1) % TONES.length]} label={`${s.label} per day, ${trend.labels[0]} to ${trend.labels[trend.labels.length - 1]}`} />
              </View>
            ))}
          </Card>
        </>
      )}
    </Section>
  );
}

// The agents' summary: one line per agent from buildAgentPerf (lib/agentPerf.js),
// called the way the web's Performance page calls it (views/AnalyticsPerf.jsx),
// over the Overview period.
function Agents({ dateRange, ready, navigation }) {
  const { user, dbVersion } = useApp();
  const rows = useMemo(() => {
    const r = dateRange?.range;
    return buildAgentPerf(getDB(), { start: r ? r.start.getTime() : null, end: r ? r.end.getTime() : null, periodDays: 0, teamId: null })
      .filter((x) => x.u.role === ROLES.AGENT)
      .sort((a, b) => b.score - a.score || b.sourced - a.sourced || String(a.u.name).localeCompare(String(b.u.name)));
  }, [dateRange, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- the store mutates in place; dbVersion is the change signal

  const all = canSee(user, 'agentperf') ? 'Performance' : canSee(user, 'team') ? 'Team' : null;
  const shown = rows.slice(0, CAP);
  return (
    <Section title="Agents" action={all && rows.length ? <SeeAll label={rows.length > CAP ? `See all ${rows.length}` : 'See all'} onPress={() => navigation.navigate(all)} /> : null}>
      <Card style={{ gap: 0 }}>
        {!ready ? <Loading /> : !rows.length ? <T tone="mute">No agents yet.</T> : (
          <>
            <T v="small" tone="mute">Leads received {periodLabel(dateRange)}, by the agent who sourced them</T>
            {shown.map((r, i) => (
              <PersonRow key={r.u.id} name={r.u.name} last={i === shown.length - 1}
                detail={`${r.sourced} sourced · ${r.contacted} contacted · ${r.meetingsSet} meetings · ${r.visitsDone} visits`}
                right={<Badge label={`Score ${r.score}`} tone={r.score >= 50 ? 'brand' : r.score >= 25 ? 'warn' : 'neutral'} />}
                onPress={() => navigation.navigate('AgentDetail', { userId: r.u.id })} />
            ))}
          </>
        )}
      </Card>
    </Section>
  );
}

export function ManagementHome({ navigation }) {
  const ready = useLeadBook(); // every section reduces over the lead book; leads are not in the boot load
  useActWindow(); // the recent-activity window; activities are not in the boot load
  const { user, dbVersion } = useApp();
  const [preset, setPreset] = useState('allTime');
  const [perfKey, setPerfKey] = useState(CONTACT_PERIODS[0].label);
  const dateRange = useMemo(() => ({ preset, range: getPresetRange(preset) }), [preset]);
  const perfPeriod = CONTACT_PERIODS.find((p) => p.label === perfKey) || CONTACT_PERIODS[0];

  // The company's leads. Tolerates a missing companyId (unsynced or legacy
  // rows) so data never disappears: ManagementDash.jsx's `sameCo`.
  const coLeads = useMemo(() => {
    const cid = user.companyId;
    return (getDB().leads || []).filter((l) => !cid || !l.companyId || l.companyId === cid);
  }, [user.companyId, dbVersion]); // eslint-disable-line react-hooks/exhaustive-deps -- db.leads is mutated in place; dbVersion tracks it

  return (
    <>
      <Overview dateRange={dateRange} preset={preset} onPreset={setPreset} ready={ready} />
      <Section title="Performance overview">
        <ChipBar pad={false} options={PERF_OPTIONS} value={perfKey} onChange={setPerfKey} />
        <Contacted period={perfPeriod} navigation={navigation} />
      </Section>
      <Funnel dateRange={dateRange} ready={ready} />
      <Section title={`Lead sources · ${perfPeriod.span}`}>
        <Sources period={perfPeriod} leads={coLeads} navigation={navigation} />
      </Section>
      <Agents dateRange={dateRange} ready={ready} navigation={navigation} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Team Lead
// ════════════════════════════════════════════════════════════════════════════

// The web Team Lead page follows the header's date filter and reads month to
// date when that filter is "All time". The phone offers the periods directly,
// opening on the month, so every label says what its number covers.
const TL_OPTIONS = [
  { value: 'thisMonth', label: 'Month' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: '7 days' },
  { value: 'thisYear', label: 'Year' },
];

// Server-side dashboard rollups, with the "migration 0011 is not applied"
// signal (needBook) so the caller falls back to the lead book. Copied from the
// web hook src/hooks/useRollup.js, minus the stage trend this page never asks for.
// `opts` must be memoised by the caller; it is stringified into the effect key.
function useRollup(opts) {
  const { user, dbVersion } = useApp();
  const [state, setState] = useState({ rollup: null, agents: null, acts: null, ready: false, needBook: false });
  const key = JSON.stringify({ ...opts, u: user?.id, v: dbVersion });
  useEffect(() => {
    let alive = true;
    const { teamId = null, userIds = null, start = null, end = null, trendDays = 14, monthStart = null } = opts || {};
    Promise.all([
      dashboardRollup(user, { teamId, userIds, start, end, trendDays }),
      userIds && userIds.length ? agentLeadStats(user, userIds, { start, end, monthStart }) : Promise.resolve(null),
      activityRollup(user, { userIds, start, end }),
    ]).then(([rollup, agents, acts]) => {
      // The lead rollup decides: if it is missing, every number has to come from the book.
      if (alive) setState({ rollup, agents, acts, ready: true, needBook: !rollup });
    });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` stands in for opts/user/dbVersion
  return state;
}

const SCORE_TONE = { Hot: 'danger', Warm: 'warn', Cold: 'neutral' };

// Monthly target. Copied from dashboards/TargetCard.jsx (the numbers come from
// getTarget / achievement in db.js).
function Target({ user }) {
  const tgt = getTarget(user.id);
  const ach = achievement(user.id, user.role);
  const tar = tgt ? tgt.value : 0;
  const pct = tar > 0 ? Math.min(100, Math.round((ach / tar) * 100)) : 0;
  const left = daysLeftInMonth();
  const needed = Math.max(0, tar - ach);
  const daily = left > 0 ? (needed / left).toFixed(1) : '-';
  return (
    <Section title="Monthly target">
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h2">{tgt ? `${pct}%` : 'No target'}</T>
          {tgt && needed <= 0 ? <Badge label="Reached" tone="brand" icon="check-circle" /> : null}
        </Row>
        <Meter label="Site visits done" value={tgt ? `${ach} of ${tar}` : `${ach} done`} pct={pct} />
        <T v="small" tone="mute">
          {tgt ? (needed > 0 ? `${needed} to go` : 'Reached') : `${ach} done`} · {left} days left{tar > 0 && left > 0 && needed > 0 ? ` · ${daily}/day` : ''}
        </T>
      </Card>
    </Section>
  );
}

// Everything below the period chips is dashboards/TeamLeadDash.jsx: the same
// rollup-first numbers with the same book fallback, the same queries behind the
// cards, and the same offer gate on the closing list.
export function TeamLeadHome({ navigation }) {
  useActWindow(); // the recent-activity window; activities are not in the boot load
  const { user, dbVersion } = useApp();
  void dbVersion; // re-read the store when a save or realtime changes it
  const db = getDB();
  const [preset, setPreset] = useState('thisMonth');

  // Both bounds are stable across renders: they are stringified into useRollup's key.
  const { start: rangeStart, end: rangeEnd } = useMemo(() => getPresetRange(preset), [preset]);
  const inRange = (iso) => { const d = new Date(iso); return d >= rangeStart && d <= rangeEnd; };

  const teamUsers = (db.users || []).filter((u) => u.teamId === user.teamId);
  const teamUserIds = teamUsers.map((u) => u.id);
  const teamKey = teamUserIds.join();
  const rollOpts = useMemo(() => ({
    teamId: user.teamId || null,
    userIds: teamUserIds,
    start: rangeStart, end: rangeEnd,
    monthStart: (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })(),
  }), [user.teamId, teamKey, rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps -- teamKey stands in for teamUserIds
  const { rollup, agents, acts, ready, needBook } = useRollup(rollOpts);
  // The whole book downloads only when the rollup is unavailable.
  const bookReady = useLeadBook(needBook);
  const leads = getLeads(user);
  const pending = !ready || (needBook && !bookReady);

  // Is the offer gate expressible server-side? null while the answer is in
  // flight. The list, the card and the list behind the card all ask this one flag.
  const [offerCol, setOfferCol] = useState(null);
  useEffect(() => { let alive = true; hasOfferCol().then((v) => { if (alive) setOfferCol(v); }); return () => { alive = false; }; }, []);

  const [closingRows, setClosingRows] = useState(null);
  // While the book is in use or the offer gate is unknown, there is no fetched list.
  const closingGated = !ready || needBook || offerCol === null;
  if (closingGated && closingRows !== null) setClosingRows(null);
  useEffect(() => {
    if (closingGated) return undefined;
    let alive = true;
    // Only leads that carry an offer: forwarding to a Team Lead requires one
    // (fwdLead), so anything else in these statuses is not theirs to close.
    const statuses = or(eq('status', 'NEGOTIATING'), eq('status', 'SITE_VISIT_DONE'));
    const extra = offerCol ? [statuses, notNull('offer_sent_at')] : [statuses];
    queryLeads({ user, involved: true, extra }, { page: 0, size: 50, sort: 'updated' })
      .then((res) => { if (alive && res) setClosingRows(offerCol ? res.rows : res.rows.filter((l) => hasOffer(l, getDB()))); });
    return () => { alive = false; };
  }, [user, closingGated, offerCol, dbVersion]);

  const allActs = Object.values(db.activities || {}).flat();

  // Book-derived values: the pre-0011 fallback for every headline number.
  const won = leads.filter((l) => l.status === 'DEAL_CLOSED_WON' && inRange(l.updatedAt));
  const lost = leads.filter((l) => l.status === 'DEAL_CLOSED_LOST' && inRange(l.updatedAt));
  // Same offer gate as the query above.
  const neg = leads.filter((l) => l.status === 'NEGOTIATING' && hasOffer(l, db));
  const toClose = leads.filter((l) => l.status === 'SITE_VISIT_DONE' && hasOffer(l, db));
  const bookClosing = [...neg, ...toClose];
  const closing = closingRows || bookClosing;
  const teamActs = allActs.filter((a) => teamUserIds.includes(a.userId) && inRange(a.timestamp));

  // Headline numbers: rollup first, the book expression beside it as the fallback.
  const rev = rollup ? rollup.revenue : won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const pipe = rollup ? rollup.closing_value : bookClosing.reduce((s, l) => s + calcPipelineValue(l.id, db), 0);
  const wonN = rollup ? rollup.won : won.length;
  const lostN = rollup ? rollup.lost : lost.length;
  const wr = wonN + lostN > 0 ? Math.round((wonN / (wonN + lostN)) * 100) : 0;
  const siteVisits = rollup ? rollup.site_visits : leads.filter((l) => l.siteVisitDoneDate && inRange(l.siteVisitDoneDate)).length;
  const newLeads = rollup ? rollup.total : leads.filter((l) => inRange(l.createdAt)).length;
  const talkSecs = acts ? acts.talk_secs : teamActs.filter((a) => a.type === 'CALL').reduce((s, a) => s + (a.durationSeconds || 0), 0);
  const talkMins = Math.round(talkSecs / 60);
  const offersSent = acts ? acts.offers : allActs.filter((a) => a.type === 'OFFER' && inRange(a.timestamp)).length;

  // The list behind each card: the web's drill-down queries, as lead-list presets.
  // Dates travel as ISO text so the route params stay plain data.
  const S = rangeStart.toISOString();
  const E = rangeEnd.toISOString();
  const closedStatuses = 'status.in.(DEAL_CLOSED_WON,DEAL_CLOSED_LOST)';
  const wonQ = { extra: [eq('status', 'DEAL_CLOSED_WON')], dateField: 'updated_at', start: S, end: E };
  const closingQ = { extra: [or(eq('status', 'NEGOTIATING'), eq('status', 'SITE_VISIT_DONE')), notNull('offer_sent_at')] };
  const closedQ = { extra: [closedStatuses], dateField: 'updated_at', start: S, end: E };
  const newLeadsQ = { start: S, end: E };
  const visitsQ = { extra: ['site_visit_done_date.not.is.null'], dateField: 'site_visit_done_date', start: S, end: E };
  const open = (title, q) => () => navigation.navigate('LeadList', { preset: { title, involved: true, ...q } });
  // Without offer_sent_at the offer gate is not a predicate, so the lead list
  // could only show leads this page hides: the card does not open then.
  const openClosing = offerCol ? open('Pipeline · Deals to close', closingQ) : undefined;

  // Team members (by deals won, then revenue): agent_lead_stats when 0011 is
  // present, the same reduction over the book when it is not.
  const byId = {}; (agents || []).forEach((a) => { byId[a.userId] = a; });
  const members = teamUsers
    .filter((u) => [ROLES.AGENT, ROLES.TL].includes(u.role))
    .map((u) => {
      if (agents) { const a = byId[u.id]; return { u, won: a?.won || 0, rev: a?.revenue || 0, more: a || null }; }
      const uLeads = leads.filter((l) => l.assignedTo === u.id || (l.previousAssignees || []).includes(u.id));
      const uWon = uLeads.filter((l) => l.status === 'DEAL_CLOSED_WON');
      return { u, won: uWon.length, rev: uWon.reduce((s, l) => s + (l.dealValue || 0), 0), more: null };
    })
    .sort((a, b) => b.won - a.won || b.rev - a.rev || String(a.u.name).localeCompare(String(b.u.name)));
  const shownMembers = members.slice(0, CAP);

  const scored = closing
    .map((l) => ({ l, score: scoreLead(l, db.activities?.[l.id] || []) }))
    .sort((a, b) => b.score - a.score);
  const closingLoading = !ready || (needBook ? !bookReady : closingRows === null);
  const closingCount = rollup && offerCol ? rollup.closing_count : closing.length;
  const month = preset === 'thisMonth';
  const n = (x) => (pending ? null : x);

  return (
    <>
      <Section title="Team numbers">
        <ChipBar pad={false} options={TL_OPTIONS} value={preset} onChange={setPreset} />
        <Row wrap gap={space.md}>
          <Stat label={month ? 'Month revenue' : 'Revenue'} tone="brand" icon="payments" value={n(fmtBDT(rev))} onPress={open('Revenue · Deals Won', wonQ)} />
          <Stat label="Pipeline value" tone="warn" icon="request-quote" value={n(fmtBDT(pipe))} onPress={openClosing} />
          <Stat label="Deals won / closed" icon="emoji-events" value={n(`${wonN}/${wonN + lostN}`)} onPress={open('Deals Closed', closedQ)} />
          <Stat label="Win rate" tone={wr >= 50 ? 'brand' : undefined} icon="military-tech" value={n(`${wr}%`)} onPress={open('Closed Deals (Won + Lost)', closedQ)} />
          <Stat label={month ? 'New this month' : 'New customers'} tone="info" icon="person-add" value={n(newLeads)} onPress={open('New Customers', newLeadsQ)} />
          <Stat label="Site visits done" tone="teal" icon="location-on" value={n(siteVisits)} onPress={open('Site Visits Done', visitsQ)} />
          <Stat label="Proposals sent" tone="purple" icon="description" value={n(offersSent)} />
          <Stat label="Team talk time" icon="call" value={n(`${talkMins} min`)} />
        </Row>
      </Section>

      <Section title="Deals to close"
        action={openClosing && closingCount > CAP ? <SeeAll label={`See all ${closingCount}`} onPress={openClosing} /> : null}>
        <Card style={{ gap: 0 }}>
          {closingLoading ? <Loading label="Loading deals…" /> : !scored.length ? (
            <View style={{ gap: 2 }}>
              <T v="strong">Nothing to close</T>
              <T v="small" tone="mute">No deals with an offer waiting to close.</T>
            </View>
          ) : (
            <>
              <T v="small" tone="mute">{closingCount} {closingCount === 1 ? 'deal' : 'deals'} to close · {fmtBDT(pipe)} in pipeline</T>
              {scored.slice(0, CAP).map(({ l, score }, i, arr) => {
                const sl = scoreLabel(score);
                const value = calcPipelineValue(l.id, db);
                // Every row here carries an offer by construction, so the badge says so.
                return (
                  <PersonRow key={l.id} name={l.name} last={i === arr.length - 1}
                    detail={`${leadDisplayStatus(l, { hasOffer: true }).label}${value > 0 ? ' · ' + fmtBDT(value) : ''} · ${fmtAgo(l.updatedAt)}`}
                    onPress={() => navigation.navigate('LeadDetail', { leadId: l.id })}
                    right={(
                      <Row>
                        <Badge label={sl.label} tone={SCORE_TONE[sl.label] || 'neutral'} />
                        {l.phone ? <IconButton name="call" label={`Call ${l.name}`} tone="brand" onPress={() => Linking.openURL(`tel:${l.phone}`).catch(() => {})} /> : null}
                      </Row>
                    )} />
                );
              })}
            </>
          )}
        </Card>
      </Section>

      <Section title="Team members"
        action={canSee(user, 'team') && members.length ? <SeeAll label={members.length > CAP ? `See all ${members.length}` : 'See all'} onPress={() => navigation.navigate('Team')} /> : null}>
        <Card style={{ gap: 0 }}>
          {pending ? <Loading /> : !members.length ? <T tone="mute">No team members yet.</T> : shownMembers.map((m, i) => (
            <PersonRow key={m.u.id} name={m.u.name} last={i === shownMembers.length - 1}
              detail={[
                `${m.won} won · ${fmtBDT(m.rev)}`,
                m.more ? `${m.more.leads} leads · ${m.more.meetingsSet} meetings · ${m.more.visitsDone} visits` : null,
              ].filter(Boolean).join('\n')}
              right={<T v="tiny" tone="mute">#{i + 1}</T>}
              onPress={() => navigation.navigate('AgentDetail', { userId: m.u.id })} />
          ))}
        </Card>
      </Section>

      <Target user={user} />
    </>
  );
}
