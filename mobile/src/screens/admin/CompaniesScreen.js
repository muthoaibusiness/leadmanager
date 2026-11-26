// Companies: the Master account's company-wise overview. Port of the web
// src/components/dashboards/MasterDash.jsx: the same rollup (companyStats), the
// same create form and validation (createCompany, with the first Management
// account made through access-admin), and suspend/activate (setCompanyActive).
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Badge, Button, Card, Chip, Empty, Field, IconButton, Row, Screen, Sheet, Stat, T, useUI } from '../../ui';
import { useTheme, space, radius } from '../../theme';
import { useApp } from '../../store';
import { getDB, getCompanies, companyStats, createCompany, setCompanyActive } from '../../../../src/lib/db.js';
import { createAccount } from '../../../../src/lib/accessAdmin.js';
import { fmtBDT } from '../../../../src/lib/helpers.js';
import { ROLES } from '../../../../src/lib/constants.js';

const PLANS = ['Starter', 'Growth', 'Enterprise'];
const PLAN_TONE = { starter: 'neutral', growth: 'info', enterprise: 'purple' };
const blankForm = () => ({ name: '', plan: 'Starter', adminName: '', adminEmail: '', password: '', phone: '' });

const Mini = ({ label, value, tone }) => (
  <View style={{ width: '31%', gap: 1 }}>
    <T v="h2" tone={tone}>{String(value)}</T>
    <T v="small" tone="mute">{label}</T>
  </View>
);

export default function CompaniesScreen() {
  const { user, dbVersion, refresh } = useApp();
  const { toast, confirm } = useUI();
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const companies = getCompanies();
  const rows = useMemo(() => companies.map((c) => ({ c, s: companyStats(c.id) })), [dbVersion, companies.length]); // eslint-disable-line react-hooks/exhaustive-deps -- getCompanies() is a fresh array each render; dbVersion tracks it
  // global rollup across all tenants
  const totals = useMemo(() => rows.reduce((a, { s }) => ({
    accounts: a.accounts + s.accounts, leads: a.leads + s.leads, won: a.won + s.won, collected: a.collected + s.collected,
  }), { accounts: 0, leads: 0, won: 0, collected: 0 }), [rows]);

  if (user.role !== ROLES.MASTER) return <Screen><Empty icon="lock" title="Master account only" hint="The company overview is for the Master account." /></Screen>;

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const closeForm = () => { setAdding(false); setErr(''); setForm(blankForm()); };
  const save = async () => {
    if (busy) return;
    if (!form.name.trim()) { setErr('Company name required.'); return; }
    if (!form.adminName.trim() || !form.adminEmail.trim()) { setErr('Admin name and email required.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.adminEmail)) { setErr('Valid admin email required.'); return; }
    setBusy(true);
    let res;
    try { res = await createCompany(form, createAccount); }
    catch (e) { console.warn('[companies] create failed:', e?.message || e); res = { error: 'Company not saved. Check your connection and try again.' }; }
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    setErr('');
    setCreated({ company: form.name, email: res.adminEmail, pass: res.password });
    setForm(blankForm()); // the password leaves the form; the one-time notice holds it until dismissed
    setAdding(false);
    refresh();
    toast('Company created');
  };

  const toggle = (c) => {
    const active = c.isActive !== false;
    const run = () => { setCompanyActive(c.id, !active); refresh(); toast(active ? 'Company suspended' : 'Company activated'); };
    if (!active) { run(); return; }
    confirm({ title: `Suspend ${c.name}?`, description: 'The company is marked inactive. You can activate it again from this page.', confirmLabel: 'Suspend', danger: true, onConfirm: run });
  };

  const db = getDB();
  const header = (
    <View style={{ gap: space.sm, padding: space.lg, paddingBottom: 0 }}>
      <T tone="sub">{companies.length} {companies.length === 1 ? 'company' : 'companies'} · {totals.accounts} accounts · {totals.leads} leads</T>
      <Row wrap>
        <Stat label="Companies" value={companies.length} icon="apartment" />
        <Stat label="Total accounts" value={totals.accounts} icon="group" />
      </Row>
      <Row wrap>
        <Stat label="Total leads" value={totals.leads} icon="person-search" />
        <Stat label="Collections" value={fmtBDT(totals.collected)} icon="payments" tone="brand" />
      </Row>
      <Button label="Add company" icon="add-business" onPress={() => { setAdding(true); setErr(''); }} />
      {created ? (
        <Card>
          <Row style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="strong" tone="brand">{created.company} created.</T>
              <T v="small" tone="sub">Admin login</T>
              <T selectable>{created.email}</T>
              <T v="small" tone="sub">Password</T>
              <T selectable>{created.pass}</T>
            </View>
            <IconButton name="close" label="Dismiss" onPress={() => setCreated(null)} />
          </Row>
        </Card>
      ) : null}
    </View>
  );

  const renderItem = ({ item: { c, s } }) => {
    const admin = db.users.find((u) => u.companyId === c.id && u.role === ROLES.MGMT);
    const off = c.isActive === false;
    return (
      <View style={{ paddingHorizontal: space.lg }}>
        <Card style={{ opacity: off ? 0.75 : 1 }}>
          <Row gap={space.md}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <T v="h2" tone="brand">{String(c.name || '?')[0]}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="strong" numberOfLines={1}>{c.name}</T>
              <T v="small" tone="mute" numberOfLines={1}>{admin ? admin.email : 'No admin'} · since {(c.createdAt || '').slice(0, 10)}</T>
            </View>
          </Row>
          <Row wrap>
            <Badge label={c.plan || 'Starter'} tone={PLAN_TONE[String(c.plan || 'starter').toLowerCase()] || 'neutral'} />
            {off ? <Badge label="Suspended" tone="danger" icon="pause-circle-outline" /> : <Badge label="Active" tone="brand" />}
          </Row>
          <Row wrap gap={space.sm}>
            <Mini label="Accounts" value={s.accounts} />
            <Mini label="Teams" value={s.teams} />
            <Mini label="Leads" value={s.leads} />
            <Mini label="Active" value={s.active} />
            <Mini label="Won" value={s.won} tone="brand" />
            <Mini label="Projects" value={s.projects} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="small" tone="sub">Collections <T v="strong">{fmtBDT(s.collected)}</T></T>
            <Button label={off ? 'Activate' : 'Suspend'} icon={off ? 'play-circle-outline' : 'pause-circle-outline'} variant="soft" tone={off ? 'brand' : 'danger'} small full={false} onPress={() => toggle(c)} />
          </Row>
        </Card>
      </View>
    );
  };

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.c.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: space.md }}
        ListEmptyComponent={<Empty icon="corporate-fare" title="No companies yet" hint="Add one to get started." />}
        ListFooterComponent={<View style={{ height: space.xl }} />}
      />

      <Sheet visible={adding} onClose={closeForm} title="Add company"
        footer={<Button label="Create company" icon="add-business" onPress={save} busy={busy} />}>
        <Field label="Company name *" value={form.name} onChangeText={set('name')} placeholder="e.g. Navana Realty" />
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Plan</T>
        <Row wrap>{PLANS.map((p) => <Chip key={p} label={p} active={form.plan === p} onPress={() => set('plan')(p)} />)}</Row>
        <T v="small" tone="mute">First admin account (Management) for this company</T>
        <Field label="Admin name *" value={form.adminName} onChangeText={set('adminName')} placeholder="e.g. Sadia Noor" autoCapitalize="words" />
        <Field label="Admin email *" value={form.adminEmail} onChangeText={set('adminEmail')} placeholder="admin@company.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <Field label="Password" value={form.password} onChangeText={set('password')} placeholder="10+ characters" autoCapitalize="none" autoCorrect={false} />
        <Field label="Phone" value={form.phone} onChangeText={set('phone')} placeholder="+880…" keyboardType="phone-pad" />
        {err ? <T v="small" tone="danger" accessibilityRole="alert">{err}</T> : null}
      </Sheet>
    </Screen>
  );
}
