// The signed-in account: name and phone (the two fields an account may change
// about itself), and its password.
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar, Button, Card, Field, Row, Screen, Section, T, useUI } from '../ui';
import { useApp } from '../store';
import { updateProfile, getSession } from '../../../src/lib/db.js';
import { changePassword } from '../../../src/lib/auth.js';
import { rlabel } from '../../../src/lib/helpers.js';

export default function ProfileScreen() {
  const { user, setUser, refresh } = useApp();
  const { toast } = useUI();
  const [name, setName] = useState(user.name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast('Name is required', 'err'); return; }
    setSaving(true);
    const res = await updateProfile(user.id, { name: name.trim(), phone: phone.trim() });
    setSaving(false);
    if (!res.ok) { toast(res.error || 'Not saved. Try again.', 'err'); return; }
    setUser(getSession() || res.user);
    refresh(); toast('Profile saved');
  };

  const savePw = async () => {
    if (pw.length < 8) { toast('Use at least 8 characters', 'err'); return; }
    if (pw !== pw2) { toast('The two passwords do not match', 'err'); return; }
    setPwBusy(true);
    const res = await changePassword(pw);
    setPwBusy(false);
    if (!res.ok) { toast(res.error || 'Password not changed', 'err'); return; }
    setPw(''); setPw2(''); toast('Password changed');
  };

  return (
    <Screen>
      <Card>
        <Row gap={12}>
          <Avatar name={user.name} size={56} />
          <View style={{ flex: 1 }}>
            <T v="h2">{user.name}</T>
            <T v="small" tone="sub">{rlabel(user.role)}</T>
            {user.email ? <T v="small" tone="mute">{user.email}</T> : null}
          </View>
        </Row>
      </Card>
      <Section title="Your details">
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button label="Save" icon="check" onPress={save} busy={saving} />
      </Section>
      <Section title="Password">
        <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" />
        <Field label="Repeat it" value={pw2} onChangeText={setPw2} secureTextEntry autoCapitalize="none" />
        <Button label="Change password" icon="lock" variant="soft" tone="info" onPress={savePw} busy={pwBusy} />
      </Section>
    </Screen>
  );
}
