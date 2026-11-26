// Add a customer, or edit one. The rules are the web AddLeadModal's
// (src/components/modals/AddLeadModal.jsx):
//   * a phone number is the lead's identity: required when adding, locked afterwards;
//   * the source is stamped when the lead is created and never edited;
//   * a number that already exists updates that lead instead of making a second
//     one, unless it sits with another team (then only an admin may);
//   * adding waits for the server and reports a failure instead of a false "added".
import { useLayoutEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Field, IconButton, Row, Screen, T, useUI } from '../../ui';
import { space } from '../../theme';
import { useApp } from '../../store';
import { getLead, updLead, addAct, leadByPhone, addLeadFn, getProperties } from '../../../../src/lib/db.js';
import { resolvePhone, phoneCountry, DEFAULT_COUNTRY, COMMON_COUNTRIES } from '../../../../src/lib/phone.js';
import { SRC_LABELS, ROLES, SOURCE_OPTIONS_IA, SOURCE_OPTIONS_DEFAULT } from '../../../../src/lib/constants.js';

const leadCode = (l) => l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase());
const tags = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function LeadFormScreen({ navigation, route }) {
  const { user, refresh } = useApp();
  const { toast } = useUI();
  const leadId = route.params?.leadId || null;
  const old = leadId ? getLead(leadId) : null;
  const isEdit = !!old;
  const sourceOpts = user.role === ROLES.AGENT ? SOURCE_OPTIONS_IA : SOURCE_OPTIONS_DEFAULT;

  const [name, setName] = useState(old?.name || '');
  const [phones, setPhones] = useState([{ text: '', cc: DEFAULT_COUNTRY }]);
  const [email, setEmail] = useState(old?.email || '');
  const [company, setCompany] = useState(old?.company && old.company !== '—' ? old.company : '');
  const [source, setSource] = useState(old?.source || sourceOpts[0]);
  const [interest, setInterest] = useState(() => tags(old?.propertyInterest || route.params?.interest));
  const [customInterest, setCustomInterest] = useState('');
  const [profession, setProfession] = useState(old?.profession || '');
  const [city, setCity] = useState(old?.city || '');
  const [saving, setSaving] = useState(false);
  const projects = useMemo(() => [...getProperties()].map((p) => p.name).filter(Boolean).sort((a, b) => a.localeCompare(b)), []);

  useLayoutEffect(() => { navigation.setOptions({ title: isEdit ? 'Edit customer' : 'Add customer' }); }, [navigation, isEdit]);

  const setRow = (i, patch) => setPhones((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addPhone = () => setPhones((p) => [...p, { text: '', cc: phoneCountry(p[0].text, p[0].cc).iso || DEFAULT_COUNTRY }]);
  const toggleInterest = (n) => setInterest((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
  const addCustomInterest = () => { const v = customInterest.trim(); if (v && !interest.includes(v)) setInterest((s) => [...s, v]); setCustomInterest(''); };

  const submit = async () => {
    if (saving) return;
    const nm = name.trim();
    if (!nm) { toast('Name is required', 'err'); return; }
    const em = email.trim();
    const co = company.trim();
    const prop = [...interest, ...(customInterest.trim() && !interest.includes(customInterest.trim()) ? [customInterest.trim()] : [])].join(', ');
    const prof = profession.trim();
    const ct = city.trim();

    if (isEdit) {
      const changes = [];
      if (old.name !== nm) changes.push(`Name: "${old.name}" → "${nm}"`);
      if ((old.email || '') !== em) changes.push(`Email: ${old.email || '—'} → ${em || '—'}`);
      if ((old.company || '—') !== (co || '—')) changes.push(`Company: ${old.company || '—'} → ${co || '—'}`);
      if ((old.propertyInterest || '') !== prop) changes.push(`Property: ${old.propertyInterest || '—'} → ${prop || '—'}`);
      if ((old.profession || '') !== prof) changes.push(`Profession: ${old.profession || '—'} → ${prof || '—'}`);
      if ((old.city || '') !== ct) changes.push(`Location: ${old.city || '—'} → ${ct || '—'}`);
      // phone, phones and source are locked on edit, so they are never written back.
      updLead(leadId, { name: nm, email: em, company: co || '—', propertyInterest: prop, profession: prof, city: ct });
      if (changes.length) addAct(leadId, { type: 'NOTE', description: 'Lead updated — ' + changes.join(', '), userId: user.id, userName: user.name, durationSeconds: 0 });
      refresh(); navigation.goBack(); toast('Lead updated');
      return;
    }

    const typed = phones.filter((p) => p.text.trim());
    if (!typed.length) { toast('A phone number is required', 'err'); return; }
    const nums = typed.map((p) => resolvePhone(p.text, p.cc));
    const bad = nums.findIndex((n) => !n);
    if (bad >= 0) { toast(`Check the number ${typed[bad].text.trim()}: it is too short or too long`, 'err'); return; }
    const cleanPhones = [...new Set(nums.map((n) => n.digits))];
    const phone = cleanPhones[0];

    const dup = leadByPhone(phone);
    if (dup) {
      const isAdmin = user.role === ROLES.MGMT || user.role === ROLES.MASTER;
      const otherTeam = dup.teamId && user.teamId && dup.teamId !== user.teamId;
      if (!isAdmin && otherTeam) { toast(`This lead (ID ${leadCode(dup)}) is already on another agent's panel. Ask your admin to swap.`, 'err'); return; }
      const owner = dup.assignedToName || '—';
      // phones and source are not written: this is an existing lead reached from the Add form.
      updLead(dup.id, { name: nm, email: em, company: co || '—', propertyInterest: prop, profession: prof, city: ct });
      addAct(dup.id, { type: 'NOTE', description: `Re-submitted ${phone} — record updated (already handled by ${owner})`, userId: user.id, userName: user.name, durationSeconds: 0 });
      refresh();
      toast(`Number ${phone} already exists, handled by ${owner}. Record updated.`, 'warn');
      navigation.replace('LeadDetail', { leadId: dup.id });
      return;
    }

    setSaving(true);
    let res;
    try { res = await addLeadFn(nm, phone, cleanPhones, em, [], co, source, prop, prof, ct, user); }
    finally { setSaving(false); }
    if (!res || !res.ok) { toast('Could not save the customer. Check your connection and try again.', 'err'); return; }
    refresh(); toast('Lead added');
    navigation.replace('LeadDetail', { leadId: res.id });
  };

  return (
    <Screen footer={<View style={{ padding: space.lg }}><Button label={isEdit ? 'Save changes' : 'Add customer'} icon="check" onPress={submit} busy={saving} /></View>}>
      <Field label="Full name *" value={name} onChangeText={setName} placeholder="e.g. Rahim Ahmed" autoCapitalize="words" />

      {isEdit ? (
        <Field label="Phone number(s) (locked)" value={(old.phones?.length ? old.phones : [old.phone]).filter(Boolean).join(', ')} editable={false} />
      ) : (
        <View style={{ gap: space.sm }}>
          <T v="small" tone="sub" style={{ fontWeight: '600' }}>Phone number(s) *</T>
          {phones.map((p, i) => {
            const c = phoneCountry(p.text, p.cc);
            return (
              <View key={i} style={{ gap: 6 }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Field value={p.text} onChangeText={(v) => setRow(i, { text: v.replace(/[^\d+ ]/g, '') })} keyboardType="phone-pad"
                      placeholder={i === 0 ? '01712-345678 or +971 50 123 4567' : 'Additional number'} hint={c.dial ? `${c.iso || ''} ${c.dial}`.trim() : undefined} />
                  </View>
                  {phones.length > 1 ? <IconButton name="remove" label="Remove number" tone="danger" onPress={() => setPhones((s) => s.filter((_, j) => j !== i))} /> : null}
                </Row>
                <Row wrap>{COMMON_COUNTRIES.slice(0, 6).map((cc) => <Chip key={cc} label={cc} active={(c.iso || p.cc) === cc} onPress={() => setRow(i, { cc })} />)}</Row>
              </View>
            );
          })}
          <Button label="Add another number" icon="add" variant="ghost" small full={false} onPress={addPhone} />
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Source{isEdit ? ' (locked)' : ''}</T>
        {isEdit
          ? <T>{SRC_LABELS[old.source] || old.source || '—'}</T>
          : <Row wrap>{sourceOpts.map((s) => <Chip key={s} label={SRC_LABELS[s] || s} active={source === s} onPress={() => setSource(s)} />)}</Row>}
      </View>

      <View style={{ gap: space.sm }}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Project interest</T>
        <Row wrap>
          {[...new Set([...projects, ...interest])].map((n) => <Chip key={n} label={n} active={interest.includes(n)} onPress={() => toggleInterest(n)} />)}
        </Row>
        <Field value={customInterest} onChangeText={setCustomInterest} placeholder="Another project" onSubmitEditing={addCustomInterest} returnKeyType="done" />
      </View>

      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@example.com" />
      <Field label="Company" value={company} onChangeText={setCompany} placeholder="Company" />
      <Field label="Profession" value={profession} onChangeText={setProfession} placeholder="Profession" />
      <Field label="Customer location" value={city} onChangeText={setCity} placeholder="City / area" />
    </Screen>
  );
}
