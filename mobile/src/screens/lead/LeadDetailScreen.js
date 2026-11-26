// One customer: who they are, what to do next, and everything done so far.
// The action set is the web LeadPanel's, rule for rule (src/components/LeadPanel.jsx):
// which buttons a role sees at which status is decided by the same conditions.
import { useEffect, useLayoutEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Badge, Button, Card, Empty, Icon, IconButton, Loading, Row, Screen, Section, StatusBadge, T, useUI } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { NoteSheet, LogCallSheet, FollowUpSheet, MeetingSheet, VisitSheet, DealSheet, LostSheet } from './sheets';
import {
  getLead, getActs, ensureLead, ensureLeadActs, hasFullActs, changeStatus, doneVisit, deleteLead, logNoAnswer,
  noAnswerLock, attendMeeting, userNameById, MAX_ATTEMPTS, followUpBlock, setNoLongerResponding, clearFollowupSuppression,
} from '../../../../src/lib/db.js';
import { hasColumn } from '../../../../src/lib/supabase.js';
import { fmtD, fmtDT, fmtBDT, rlabel, scoreLead, scoreLabel, fmtDateTimeAP, actIcon, parseOfferDesc } from '../../../../src/lib/helpers.js';
import { ROLES, SRC_LABELS, effectiveRole, isNiHandler, canSelfForward, canSee, PAST_QUALIFY } from '../../../../src/lib/constants.js';

const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());
const SHARED_LABEL = { price: 'Price idea', brochure: 'Brochure', floor_plan: 'Floor plan', video: 'Video', image: 'Image' };
const digits = (p) => String(p || '').replace(/[^0-9+]/g, '');
const open = (url) => Linking.openURL(url).catch(() => {});

function Info({ l }) {
  const t = useTheme();
  const phones = (l.phones?.length ? l.phones : [l.phone]).filter(Boolean);
  const emails = (l.emails?.length ? l.emails : l.email ? [l.email] : []).filter(Boolean);
  const eyebrow = [SRC_LABELS[l.source] || l.source || 'Lead', (l.company && l.company !== '—') ? l.company : null].filter(Boolean).join('  •  ');

  const specs = [];
  if (l.propertyInterest) specs.push(['Project', l.propertyInterest]);
  if (l.dealValue > 0) specs.push(['Deal value', fmtBDT(l.dealValue)]);
  if (l.meetingAt) specs.push(['Meeting', (l.meetingType === 'OFFLINE' ? 'Offline' : 'Online') + ' · ' + fmtDateTimeAP(l.meetingAt)]);
  if (l.meetingShared?.length) specs.push(['Already shared', l.meetingShared.map((k) => SHARED_LABEL[k] || k).join(', ')]);
  if (l.meetingDate) specs.push(['Site visit', fmtDT(l.meetingDate) + (l.meetingLocation ? ' · ' + l.meetingLocation : '')]);
  if (l.visitProjects?.length) specs.push(['Visit projects', l.visitProjects.map((p) => p.name).join(', ')]);
  if (l.city || l.profession) specs.push(['Location', [l.city, l.profession].filter(Boolean).join(' · ')]);
  if (l.priority) specs.push(['Priority', l.priority + (l.preferredTime ? ' · ' + l.preferredTime : '')]);
  if (l.nextFollowup) specs.push(['Follow-up', fmtD(l.nextFollowup)]);
  specs.push(['Assigned', (userNameById(l.assignedTo, l.assignedToName) || 'Unassigned') + (l.assignedRole ? ' · ' + rlabel(l.assignedRole) : '')]);
  specs.push(['Lead ID', leadCode(l)]);
  if (l.createdAt) specs.push(['Created', fmtDT(l.createdAt)]);
  const stats = [['Calls', l.callCount], ['SMS', l.smsCount], ['WhatsApp', l.whatsappCount], ['Visits', l.visitCount]];

  return (
    <Card>
      <T v="tiny" tone="mute">{eyebrow.toUpperCase()}</T>
      <T v="title">{l.name || 'Unnamed customer'}</T>
      <Row wrap>
        <StatusBadge lead={l} />
        {l.nextFollowup && ['NEW', 'CONTACTED', 'INTERESTED'].includes(l.status) ? <Badge label={fmtDT(l.nextFollowup)} tone="warn" icon="alarm" /> : null}
      </Row>

      {phones.map((p, i) => (
        <Row key={'p' + i} style={{ marginTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <T v="strong">{p}</T>
            {i === 0 && phones.length > 1 ? <T v="small" tone="mute">Primary</T> : null}
          </View>
          <IconButton name="call" label={`Call ${p}`} tone="brand" onPress={() => open(`tel:${digits(p)}`)} />
          <IconButton name="chat" label={`WhatsApp ${p}`} tone="teal" onPress={() => open(`https://wa.me/${digits(p).replace(/^\+/, '')}`)} />
          <IconButton name="sms" label={`Text ${p}`} tone="info" onPress={() => open(`sms:${digits(p)}`)} />
        </Row>
      ))}
      {emails.map((e, i) => (
        <Row key={'e' + i}>
          <T style={{ flex: 1 }}>{e}</T>
          <IconButton name="mail" label={`Email ${e}`} tone="info" onPress={() => open(`mailto:${e}`)} />
        </Row>
      ))}
      {l.meetingLink ? <Button label="Join online meeting" icon="videocam" variant="soft" tone="purple" onPress={() => open(l.meetingLink)} /> : null}

      <View style={{ marginTop: space.sm }}>
        {specs.map(([k, v]) => (
          <Row key={k} style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.line }}>
            <T v="small" tone="mute" style={{ width: 110 }}>{k}</T>
            <T v="small" style={{ flex: 1, textAlign: 'right' }}>{v}</T>
          </Row>
        ))}
      </View>
      <Row style={{ marginTop: space.sm }}>
        {stats.map(([lbl, n]) => (
          <View key={lbl} style={{ flex: 1, alignItems: 'center' }}>
            <T v="h2">{n || 0}</T>
            <T v="small" tone="mute">{lbl}</T>
          </View>
        ))}
      </Row>
    </Card>
  );
}

function Score({ l, acts }) {
  const t = useTheme();
  const score = scoreLead(l, acts);
  const { label, color } = scoreLabel(score);
  const factors = [];
  if (l.callCount > 0) factors.push(l.callCount + ' call' + (l.callCount > 1 ? 's' : ''));
  if (l.visitCount > 0) factors.push(l.visitCount + ' visit' + (l.visitCount > 1 ? 's' : ''));
  if (l.budget > 0) factors.push('Budget set');
  if (l.propertyInterest) factors.push('Project interest');
  if (l.nextFollowup) factors.push('Follow-up scheduled');
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row><Icon name="psychology" size={18} color={color} /><T v="strong">Lead score</T></Row>
        <Row><T v="h2" color={color}>{score}</T><T v="small" color={color}>{label}</T></Row>
      </Row>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: 6, backgroundColor: color }} />
      </View>
      <T v="small" tone="mute">{factors.length ? factors.join(' · ') : 'Limited data'}</T>
    </Card>
  );
}

function Actions({ l, openSheet, navigation }) {
  const { user, refresh } = useApp();
  const { toast, confirm } = useUI();
  const r = effectiveRole(user);
  const [naBusy, setNaBusy] = useState(false);
  const [has0049, setHas0049] = useState(false);
  useEffect(() => {
    let live = true;
    hasColumn('leads', 'followup_suppressed_at', '').then((ok) => { if (live) setHas0049(ok); });
    return () => { live = false; };
  }, []);

  const doStatus = (s, msg = 'Status updated', kind = 'ok') => { changeStatus(l.id, s, user); refresh(); toast(msg, kind); };
  const doNoAnswer = async () => {
    setNaBusy(true);
    const res = await logNoAnswer(l.id, user);
    setNaBusy(false);
    refresh();
    if (res.error) toast('Could not log the attempt. Check the connection and try again.', 'err');
    else if (!res.counted) toast(res.hitCap ? `${MAX_ATTEMPTS} attempts already used. Follow-ups are off.` : 'Follow-ups are off for this lead', 'warn');
    else if (res.hitCap) toast(`${MAX_ATTEMPTS} attempts reached. Follow-ups stopped.`, 'warn');
    else toast(`No answer logged (${res.attempts}/${MAX_ATTEMPTS})`);
  };

  const block = followUpBlock(l);
  const supervisor = r === ROLES.TL || r === ROLES.MGMT;
  const mayStop = has0049 && !block && (l.assignedTo === user.id || supervisor);
  const mayResume = has0049 && !!l.followupSuppressedAt && l.followupSuppressedReason !== 'NOT_INTERESTED_X2' && supervisor;
  const attemptLabel = 'Attempt' + (l.noAnswerCount > 0 ? ` (${l.noAnswerCount}/${MAX_ATTEMPTS})` : '');

  // A lock from before migration 0049 still freezes the agent's actions until it lapses.
  const lockUntil = r === ROLES.AGENT ? noAnswerLock(l) : null;
  if (lockUntil) {
    const retry = lockUntil.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
      <Section title="Actions">
        <Card><Row><Icon name="lock" /><View style={{ flex: 1 }}><T v="strong" tone="warn">Locked: 7 attempts used</T><T v="small" tone="sub">No answer after 7 attempts. Try again after {retry}.</T></View></Row></Card>
        <Button label="Interested" icon="thumb-up" disabled />
      </Section>
    );
  }

  const b = [];
  const add = (key, props) => b.push(<Button key={key} {...props} />);
  const s = l.status;

  if (r === ROLES.AGENT) {
    if (s === 'NEW') add('contacted', { label: 'Connected', icon: 'phone-callback', onPress: () => doStatus('CONTACTED') });
    add('interested', { label: 'Interested', icon: 'thumb-up', variant: 'soft', tone: 'brand', disabled: PAST_QUALIFY.includes(s), onPress: () => doStatus('INTERESTED') });
    if (s === 'INTERESTED' && canSee(user, 'meeting')) add('set-meeting', { label: 'Set meeting', icon: 'event', variant: 'soft', tone: 'teal', onPress: () => openSheet('meeting') });
    if (['NEW', 'CONTACTED', 'INTERESTED', 'MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE'].includes(s)) {
      add('notint', { label: 'Not interested', icon: 'thumb-down', variant: 'ghost', onPress: () => doStatus('NOT_INTERESTED', 'Marked as Not Interested', 'warn') });
    }
    if (['NEW', 'CONTACTED', 'INTERESTED'].includes(s) && !block) add('noans', { label: attemptLabel, icon: 'phone-missed', variant: 'ghost', busy: naBusy, onPress: doNoAnswer });
    if (s === 'MEETING_SET' && !l.meetingAttended) add('attend', { label: 'Attend meeting', icon: 'how-to-reg', variant: 'soft', tone: 'brand', onPress: () => { attendMeeting(l.id, user); refresh(); toast('Meeting marked as attended'); } });
    if ((s === 'MEETING_SET' || l.meetingAt) && !l.meetingAttended) add('resched', { label: 'Reschedule meeting', icon: 'event-repeat', variant: 'soft', tone: 'info', onPress: () => openSheet('reschedule') });
    if (s === 'MEETING_SET') add('sched', { label: 'Schedule site visit', icon: 'calendar-month', variant: 'soft', tone: 'teal', onPress: () => openSheet('visit') });
    if (s === 'SITE_VISIT_SCHEDULED') add('done-visit', { label: 'Mark visit as done', icon: 'check-circle', variant: 'soft', tone: 'brand', onPress: () => { doneVisit(l.id, user); refresh(); toast('Visit marked as done'); } });
    if (['MEETING_SET', 'SITE_VISIT_SCHEDULED'].includes(s) && !block) add('mt-attempt', { label: attemptLabel, icon: 'phone-missed', variant: 'ghost', busy: naBusy, onPress: doNoAnswer });
    const teamRoute = !['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(s) && l.assignedTo === user.id;
    const tlRoute = s === 'SITE_VISIT_DONE';
    const selfRoute = canSelfForward(user) && l.assignedTo !== user.id;
    if (teamRoute || tlRoute || selfRoute) add('fwd', { label: 'Forward to agent', icon: 'swap-horiz', variant: 'ghost', onPress: () => navigation.navigate('ForwardLead', { leadId: l.id }) });
  }

  // The Not Interested handler re-engages a lead with the first-contact buttons.
  if (isNiHandler(user) && s === 'NOT_INTERESTED') {
    add('ni-contacted', { label: 'Connected', icon: 'phone-callback', onPress: () => doStatus('CONTACTED') });
    add('ni-interested', { label: 'Interested', icon: 'thumb-up', variant: 'soft', tone: 'brand', onPress: () => doStatus('INTERESTED') });
    if (!block) add('ni-noans', { label: attemptLabel, icon: 'phone-missed', variant: 'ghost', busy: naBusy, onPress: doNoAnswer });
  }

  if (r === ROLES.TL || r === ROLES.MGMT) {
    const inDeal = ['MEETING_SET', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATING'].includes(s);
    if (inDeal) add('deal', { label: 'Close as won', icon: 'emoji-events', onPress: () => openSheet('deal') });
    if (inDeal && s !== 'NEGOTIATING') add('neg', { label: 'Mark as negotiating', icon: 'balance', variant: 'soft', tone: 'warn', onPress: () => doStatus('NEGOTIATING') });
    if (inDeal) add('lost', { label: 'Mark as lost', icon: 'thumb-down', variant: 'soft', tone: 'danger', onPress: () => openSheet('lost') });
  }
  if (r === ROLES.MGMT) add('transfer', { label: 'Transfer lead', icon: 'swap-horiz', variant: 'soft', tone: 'purple', onPress: () => navigation.navigate('TransferLead', { leadIds: [l.id] }) });

  if (mayStop) add('no-longer', {
    label: 'No longer responding', icon: 'voice-over-off', variant: 'ghost',
    onPress: () => confirm({
      title: 'Stop follow-ups for this lead?', description: 'The lead and its status stay as they are.', confirmLabel: 'Stop follow-ups',
      onConfirm: () => { setNoLongerResponding(l.id, user); refresh(); toast('Follow-ups stopped. No longer responding.', 'warn'); },
    }),
  });
  if (mayResume) add('resume', { label: 'Resume follow-ups', icon: 'alarm-on', variant: 'ghost', onPress: () => { clearFollowupSuppression(l.id, user); refresh(); toast('Follow-ups resumed'); } });

  if (!block || block === 'closed') add('followup', { label: 'Follow-up', icon: 'alarm', variant: 'soft', tone: 'warn', onPress: () => openSheet('followup') });
  add('log-call', { label: 'Log call', icon: 'call', variant: 'soft', tone: 'info', onPress: () => openSheet('call') });
  add('note', { label: 'Add note', icon: 'edit-note', variant: 'ghost', onPress: () => openSheet('note') });

  return <Section title="Actions"><View style={{ gap: space.sm }}>{b}</View></Section>;
}

function Offer({ acts }) {
  const offer = acts.find((a) => a.type === 'OFFER');
  const data = offer ? parseOfferDesc(offer.description) : null;
  if (!data) return null;
  return (
    <Section title="Offer">
      <Card>
        {data.rows.map((row) => (
          <Row key={row.label} style={{ justifyContent: 'space-between' }}>
            <T v="small" tone="mute">{row.label}</T>
            <T v={row.strong ? 'strong' : 'body'}>{row.value}</T>
          </Row>
        ))}
        {data.notes ? <T v="small" tone="sub">{data.notes}</T> : null}
        <T v="small" tone="mute">Submitted by {userNameById(offer.userId, offer.userName)}</T>
      </Card>
    </Section>
  );
}

function Timeline({ acts, lead, loading }) {
  const t = useTheme();
  const items = acts.map((a) => ({
    id: a.id, type: a.type,
    actor: userNameById(a.userId, (a.userName && a.userName !== 'system') ? a.userName : null),
    text: a.type === 'OFFER' ? 'Offer submitted' : a.description,
    sub: a.durationSeconds > 0 ? `${Math.floor(a.durationSeconds / 60)}m ${a.durationSeconds % 60}s · ${fmtDT(a.timestamp)}` : fmtDT(a.timestamp),
  }));
  if (lead?.notes && lead.notes.trim()) items.unshift({ id: 'lead-notes', type: 'NOTE', actor: 'Customer message logs', text: lead.notes, sub: fmtDT(lead.createdAt) });
  return (
    <Section title="Activity">
      <Card>
        {loading ? <Loading label="Loading activity…" /> : !items.length ? <T tone="mute">No activity yet</T> : items.map((a, i) => (
          <Row key={a.id} style={{ alignItems: 'flex-start', paddingVertical: space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.line }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={actIcon(a.type)} size={16} color={t.sub} />
            </View>
            <View style={{ flex: 1 }}>
              {a.actor ? <T v="small" tone="brand" style={{ fontWeight: '700' }}>{a.actor}</T> : null}
              <T v="small">{a.text}</T>
              <T v="small" tone="mute">{a.sub}</T>
            </View>
          </Row>
        ))}
      </Card>
    </Section>
  );
}

export default function LeadDetailScreen({ route, navigation }) {
  const leadId = route.params?.leadId;
  const { user, refresh, dbVersion } = useApp();
  const { toast, confirm } = useUI();
  void dbVersion; // re-read the store after any change
  const l = leadId ? getLead(leadId) : null;
  const acts = leadId ? getActs(leadId) : [];
  const [sheet, setSheet] = useState(null);
  const [leadAsked, setLeadAsked] = useState(false);
  const [actsReady, setActsReady] = useState(() => !!leadId && hasFullActs(leadId));

  // The lead row and its history are fetched for this one lead; whatever is
  // cached shows at once and the fetch refreshes underneath.
  useEffect(() => {
    if (!leadId) return undefined;
    let alive = true;
    ensureLead(leadId).then((changed) => { if (!alive) return; setLeadAsked(true); if (changed) refresh(); });
    ensureLeadActs(leadId).then((changed) => { if (!alive) return; setActsReady(true); if (changed) refresh(); });
    return () => { alive = false; };
  }, [leadId, refresh]);

  const canDelete = user?.role === ROLES.MGMT || user?.role === ROLES.MASTER;
  useLayoutEffect(() => {
    navigation.setOptions({
      title: l ? (l.name || 'Customer') : 'Customer',
      headerRight: () => (l ? (
        <Row gap={0}>
          <IconButton name="edit" label="Edit customer" onPress={() => navigation.navigate('EditLead', { leadId })} />
          {canDelete ? (
            <IconButton name="delete" label="Delete customer" tone="danger" onPress={() => confirm({
              title: `Delete "${l.name || 'this customer'}"?`, description: 'This cannot be undone.', confirmLabel: 'Delete', danger: true,
              onConfirm: () => { deleteLead(leadId, user); refresh(); navigation.goBack(); toast('Customer deleted'); },
            })} />
          ) : null}
        </Row>
      ) : null),
    });
  }, [navigation, l?.name, leadId, canDelete]); // eslint-disable-line react-hooks/exhaustive-deps -- header follows the lead's name

  if (!l) {
    return <Screen>{leadAsked ? <Empty icon="person-search" title="Customer not found" hint="It may have been deleted or moved to another team." /> : <Loading label="Loading customer…" />}</Screen>;
  }
  const close = () => setSheet(null);
  return (
    <Screen>
      <Info l={l} />
      <Score l={l} acts={acts} />
      <Actions l={l} openSheet={setSheet} navigation={navigation} />
      <Offer acts={acts} />
      <Timeline acts={acts} lead={l} loading={!actsReady && !acts.length} />

      <NoteSheet visible={sheet === 'note'} onClose={close} lead={l} />
      <LogCallSheet visible={sheet === 'call'} onClose={close} lead={l} />
      <FollowUpSheet visible={sheet === 'followup'} onClose={close} lead={l} />
      <MeetingSheet visible={sheet === 'meeting'} onClose={close} lead={l} />
      <MeetingSheet visible={sheet === 'reschedule'} onClose={close} lead={l} reschedule />
      <VisitSheet visible={sheet === 'visit'} onClose={close} lead={l} />
      <DealSheet visible={sheet === 'deal'} onClose={close} lead={l} />
      <LostSheet visible={sheet === 'lost'} onClose={close} lead={l} />
    </Screen>
  );
}
