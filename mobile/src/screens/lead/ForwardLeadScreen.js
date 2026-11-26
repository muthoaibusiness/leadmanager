// Forward a lead: one action, up to three destinations. The rules are the
// `forward-agent` half of the web ForwardModal (src/components/modals/ForwardModal.jsx):
//   agent  an agent / team member: a plain hand-off at the current stage
//   tl     the Team Lead: the closing hand-off, which requires the offer
//   self   Self Forward (claimLeadForSelf), shown as the user's own account
// Every path changes only ownership and logs the hand-off; everything else on
// the lead stays. The web's two steps (pick, then offer / confirm) are one page here.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Empty, Field, Icon, Loading, Row, Screen, SearchField, Segmented, T, useUI } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { useLeadBook } from '../../hooks';
import { PersonRow, Hint, ListNote, useDiscardOnBack } from './forward/parts';
import { getDB, fwdLead, getProperties, updLead, offerComplete, getLead, claimLeadForSelf } from '../../../../src/lib/db.js';
import { sbGet, sbGetUsersLite, rToU } from '../../../../src/lib/supabase.js';
import { mergeForwardTargets, extraUsersFilter } from '../../../../src/lib/forwardTargets.js';
import { fmtBDT } from '../../../../src/lib/helpers.js';
import { ROLES, OFFER_MAX, canSelfForward } from '../../../../src/lib/constants.js';
import { forwardDirty } from '../../../../src/lib/forwardDirty.js';

const SELF = '__self__';

export default function ForwardLeadScreen({ navigation, route }) {
  const { user, refresh, dbVersion } = useApp();
  const { toast } = useUI();
  const t = useTheme();
  void dbVersion; // re-read the store after any change
  const leadId = route.params?.leadId || null;
  const lead = leadId ? getLead(leadId) : null;
  const status = lead?.status;

  // The same route rules the lead page uses to decide whether "Forward to agent"
  // shows; here they decide which destinations are offered (ForwardModal.jsx).
  const teamRoute = !!status && !['NEGOTIATING', 'DEAL_CLOSED_WON', 'DEAL_CLOSED_LOST', 'NOT_INTERESTED'].includes(status) && lead?.assignedTo === user.id;
  const tlRoute = status === 'SITE_VISIT_DONE';
  const selfRoute = canSelfForward(user) && lead?.assignedTo !== user.id;
  const dests = [
    { key: 'agent', label: 'Agent / team member', eligible: teamRoute },
    { key: 'tl', label: 'Team Lead', eligible: tlRoute },
    { key: 'self', label: 'Self Forward', eligible: selfRoute },
  ].filter((d) => d.eligible);

  const [dest, setDest] = useState(() => (dests.length ? dests[0].key : 'agent'));
  const [selected, setSelected] = useState(null);
  const [pq, setPq] = useState('');
  const [projectId, setProjectId] = useState('');
  const [ourOffer, setOurOffer] = useState('');
  const [clientOffer, setClientOffer] = useState('');
  const [totalSft, setTotalSft] = useState('');
  const [offerNotes, setOfferNotes] = useState('');
  // Who this lead can be forwarded to. Fetched, not filtered from db.users: an
  // agent's snapshot holds only its own user row, so its teammates are not in it.
  const [fetched, setFetched] = useState({ dest: null, list: [] });
  // Agents outside the team this account may also forward to (users.extra_forward_user_ids, migration 0064).
  const [extraUsers, setExtraUsers] = useState([]);

  // The project list shows live demand (how many leads are already interested in
  // each project), which is a count over the whole book, as on the web.
  useLeadBook(tlRoute);

  useEffect(() => {
    if (!user?.id) return undefined;
    let live = true;
    sbGet(`users?select=extra_forward_user_ids&id=eq.${encodeURIComponent(user.id)}`)
      .then((rows) => { if (live) setExtraUsers(Array.isArray(rows?.[0]?.extra_forward_user_ids) ? rows[0].extra_forward_user_ids : []); });
    return () => { live = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.teamId || dest === 'self') return undefined;
    let live = true;
    // Agent/team-member hand-off: every other agent on the team, including the
    // Team Lead. Executives work leads as agents too (see effectiveRole), so
    // they are valid recipients. The Team Lead destination is a closing
    // hand-off (SITE_VISIT_DONE) that still requires an offer.
    const roleQ = dest === 'tl' ? `role=eq.${ROLES.TL}` : `role=in.(${ROLES.AGENT},${ROLES.MA},${ROLES.EXEC},${ROLES.TL})`;
    // An account with extra_forward_user_ids also sees those agents in the plain hand-off list.
    const extra = dest === 'agent' ? extraUsersFilter(extraUsers) : null;
    Promise.all([
      sbGetUsersLite(`${roleQ}&team_id=eq.${user.teamId}&is_active=not.eq.false`),
      extra ? sbGetUsersLite(extra) : Promise.resolve([]),
    ]).then(([rows, more]) => { if (live) setFetched({ dest, list: mergeForwardTargets((rows || []).map(rToU), (more || []).map(rToU), user.id) }); });
    return () => { live = false; };
  }, [dest, user?.teamId, user?.id, extraUsers]);

  const loadingTargets = !!user?.teamId && dest !== 'self' && fetched.dest !== dest;
  const targets = fetched.dest === dest ? fetched.list : [];

  // Leaving with any destination or offer input asks first (the web's discard guard).
  const dirty = forwardDirty({ selected, pq, projectId, ourOffer, clientOffer, totalSft, offerNotes });
  const leave = useDiscardOnBack(navigation, dirty, { title: 'Discard forward?', description: 'Your unsaved forward details will be lost.' });

  if (!lead) return <Screen><Empty icon="person-search" title="Customer not found" hint="It may have been deleted or moved to another team." /></Screen>;
  if (!dests.length) return <Screen><Empty icon="swap-horiz" title="This lead cannot be forwarded" hint="It is not at a stage, or with an owner, that allows a hand-off." /></Screen>;

  // Project catalog + live demand
  const projects = [...getProperties()].sort((a, b) => a.name.localeCompare(b.name));
  const demand = {};
  getDB().leads.forEach((l) => { const k = l.dealProjectName || l.propertyInterest; if (k) demand[k] = (demand[k] || 0) + 1; });
  const project = projects.find((p) => p.id === projectId) || null;

  const pipelineValue = totalSft && clientOffer ? parseFloat(totalSft) * parseFloat(clientOffer) : 0;
  const offerReady = offerComplete({ ourOffer: parseFloat(ourOffer) || 0, clientOffer: parseFloat(clientOffer) || 0, totalSft: parseFloat(totalSft) || 0 });
  // Both prices are a rate per SFT, so a sixth digit is always a mistake: a
  // total deal price typed into a per-SFT field. Refuse the keystroke rather
  // than the submit, so the number on screen is the number that gets sent.
  const onRate = (set) => (v) => { if (v === '' || (/^\d{1,5}(\.\d*)?$/.test(v) && parseFloat(v) <= OFFER_MAX)) set(v); };
  // The web field is type="number"; the phone keeps the same thing to digits.
  const onSft = (v) => { if (/^\d*\.?\d*$/.test(v)) setTotalSft(v); };

  const pickDest = (key) => { if (key === dest) return; setDest(key); setSelected(null); setPq(''); };

  const submitSelf = () => {
    if (!claimLeadForSelf(leadId, user)) { toast('Could not forward this lead', 'err'); return; }
    refresh();
    toast('Lead forwarded to you', 'ok');
    leave();
  };

  const submit = () => {
    if (!leadId) return;
    if (dest === 'self') { if (selected === SELF) submitSelf(); return; }
    const toUser = selected ? targets.find((u) => u.id === selected) : null;
    if (!toUser) return;

    // A forward changes only the owner (and, on a Team Lead closing hand-off,
    // attaches the offer). Status, follow-ups, attempts, meeting/visit data,
    // notes and suppression all stay.
    const offerData = dest === 'tl' ? {
      ourOffer: parseFloat(ourOffer) || 0,
      clientOffer: parseFloat(clientOffer) || 0,
      totalSft: parseFloat(totalSft) || 0,
      pipelineValue,
      projectId: project?.id || '',
      projectName: project?.name || '',
      notes: offerNotes.trim(),
    } : null;
    // A Team Lead hand-off carries an offer or it does not happen: the closing
    // pipeline only lists leads with one, so a lead forwarded without it would
    // land nowhere. fwdLead enforces the same rule.
    if (dest === 'tl' && !offerComplete(offerData)) {
      const overCap = offerData.ourOffer > OFFER_MAX || offerData.clientOffer > OFFER_MAX;
      toast(overCap
        ? `Offer rates are per SFT — 5 digits at most (${OFFER_MAX})`
        : 'Enter our rate, the client rate and total SFT before forwarding', 'err');
      return;
    }
    if (!fwdLead(leadId, toUser, user, offerData)) { toast('Could not forward this lead', 'err'); return; }
    if (dest === 'tl' && project) updLead(leadId, { dealProjectId: project.id, dealProjectName: project.name, propertyInterest: project.name });
    refresh();
    toast('Lead forwarded to ' + toUser.name, 'ok');
    leave();
  };

  const selectedUser = selected && selected !== SELF ? targets.find((u) => u.id === selected) : null;
  const q = pq.trim().toLowerCase();
  const shown = targets.filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  const canSubmit = dest === 'self' ? selected === SELF : dest === 'tl' ? !!selectedUser && offerReady : !!selectedUser;
  const rateHint = (v) => (v ? `${fmtBDT(parseFloat(v))} per SFT` : `Per square foot · max 5 digits (${OFFER_MAX})`);
  const interested = project ? (demand[project.name] || 0) : 0;

  return (
    <Screen footer={<View style={{ padding: space.lg }}><Button label="Forward" icon="swap-horiz" onPress={submit} disabled={!canSubmit} /></View>}>
      <T v="h2" numberOfLines={1}>{lead.name || 'Unnamed customer'}</T>
      <Hint icon="swap-horiz">The lead changes hands as-is: status, follow-ups, attempts, meeting/visit data and notes all stay; only the owner changes.</Hint>

      <View style={{ gap: space.sm }}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Forward to</T>
        <Segmented options={dests.map((d) => ({ value: d.key, label: d.label }))} value={dest} onChange={pickDest} />
      </View>

      {dest !== 'self' ? (
        <View style={{ gap: space.sm }}>
          <T v="small" tone="sub" style={{ fontWeight: '600' }}>{dest === 'tl' ? 'Select Team Lead' : 'Select teammate'}</T>
          <SearchField value={pq} onChangeText={setPq} placeholder={dest === 'tl' ? 'Search team lead…' : 'Search teammate…'} />
          {loadingTargets ? <Loading /> : (
            <>
              {shown.map((u) => <PersonRow key={u.id} person={u} selected={selected === u.id} onPress={() => setSelected(u.id)} />)}
              {!targets.length ? <ListNote icon="group-off">No other teammates yet</ListNote> : null}
              {targets.length && !shown.length ? <ListNote icon="search-off">No match for "{pq}"</ListNote> : null}
            </>
          )}
        </View>
      ) : (
        <PersonRow person={user} selected={selected === SELF} onPress={() => setSelected(SELF)} />
      )}

      {/* Plain hand-off: what is about to happen (the web's confirm step) */}
      {dest === 'agent' && selectedUser ? (
        <Hint icon="swap-horiz">Forward to <T v="small" style={{ fontWeight: '700' }}>{selectedUser.name}</T> as-is. Status, follow-ups, attempts, meeting/visit history and notes all stay; only the owner changes.</Hint>
      ) : null}

      {/* Offer details (Team Lead destination only) */}
      {dest === 'tl' ? (
        <>
          <Hint icon="price-check">An offer is required — <T v="small" style={{ fontWeight: '700' }}>{selectedUser?.name || 'the Team Lead'}</T> only sees leads that carry one.</Hint>
          <View style={{ gap: space.sm }}>
            <T v="small" tone="sub" style={{ fontWeight: '600' }}>Project</T>
            <Row wrap>
              {projects.map((p) => (
                <Chip key={p.id} active={projectId === p.id} onPress={() => setProjectId(projectId === p.id ? '' : p.id)}
                  label={p.name + (p.area ? ' · ' + p.area : '')} count={demand[p.name] ? demand[p.name] + ' interested' : undefined} />
              ))}
            </Row>
            {!projects.length ? <T v="small" tone="mute">No projects yet</T> : null}
            {project ? <T v="small" tone="mute">{interested} lead{interested === 1 ? '' : 's'} already interested in {project.name}</T> : null}
          </View>
          <Field label="Our Offer Rate (BDT per SFT) *" value={ourOffer} onChangeText={onRate(setOurOffer)} keyboardType="decimal-pad" placeholder="e.g. 10500" hint={rateHint(ourOffer)} />
          <Field label="Client Offer Rate (BDT per SFT) *" value={clientOffer} onChangeText={onRate(setClientOffer)} keyboardType="decimal-pad" placeholder="e.g. 9500" hint={rateHint(clientOffer)} />
          <Field label="Total SFT *" value={totalSft} onChangeText={onSft} keyboardType="decimal-pad" placeholder="e.g. 1200" />
          {pipelineValue > 0 ? (
            <Card>
              <Row style={{ alignItems: 'flex-start' }}>
                <Icon name="trending-up" size={22} color={t.brand} />
                <View style={{ flex: 1 }}>
                  <T v="small" tone="sub">Pipeline Value</T>
                  <T v="num" tone="brand">{fmtBDT(pipelineValue)}</T>
                  <T v="small" tone="mute">{totalSft} SFT × {fmtBDT(parseFloat(clientOffer))}</T>
                </View>
              </Row>
            </Card>
          ) : null}
          <Field label="Negotiation Notes (optional)" value={offerNotes} onChangeText={setOfferNotes} multiline placeholder="Any context for the Team Lead…" />
        </>
      ) : null}
    </Screen>
  );
}
