// One account: create it, or open it to edit. The phone's single page for what
// the web splits over several pieces, each kept with its own rules:
//   create            src/components/modals/CreateUserModal.jsx (+ CredsModal.jsx)
//   name/phone,
//   projects, features src/components/modals/EditAgentModal.jsx (+ FeatureEditor.jsx)
//   role, status,
//   role defaults      src/components/AccessPanel.jsx
//   monthly target     src/components/modals/TargetModal.jsx
//   remove             src/components/modals/DeleteUserModal.jsx
// Every write to another account goes through src/lib/accessAdmin.js (the
// access-admin Edge Function), which checks the caller again on the server
// against the same access-rules.js these buttons are gated by.
import { useLayoutEffect, useState } from 'react';
import { Platform, Share, Switch, View } from 'react-native';
import { Avatar, Badge, Button, Card, Chip, Empty, Field, ListItem, Row, Screen, Section, Sheet, T, useUI } from '../../ui';
import { useTheme, space } from '../../theme';
import { useApp } from '../../store';
import { getDB, addNotifs, getProperties, updateProfile, getTarget, setTargetFn, unassignDeletedUser } from '../../../../src/lib/db.js';
import { createAccount, deleteAccount, setFeatures, setProjects, setProfile, setRole, setActive, cachedUser } from '../../../../src/lib/accessAdmin.js';
import { ROLES, canSee, canManageUser, assignableRoles, initialFeatures, effectiveRole, FEATURE_KEYS, FEATURE_LABELS, FEATURE_HINTS } from '../../../../src/lib/constants.js';
import { rlabel } from '../../../../src/lib/helpers.js';
import { ROLE_TONE } from './AccountsScreen';

const toggleIn = (set, k) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
const Label = ({ children }) => <T v="small" tone="sub" style={{ fontWeight: '600' }}>{children}</T>;

export default function AccountFormScreen({ navigation, route }) {
  const { user, dbVersion } = useApp();
  void dbVersion;
  const userId = route.params?.userId || null;
  const target = userId ? cachedUser(userId) : null;

  useLayoutEffect(() => { navigation.setOptions({ title: userId ? (target?.name || 'Account') : 'Create account' }); }, [navigation, userId, target?.name]);

  // Who gets here on the web: the Users & Accounts page (the 'accounts'
  // feature), and a Team Lead from the Team page (Add Agent, an agent's Edit).
  const mayOpen = canSee(user, 'accounts') || user.role === ROLES.TL || user.role === ROLES.MASTER;
  if (!mayOpen && userId !== user.id) return <Screen><Empty icon="lock" title="No access" hint="Account management is not enabled for this account." /></Screen>;
  if (!userId) return <CreateAccount navigation={navigation} />;
  if (!target) return <Screen><Empty icon="person-off" title="Account not found" hint="It may have been removed. Go back and reload." /></Screen>;
  return <EditAccount key={target.id} navigation={navigation} a={target} />;
}

// ── Create (CreateUserModal) ────────────────────────────────────────────────
function CreateAccount({ navigation }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  // The web opens the modal with a fixed role list: [Team Lead, …] from Users
  // & Accounts (its bulk form offers the rest), [Agent, Meeting Agent,
  // Executive] for a Team Lead on the Team page. Here an account manager is
  // offered every role it may assign (assignableRoles, the list the server
  // checks the request against), Team Lead first as on the web.
  const manager = canSee(user, 'accounts') || user.role === ROLES.MASTER;
  const roles = manager
    ? [...assignableRoles(user)].sort((a, b) => (b === ROLES.TL) - (a === ROLES.TL))
    : [ROLES.AGENT, ROLES.MA, ROLES.EXEC];
  const sameCo = (x) => !user.companyId || !x || x === user.companyId;
  const teams = manager ? (getDB().teams || []).filter((x) => sameCo(x.companyId)) : [];

  const [role, setRoleV] = useState(roles[0]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [teamId, setTeamId] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cred, setCred] = useState(null); // shown once, after the account exists
  // As in the web's bulk form: only an Agent is placed in a team at creation.
  const needsTeam = role === ROLES.AGENT && teams.length > 0;

  const submit = async () => {
    if (busy) return;
    const nm = name.trim(); const em = email.trim(); const ph = phone.trim();
    if (!nm || !em || !pass) { setErr('Name, email and password required.'); return; }
    if (pass.length < 10) { setErr('Password must be at least 10 characters.'); return; }
    if (getDB().users.find((u) => (u.email || '').toLowerCase() === em.toLowerCase())) { setErr('Email already in use.'); return; }

    // The access-admin function creates the sign-in and the CRM row together,
    // checks the email across every tenant, and refuses roles above the caller.
    setErr(''); setBusy(true);
    let res;
    try { res = await createAccount({ name: nm, email: em, password: pass, phone: ph, role, ...(needsTeam && teamId ? { teamId } : {}) }); }
    catch { res = { ok: false, error: 'Could not reach the access service. Check your connection.' }; }
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }

    const db = getDB();
    if (role === ROLES.TL) {
      const mgmtIds = db.users.filter((u) => u.role === ROLES.MGMT).map((u) => u.id);
      addNotifs(mgmtIds.map((uid) => ({ userId: uid, type: 'NEW_USER', message: 'New Team Lead added: ' + nm, leadId: null })), user);
    } else {
      const tlIds = db.users.filter((u) => u.role === ROLES.TL && u.teamId === user.teamId).map((u) => u.id);
      addNotifs(tlIds.map((uid) => ({ userId: uid, type: 'NEW_USER', message: 'New agent added to your team: ' + nm + ' (' + rlabel(role) + ')', leadId: null })), user);
    }
    refresh();
    setCred({ name: nm, email: em, pass, roleLabel: rlabel(role) });
    setPass(''); // the form no longer holds it; the one-time card below does until Done
    toast('User created');
  };

  // CredsModal: the login is shown once, to pass on.
  const copyCreds = async () => {
    const text = 'Email: ' + cred.email + '\nPassword: ' + cred.pass;
    try {
      if (Platform.OS === 'web') { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } else await Share.share({ message: text });
    } catch { toast('Copy manually', 'warn'); }
  };

  if (cred) {
    return (
      <Screen footer={<View style={{ padding: space.lg, gap: space.sm }}>
        <Button label={Platform.OS === 'web' ? 'Copy credentials' : 'Share credentials'} icon="content-copy" variant="ghost" onPress={copyCreds} />
        <Button label="Done" onPress={() => { setCred(null); navigation.goBack(); }} />
      </View>}>
        <Card>
          <Row gap={space.md}>
            <Avatar name={cred.name} />
            <View style={{ flex: 1 }}>
              <T v="h2">Account created</T>
              <T tone="sub">{cred.name} · {cred.roleLabel}</T>
            </View>
          </Row>
          <T v="small" tone="sub">Share these login credentials with the new team member.</T>
        </Card>
        <Card>
          <Label>Email</Label>
          <T v="strong" selectable>{cred.email}</T>
          <Label>Password</Label>
          <T v="strong" selectable>{cred.pass}</T>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen footer={<View style={{ padding: space.lg, gap: space.sm }}>
      <T v="small" tone="mute">The login details are shown once, after it is created.</T>
      <Button label="Create" icon="person-add" onPress={submit} busy={busy} />
    </View>}>
      {roles.length > 1 ? (
        <View style={{ gap: space.sm }}>
          <Label>Role</Label>
          <Row wrap>{roles.map((r) => <Chip key={r} label={rlabel(r)} active={role === r} onPress={() => setRoleV(r)} />)}</Row>
        </View>
      ) : null}
      {needsTeam ? (
        <View style={{ gap: space.sm }}>
          <Label>Team</Label>
          <Row wrap>
            <Chip label="Owner team" active={!teamId} onPress={() => setTeamId('')} />
            {teams.map((x) => <Chip key={x.id} label={x.name} active={teamId === x.id} onPress={() => setTeamId(x.id)} />)}
          </Row>
        </View>
      ) : null}
      <Field label="Full name *" value={name} onChangeText={setName} placeholder="e.g. Masud Rahman" autoCapitalize="words" />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+880 1711 000000" keyboardType="phone-pad" />
      <Field label="Email *" value={email} onChangeText={setEmail} placeholder="user@company.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      <Field label="Password * (10 characters or more)" value={pass} onChangeText={setPass} placeholder="Set a password"
        secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false} />
      <Chip label={showPw ? 'Hide password' : 'Show password'} icon={showPw ? 'visibility-off' : 'visibility'} onPress={() => setShowPw((v) => !v)} />
      {err ? <T v="small" tone="danger" accessibilityRole="alert">{err}</T> : null}
    </Screen>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────
function EditAccount({ navigation, a }) {
  const { user, refresh } = useApp();
  const { toast, confirm } = useUI();
  const t = useTheme();
  const self = a.id === user.id;
  // Same rule the access-admin function applies (access-rules.js).
  const isAdmin = canManageUser(user, a) && !self;
  const showProjects = a.role === ROLES.AGENT || a.role === ROLES.MA;
  const active = a.isActive !== false;
  const db = getDB();
  const team = (db.teams || []).find((x) => (a.role === ROLES.TL ? x.leadId === a.id : x.id === a.teamId)) || null;
  const projects = getProperties();

  const [name, setName] = useState(a.name || '');
  const [phone, setPhone] = useState(a.phone || '');
  const [all, setAll] = useState(a.projects === 'ALL');
  const [sel, setSel] = useState(() => new Set(Array.isArray(a.projects) ? a.projects : []));
  const [feat, setFeat] = useState(() => initialFeatures(a));
  const [busy, setBusy] = useState(false);
  const [tgtOpen, setTgtOpen] = useState(false);

  // EditAgentModal.save: each part through its own path, reported truthfully;
  // the page stays open on an error.
  const save = async () => {
    setBusy(true);
    const errors = [];
    const run = async (p) => { try { const r = await p; if (!r.ok) errors.push(r.error); } catch { errors.push('Not saved. Try again.'); } };
    const nm = name.trim() || a.name;
    if (nm !== a.name || phone.trim() !== (a.phone || '')) {
      await run(self ? updateProfile(a.id, { name: nm, phone: phone.trim() }) : setProfile(a.id, { name: nm, phone: phone.trim() }));
    }
    if (showProjects) {
      const next = all ? 'ALL' : [...sel];
      if (JSON.stringify(next) !== JSON.stringify(a.projects ?? [])) await run(setProjects(a.id, next));
    }
    if (isAdmin) {
      const before = initialFeatures(a);
      const changed = before.size !== feat.size || [...feat].some((k) => !before.has(k));
      if (changed) await run(setFeatures(a.id, [...feat]));
    }
    setBusy(false);
    refresh();
    if (errors.length) { toast(errors[0], 'err'); return; }
    navigation.goBack();
    toast('User updated');
  };

  // AccessPanel.apply: role, status and "role defaults" are saved at once, and
  // the checklist is re-seeded from the row the server stored.
  const apply = async (fn, okMsg) => {
    setBusy(true);
    let r;
    try { r = await fn(); } catch { r = { ok: false, error: 'Not saved. Try again.' }; }
    setBusy(false);
    refresh();
    if (!r.ok) { toast(r.error, 'err'); return; }
    setFeat(initialFeatures(cachedUser(a.id) || a));
    toast(okMsg);
  };
  const roleOpts = [...new Set([a.role, ...assignableRoles(user)])];
  const pickRole = (r) => { if (!busy && assignableRoles(user).includes(a.role) && r !== a.role) apply(() => setRole(a.id, r), 'Role saved'); };
  const toggleActive = () => {
    if (!active) { apply(() => setActive(a.id, true), 'Account reactivated'); return; }
    confirm({
      title: `Deactivate ${a.name}?`, description: 'Deactivating also signs it out everywhere.', confirmLabel: 'Deactivate', danger: true,
      onConfirm: () => apply(() => setActive(a.id, false), 'Account deactivated'),
    });
  };

  // DeleteUserModal: the server removes the account and its sign-in; only then
  // are its cached leads unassigned and the tombstone written.
  const remove = () => confirm({
    title: `Remove ${a.name || 'this user'}?`,
    description: 'This cannot be undone. Any leads they own become unassigned and stay in the company. If this is a Team Lead, their team is removed too. They can no longer sign in.',
    confirmLabel: 'Remove', danger: true,
    onConfirm: async () => {
      setBusy(true);
      let r;
      try { r = await deleteAccount(a.id); } catch { r = { ok: false, error: 'Could not reach the access service. Check your connection.' }; }
      if (!r.ok) { setBusy(false); toast('Not removed: ' + r.error, 'err'); return; }
      unassignDeletedUser(a.id, user);
      navigation.goBack();
      refresh();
      toast(a.name ? `User removed. ${a.name} can no longer sign in.` : 'User removed');
    },
  });

  const tgt = getTarget(a.id);
  // The web's Target button sits on an agent's card (Team page).
  const showTarget = !self && effectiveRole(a) === ROLES.AGENT;
  // The web shows Delete on every roster row but your own.
  const showDelete = !self && (canSee(user, 'accounts') || user.role === ROLES.MASTER);

  return (
    <Screen footer={<View style={{ padding: space.lg, gap: space.sm }}>
      {isAdmin ? <T v="small" tone="mute">Changes apply on the account’s next request.</T> : null}
      <Button label={busy ? 'Saving…' : 'Save changes'} icon="save" onPress={save} busy={busy} />
    </View>}>
      <Card>
        <Row gap={space.md}>
          <Avatar name={a.name} size={48} />
          <View style={{ flex: 1, gap: 4 }}>
            <T v="h2" numberOfLines={1}>{a.name}</T>
            <Row wrap>
              <Badge label={rlabel(a.role)} tone={ROLE_TONE[a.role] || 'brand'} />
              <Badge label={active ? 'Active' : 'Inactive'} tone={active ? 'brand' : 'danger'} icon={active ? 'check-circle' : 'cancel'} />
              {self ? <Badge label="you" tone="info" /> : null}
            </Row>
          </View>
        </Row>
        <T v="small" tone="sub" selectable>{a.email || '—'}</T>
        <T v="small" tone="mute">{team ? `Team: ${team.name}` : a.role === ROLES.EXEC ? 'Custom-access account · not in a team' : 'Not in a team'}</T>
      </Card>

      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+880 1XXX-XXXXXX" keyboardType="phone-pad" />

      {showProjects ? (
        <Section title="Assigned projects" action={<Chip label="All projects" icon={all ? 'check-box' : 'check-box-outline-blank'} active={all} onPress={() => setAll((v) => !v)} />}>
          {all ? <T v="small" tone="mute">This agent can deal on all {projects.length} projects.</T> : (
            <>
              <Row wrap>
                {projects.map((p) => <Chip key={p.id} label={p.name} icon={sel.has(p.id) ? 'check' : undefined} active={sel.has(p.id)} onPress={() => setSel((s) => toggleIn(s, p.id))} />)}
                {!projects.length ? <T v="small" tone="mute">No projects yet.</T> : null}
              </Row>
              <T v="small" tone="mute">{sel.size} of {projects.length} selected</T>
            </>
          )}
        </Section>
      ) : null}

      {showTarget ? (
        <Section title="Monthly target">
          <Card pad={false}>
            <ListItem icon="flag" title="Site Visits Done" detail={tgt ? `Target this month: ${tgt.value}` : 'No target set this month'} onPress={() => setTgtOpen(true)} last />
          </Card>
        </Section>
      ) : null}

      {isAdmin ? (
        <>
          <Section title="Role">
            <Row wrap>{roleOpts.map((r) => <Chip key={r} label={rlabel(r)} active={a.role === r} onPress={() => pickRole(r)} />)}</Row>
            {!assignableRoles(user).includes(a.role) ? <T v="small" tone="mute">You cannot change this account’s role.</T> : null}
          </Section>

          <Section title="Status">
            <Button label={active ? 'Deactivate' : 'Reactivate'} icon={active ? 'block' : 'check-circle'} variant="soft" tone={active ? 'danger' : 'brand'} onPress={toggleActive} disabled={busy} />
            <T v="small" tone="mute">Deactivating also signs it out everywhere.</T>
          </Section>

          <Section title="Feature access" action={<T v="small" tone="mute">{feat.size} enabled{Array.isArray(a.allowedFeatures) ? '' : ' · role defaults'}</T>}>
            <T v="small" tone="mute">{a.role === ROLES.EXEC ? 'Executive: no defaults. Grant features explicitly.' : 'Pre-filled with role defaults. Switch on to grant, off to restrict.'}</T>
            <Card pad={false}>
              {FEATURE_KEYS.map((k, i) => (
                <ListItem key={k} title={FEATURE_LABELS[k] || k} detail={FEATURE_HINTS[k]} last={i === FEATURE_KEYS.length - 1}
                  onPress={busy ? undefined : () => setFeat((s) => toggleIn(s, k))}
                  right={<Switch value={feat.has(k)} disabled={busy} onValueChange={() => setFeat((s) => toggleIn(s, k))}
                    accessibilityLabel={FEATURE_LABELS[k] || k} trackColor={{ false: t.line, true: t.brand }} thumbColor={t.card} />} />
              ))}
            </Card>
            <Button label="Use role defaults" icon="restart-alt" variant="ghost" disabled={busy || !Array.isArray(a.allowedFeatures)}
              onPress={() => apply(() => setFeatures(a.id, null), 'Back to role defaults')} />
          </Section>
        </>
      ) : null}

      {showDelete ? (
        <Section title="Remove account">
          <Button label="Delete account" icon="delete" variant="soft" tone="danger" onPress={remove} disabled={busy} />
        </Section>
      ) : null}

      <TargetSheet visible={tgtOpen} onClose={() => setTgtOpen(false)} account={a} />
    </Screen>
  );
}

// ── Target (TargetModal) ────────────────────────────────────────────────────
function TargetSheet({ visible, onClose, account }) {
  const { refresh } = useApp();
  const { toast } = useUI();
  const [val, setVal] = useState('');
  const [seeded, setSeeded] = useState(false);
  // Read the target when the sheet opens, not on every render: a refresh while
  // it is open must not overwrite what is being typed.
  if (visible && !seeded) { setSeeded(true); const cur = getTarget(account.id); setVal(cur ? String(cur.value) : ''); }
  if (!visible && seeded) setSeeded(false);
  const submit = () => {
    if (!val || parseInt(val, 10) < 1) { toast('Enter a valid target', 'err'); return; }
    setTargetFn(account.id, val);
    onClose(); refresh(); toast('Target updated');
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={`Set target — ${account.name}`} footer={<Button label="Set target" icon="flag" onPress={submit} />}>
      <T v="small" tone="sub">Site Visits Done target for {new Date().toLocaleString('default', { month: 'long' })}</T>
      <Field label="Target (site visits done)" value={val} onChangeText={(v) => setVal(v.replace(/[^0-9]/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="e.g. 15" />
    </Sheet>
  );
}
