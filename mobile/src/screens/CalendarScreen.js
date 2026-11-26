// The calendar (web: src/components/views/CalendarView.jsx and its parts in
// views/calendar/: SummaryCards, MonthCalendar, DaySchedule, UpcomingList).
// On a phone it is an agenda: a week strip to pick a day (with arrows to page a
// week back or forward), that day's three counts and its schedule, then the
// web's "Upcoming, next 30 days" list. Every row opens its lead.
//
// The web calendar shows two kinds of event, both derived from lead fields: a
// meeting (lead.meetingAt) and a site visit (lead.meetingDate). It has no
// filters and does not show follow-ups, so neither does this.
import { useMemo, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';
import { Badge, Card, Icon, IconButton, Loading, Row, Screen, T } from '../ui';
import { useTheme, toneColors, space, radius } from '../theme';
import { useApp } from '../store';
import { useLeadBook } from '../hooks';
import { getLeads, getBookingByLead, bookingPaid, bookingDue } from '../../../src/lib/db.js';

// ── The event model. Copied from src/components/views/calendar/events.js: it
// sits under components/, which the app may not import, and has no twin in
// src/lib. Keep the two in step.
const dayKey = (d) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// Human id for the row: the external id when the lead came from an import/ad.
const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());
const eventType = (e) => (e.kind === 'visit' ? 'Site visit' : e.off ? 'Offline meeting' : 'Online meeting');
// The web's dot colours (teal / orange / accent) as theme tones.
const eventTone = (e) => (e.kind === 'visit' ? 'teal' : e.off ? 'warn' : 'brand');
// The web's pill tones as theme tones.
const PILL = { ok: 'brand', warn: 'warn', bad: 'danger', muted: 'neutral' };

// cancelled: the lead is dead, so the slot will not happen.
// confirmed: the visit is done, or the meeting was attended. pending: not yet.
function statusOf(e) {
  const l = e.lead;
  if (['DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(l.status)) return { label: 'cancelled', tone: 'bad' };
  if (e.kind === 'visit' && l.status === 'SITE_VISIT_DONE') return { label: 'confirmed', tone: 'ok' };
  if (e.kind === 'meeting' && l.meetingAttended) return { label: 'confirmed', tone: 'ok' };
  return { label: 'pending', tone: 'warn' };
}
// Payment comes from the lead's booking. No booking is not the same as unpaid.
function paymentOf(e) {
  const b = getBookingByLead(e.lead.id);
  if (!b) return { label: 'No booking', tone: 'muted', unpaid: false };
  const paid = bookingPaid(b);
  const due = bookingDue(b);
  const method = (b.payments || []).length ? b.payments[b.payments.length - 1].method : '';
  if (paid > 0 && due === 0) return { label: method ? `Paid (${method})` : 'Paid', tone: 'ok', unpaid: false };
  if (paid > 0) return { label: method ? `Part paid (${method})` : 'Part paid', tone: 'warn', unpaid: true };
  return { label: 'Unpaid', tone: 'bad', unpaid: true };
}
// Every meeting/visit the current user is involved with, oldest first.
function buildEvents(user) {
  const events = [];
  getLeads(user, { involved: true }).forEach((l) => {
    if (l.meetingAt) events.push({ id: l.id + '-m', lead: l, at: l.meetingAt, kind: 'meeting', off: l.meetingType === 'OFFLINE' });
    if (l.meetingDate && ['SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE'].includes(l.status)) {
      events.push({ id: l.id + '-v', lead: l, at: l.meetingDate, kind: 'visit' });
    }
  });
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}
function groupByDay(events) {
  const map = {};
  events.forEach((e) => { (map[dayKey(e.at)] ||= []).push(e); });
  return map;
}
// ── end of the copied model ──

function Dot({ tone, size = 8 }) {
  const t = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: toneColors(t, tone).fg }} />;
}

function EventRow({ e, upcoming, onPress }) {
  const t = useTheme();
  const st = statusOf(e);
  const pay = paymentOf(e);
  const d = new Date(e.at);
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: t.card, borderRadius: radius.lg, padding: space.md, opacity: pressed ? 0.7 : 1 })}>
      {upcoming ? (
        <View style={{ width: 46, height: 46, borderRadius: radius.md, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          <T v="tiny" tone="mute" style={{ fontSize: 10 }}>{MON_SHORT[d.getMonth()]}</T>
          <T v="strong">{d.getDate()}</T>
        </View>
      ) : (
        <T v="small" style={{ width: 66, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{timeOf(e.at)}</T>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <T v="strong" numberOfLines={1}>{e.lead.name || 'Unnamed customer'}</T>
        <Row gap={6}>
          <Dot tone={eventTone(e)} />
          <T v="small" tone="sub" numberOfLines={1} style={{ flex: 1 }}>
            {[upcoming ? timeOf(e.at) : null, eventType(e), leadCode(e.lead)].filter(Boolean).join(' · ')}
          </T>
        </Row>
        <Row wrap gap={6}>
          <Badge label={st.label} tone={PILL[st.tone]} />
          <Badge label={pay.label} tone={PILL[pay.tone]} />
        </Row>
      </View>
      <Icon name="chevron-right" color={t.mute} />
    </Pressable>
  );
}

function Count({ label, value, tone, icon }) {
  const t = useTheme();
  const fg = tone ? toneColors(t, tone).fg : t.sub;
  return (
    <Card style={{ flex: 1, gap: 2, padding: space.md }}>
      <Row gap={4}><Icon name={icon} size={15} color={fg} /><T v="small" tone="sub" numberOfLines={1} style={{ flex: 1 }}>{label}</T></Row>
      <T v="num" color={tone ? fg : undefined}>{value}</T>
    </Card>
  );
}

export default function CalendarScreen({ navigation }) {
  const { user, dbVersion } = useApp();
  const t = useTheme();
  const ready = useLeadBook(); // this view reduces over every lead; leads are not in the boot load
  const [cursor, setCursor] = useState(() => startOfDay(new Date())); // the selected day
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date())); // first day in the strip

  // buildEvents reads the mutable store; dbVersion is the signal that it changed.
  const events = useMemo(() => (ready ? buildEvents(user) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, user, dbVersion]);
  const byDay = useMemo(() => groupByDay(events), [events]);

  if (!ready) return <Screen><Loading label="Loading the calendar…" /></Screen>;

  const todayK = dayKey(new Date());
  const cursorK = dayKey(cursor);
  const isToday = cursorK === todayK;
  const dayEvents = byDay[cursorK] || [];
  const confirmed = dayEvents.filter((e) => statusOf(e).tone === 'ok').length;
  const pending = dayEvents.filter((e) => statusOf(e).tone === 'warn').length;

  // Next 30 days, from right now (so today's already-passed slots drop off).
  const upcomingTo = startOfDay(new Date());
  upcomingTo.setDate(upcomingTo.getDate() + 30);
  upcomingTo.setHours(23, 59, 59, 999);
  const now = new Date();
  const upcoming = events.filter((e) => { const at = new Date(e.at); return at >= now && at <= upcomingTo; });

  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  // Paging the strip does not move the selection (the web's month paging does not either).
  const stepWeek = (dir) => { const d = new Date(weekStart); d.setDate(d.getDate() + dir * 7); setWeekStart(d); };
  const goToday = () => { const d = startOfDay(new Date()); setWeekStart(d); setCursor(d); };
  const last = week[6];
  const span = week[0].getMonth() === last.getMonth()
    ? `${MONTHS[week[0].getMonth()]} ${week[0].getFullYear()}`
    : `${MONTHS[week[0].getMonth()].slice(0, 3)} – ${MONTHS[last.getMonth()].slice(0, 3)} ${last.getFullYear()}`;
  const open = (e) => navigation.navigate('LeadDetail', { leadId: e.lead.id });

  const header = (
    <View style={{ gap: space.md, paddingTop: space.md, paddingBottom: space.sm }}>
      <Card style={{ padding: space.sm, gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton name="chevron-left" label="Previous week" onPress={() => stepWeek(-1)} />
          <T v="strong" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>{span}</T>
          <Pressable onPress={goToday} accessibilityRole="button" accessibilityLabel="Go to today" hitSlop={6}
            style={{ minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: t.brandSoft, justifyContent: 'center' }}>
            <T v="small" color={t.brand} style={{ fontWeight: '700' }}>Today</T>
          </Pressable>
          <IconButton name="chevron-right" label="Next week" onPress={() => stepWeek(1)} />
        </Row>
        <Row gap={4}>
          {week.map((d) => {
            const k = dayKey(d);
            const on = k === cursorK;
            const items = byDay[k] || [];
            // Up to 3 dots; distinct kinds only, so a busy day does not smear.
            const dots = [...new Set(items.map(eventTone))].slice(0, 3);
            return (
              <Pressable key={k} onPress={() => setCursor(startOfDay(d))} accessibilityRole="button" accessibilityState={{ selected: on }}
                accessibilityLabel={`${d.getDate()} ${MONTHS[d.getMonth()]}, ${items.length} appointment${items.length === 1 ? '' : 's'}`}
                style={{ flex: 1, minHeight: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? t.brand : 'transparent', borderWidth: 1, borderColor: on ? t.brand : k === todayK ? t.brand : 'transparent' }}>
                <T v="tiny" color={on ? t.onBrand : t.mute}>{WEEKDAYS[d.getDay()]}</T>
                <T v="strong" color={on ? t.onBrand : t.text}>{d.getDate()}</T>
                <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
                  {dots.map((tone) => (
                    <View key={tone} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: on ? t.onBrand : toneColors(t, tone).fg }} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </Row>
      </Card>
      <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
        <Count label={isToday ? 'Today' : 'This day'} value={dayEvents.length} tone="brand" icon="calendar-month" />
        <Count label="Confirmed" value={confirmed} icon="check-circle-outline" />
        <Count label="Pending" value={pending} tone="warn" icon="schedule" />
      </Row>
      <Row gap={space.md} wrap>
        <Row gap={5}><Dot tone="brand" /><T v="small" tone="mute">Online meeting</T></Row>
        <Row gap={5}><Dot tone="warn" /><T v="small" tone="mute">Offline meeting</T></Row>
        <Row gap={5}><Dot tone="teal" /><T v="small" tone="mute">Site visit</T></Row>
      </Row>
    </View>
  );

  const sections = [
    { key: 'day', title: isToday ? "Today's schedule" : 'Schedule', sub: `${cursor.getDate()} ${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`,
      count: `${dayEvents.length} appointment${dayEvents.length === 1 ? '' : 's'}`, none: 'Nothing scheduled for this day.', noneIcon: 'event-busy', data: dayEvents },
    { key: 'up', title: 'Upcoming', sub: 'Next 30 days', count: String(upcoming.length), none: 'No appointments in the next 30 days.', noneIcon: 'event', data: upcoming },
  ];

  return (
    <Screen scroll={false}>
      <SectionList
        sections={sections}
        keyExtractor={(e, i) => e.id + ':' + i}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <Row style={{ justifyContent: 'space-between', paddingTop: space.md, paddingBottom: space.sm }}>
            <View style={{ flex: 1 }}>
              <T v="h2">{section.title}</T>
              <T v="small" tone="mute">{section.sub}</T>
            </View>
            <Badge label={section.count} />
          </Row>
        )}
        renderItem={({ item, section }) => <EventRow e={item} upcoming={section.key === 'up'} onPress={() => open(item)} />}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderSectionFooter={({ section }) => (section.data.length ? null : (
          <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <Icon name={section.noneIcon} size={26} color={t.mute} />
            <T v="small" tone="mute">{section.none}</T>
          </Card>
        ))}
      />
    </Screen>
  );
}
