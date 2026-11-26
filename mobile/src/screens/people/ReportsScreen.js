// Reports. Port of the web's src/components/views/ReportsView.jsx: booking
// money tiles, sales by project, lead sources, deals won per agent and the unit
// status overview, reduced over the lead book, the bookings and the projects.
// Two additions use the shared libraries the web's dashboards use: the lead
// source card takes a period (leadSourceMix, src/lib/sourceMix.js; "All time" is
// the ReportsView tally), and the conversion funnel comes from buildFunnel
// (src/lib/funnel.js). Bars are plain Views sized by percentage.
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Card, ChipBar, Loading, Row, Screen, Section, Stat, T } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { BarRow, useBookAndActs, usePalette } from './parts';
import { getDB, getLeads, getProperties, getBookings, bookingPaid, bookingDue } from '../../../../src/lib/db.js';
import { fmtBDT, srclabel } from '../../../../src/lib/helpers.js';
import { buildFunnel } from '../../../../src/lib/funnel.js';
import { SOURCE_PERIODS, leadSourceMix } from '../../../../src/lib/sourceMix.js';

function Bars({ data, empty, money }) {
  if (!data.length) return <T tone="mute">{empty}</T>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const sum = data.reduce((s, d) => s + d.value, 0);
  return (
    <View style={{ gap: space.md }}>
      {data.map((d) => (
        <BarRow key={d.label} label={d.label} color={d.color}
          value={money ? fmtBDT(d.value) : d.value}
          sub={!money && d.share && sum ? `${Math.round((d.value / sum) * 100)}%` : null}
          pct={d.value ? Math.max(4, Math.round((d.value / max) * 100)) : 0} />
      ))}
    </View>
  );
}

const ALL_TIME = SOURCE_PERIODS.find((p) => p.all) || SOURCE_PERIODS[0];

export default function ReportsScreen() {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const palette = usePalette();
  const ready = useBookAndActs(); // every lead; the activity window dates the funnel's "connected"
  const [srcLabel, setSrcLabel] = useState(ALL_TIME.label);
  const srcPeriod = SOURCE_PERIODS.find((p) => p.label === srcLabel) || ALL_TIME;

  const db = getDB();
  const leads = getLeads(user);
  const props = getProperties();
  const bookings = getBookings();
  const pick = (i) => palette[i % palette.length];

  const validBookings = bookings.filter((b) => !['EXPIRED', 'CANCELLED'].includes(b.status) && props.some((p) => p.id === b.propertyId));

  // Money tiles
  const totalBooked = validBookings.reduce((s, b) => s + (b.total || 0), 0);
  const collected = validBookings.reduce((s, b) => s + bookingPaid(b), 0);
  const outstanding = validBookings.reduce((s, b) => s + bookingDue(b), 0);
  const unitsAvail = props.reduce((s, p) => s + (p.unitsAvailable || 0), 0);

  // Sales by project (money)
  const byProj = {};
  validBookings.forEach((b) => { byProj[b.propertyName || '—'] = (byProj[b.propertyName || '—'] || 0) + (b.total || 0); });
  const salesByProject = Object.entries(byProj).map(([label, value], i) => ({ label, value, color: pick(i) }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  // Lead sources
  const mix = useMemo(
    () => leadSourceMix(leads, srcPeriod, { companyId: user.companyId }),
    [leads, srcPeriod, user.companyId, dbVersion, ready] // eslint-disable-line react-hooks/exhaustive-deps -- the lead cache mutates in place
  );
  const leadSources = Object.entries(mix.counts)
    .map(([key, value]) => ({ label: key === 'UNKNOWN' ? 'Unknown' : srclabel(key), value, share: true }))
    .sort((a, b) => b.value - a.value)
    .map((d, i) => ({ ...d, color: pick(i) }));
  // Change against the equal period before (LeadSourcesCard.jsx).
  const diff = mix.prevTotal == null ? 0 : mix.total - mix.prevTotal;
  const change = mix.prevTotal == null ? null
    : mix.prevTotal ? `${diff > 0 ? '▲' : diff < 0 ? '▼' : ''} ${Math.abs((diff / mix.prevTotal) * 100).toFixed(1)}% vs the period before`
    : mix.total ? 'New vs the period before' : null;

  // Conversion funnel: of all leads in scope, how far each got (cumulative).
  const funnel = buildFunnel(leads, db.activities || {});
  const fTop = funnel.length ? funnel[0].value : 0;
  const FUNNEL_COLORS = [t.sub, t.info, t.warn, t.teal, t.brand];

  // Agent performance (deals won)
  const byAgent = {};
  leads.filter((l) => l.status === 'DEAL_CLOSED_WON').forEach((l) => { const k = l.assignedToName || '—'; byAgent[k] = (byAgent[k] || 0) + 1; });
  const agentPerf = Object.entries(byAgent).map(([label, value], i) => ({ label, value, color: pick(i) }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  // Unit status overview
  let avail = 0; let reserved = 0; let sold = 0;
  props.forEach((p) => {
    if (p.units && p.units.length) {
      p.units.forEach((u) => {
        if (u.status === 'available') avail++;
        else if (u.status === 'locked') reserved++;
        else sold++; // sold / booked
      });
    } else {
      avail += p.unitsAvailable || 0;
      sold += Math.max(0, (p.totalUnits || 0) - (p.unitsAvailable || 0));
    }
  });
  const unitStatus = [
    { label: 'Available', value: avail, color: t.brand },
    { label: 'Reserved', value: reserved, color: t.warn },
    { label: 'Sold / Booked', value: sold, color: t.sub },
  ];

  return (
    <Screen>
      <Row wrap gap={space.md}>
        <Stat label="Total booked" value={fmtBDT(totalBooked)} icon="receipt-long" />
        <Stat label="Collected" value={fmtBDT(collected)} tone="brand" icon="payments" />
        <Stat label="Outstanding" value={fmtBDT(outstanding)} tone="warn" icon="hourglass-bottom" />
        <Stat label="Units available" value={unitsAvail} tone="info" icon="meeting-room" />
      </Row>

      <Section title="Sales by project">
        <Card><Bars data={salesByProject} money empty="No data yet." /></Card>
      </Section>

      <Section title="Lead sources">
        <ChipBar pad={false} value={srcLabel} onChange={setSrcLabel}
          options={[ALL_TIME, ...SOURCE_PERIODS.filter((p) => !p.all)].map((p) => ({ value: p.label, label: p.label }))} />
        <Card>
          {!ready ? <Loading label="Loading leads…" /> : (
            <>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <Row gap={6} style={{ alignItems: 'flex-end' }}>
                  <T v="num">{mix.total.toLocaleString('en-US')}</T>
                  <T v="small" tone="sub" style={{ marginBottom: 3 }}>leads</T>
                </Row>
                {change ? <T v="small" tone={diff > 0 ? 'brand' : diff < 0 ? 'danger' : 'mute'}>{change}</T> : null}
              </Row>
              <Bars data={leadSources} empty={srcPeriod.all ? 'No leads yet.' : `No new leads in the ${srcPeriod.label.toLowerCase()}.`} />
            </>
          )}
        </Card>
      </Section>

      <Section title="Conversion funnel">
        <Card>
          {!ready ? <Loading label="Loading leads…" /> : !fTop ? <T tone="mute">No leads yet.</T> : (
            <View style={{ gap: space.md }}>
              <T v="small" tone="mute">Every lead in your scope · cumulative, % of all leads</T>
              {funnel.map((s, i) => (
                <BarRow key={s.key} label={s.label} value={s.value} color={FUNNEL_COLORS[i % FUNNEL_COLORS.length]}
                  sub={`${Math.round((s.value / fTop) * 100)}%`} pct={(s.value / fTop) * 100} />
              ))}
            </View>
          )}
        </Card>
      </Section>

      <Section title="Agent performance · deals won">
        <Card>{!ready ? <Loading label="Loading leads…" /> : <Bars data={agentPerf} empty="No closed deals yet." />}</Card>
      </Section>

      <Section title="Unit status overview">
        <Card><Bars data={unitStatus} empty="No units yet." /></Card>
      </Section>
    </Screen>
  );
}
