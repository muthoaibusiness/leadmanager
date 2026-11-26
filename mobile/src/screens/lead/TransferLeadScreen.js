// Management moves one lead, or a selection, to a team and an agent on it.
// The rules are the web TransferLeadModal's (src/components/modals/TransferLeadModal.jsx):
// the same teams and agents are offered, and the write is bulkTransferLeads
// (a single lead is just the one-element case).
import { useLayoutEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Empty, Row, Screen, T, useUI } from '../../ui';
import { space } from '../../theme';
import { useApp } from '../../store';
import { PersonRow, Hint, ListNote, useDiscardOnBack } from './forward/parts';
import { getDB, bulkTransferLeads } from '../../../../src/lib/db.js';
import { ROLES } from '../../../../src/lib/constants.js';

export default function TransferLeadScreen({ navigation, route }) {
  const { user, refresh, dbVersion } = useApp();
  const { toast } = useUI();
  void dbVersion; // re-read the store after any change
  const raw = route.params?.leadIds;
  const ids = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [raw] : [];

  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');

  useLayoutEffect(() => { navigation.setOptions({ title: ids.length > 1 ? `Transfer ${ids.length} Leads` : 'Transfer Lead' }); }, [navigation, ids.length]);

  // The web modal has no discard guard; the page asks with the same wording the other forms use.
  const leave = useDiscardOnBack(navigation, !!selectedTeamId || !!selectedAgent, { title: 'Discard transfer?', description: 'Your unsaved transfer details will be lost.' });

  const db = getDB();

  // All available teams and their Team Leads
  const teams = (db.teams || []).filter((t) => !user?.companyId || !t.companyId || t.companyId === user?.companyId);
  const teamOptions = teams.map((t) => {
    const tl = (db.users || []).find((u) => u.id === t.leadId);
    return { teamId: t.id, tlName: tl ? tl.name : 'Team ' + t.id };
  }).sort((a, b) => a.tlName.localeCompare(b.tlName));

  // All agents under the currently selected team
  const agents = selectedTeamId
    ? (db.users || []).filter((u) => u.teamId === selectedTeamId && u.role === ROLES.AGENT && u.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];

  const submit = () => {
    const selectedAgentId = selectedAgent;
    if (!selectedTeamId || !selectedAgentId || !ids.length) return;

    const team = (db.teams || []).find((t) => t.id === selectedTeamId);
    const tl = (db.users || []).find((u) => u.id === team?.leadId);
    const newAgent = (db.users || []).find((u) => u.id === selectedAgentId);
    if (!team || !newAgent) return;

    const teamLabel = `${tl ? tl.name : 'Team ' + team.id}'s Team`;
    const n = bulkTransferLeads(ids, { teamId: selectedTeamId, agent: newAgent, teamLabel }, user);

    refresh();
    toast(n > 1 ? `${n} leads transferred to ${newAgent.name}` : 'Lead transferred successfully', 'ok');
    leave();
  };

  if (!user) return null;
  if (!ids.length) return <Screen><Empty icon="swap-horiz" title="No lead selected" hint="Open a customer and choose Transfer lead." /></Screen>;

  return (
    <Screen footer={<View style={{ padding: space.lg }}><Button label={ids.length > 1 ? `Transfer ${ids.length}` : 'Transfer'} icon="swap-horiz" onPress={submit} disabled={!selectedTeamId || !selectedAgent || !ids.length} /></View>}>
      {ids.length > 1 ? <Hint icon="swap-horiz">All {ids.length} selected customers move to the agent you pick below.</Hint> : null}

      <View style={{ gap: space.sm }}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Select Team (Team Lead)</T>
        <Row wrap>
          {teamOptions.map((o) => (
            <Chip key={o.teamId} label={`${o.tlName}'s Team`} active={selectedTeamId === o.teamId}
              onPress={() => { if (selectedTeamId !== o.teamId) { setSelectedTeamId(o.teamId); setSelectedAgent(''); } }} />
          ))}
        </Row>
        {!teamOptions.length ? <ListNote icon="group-off">No teams yet</ListNote> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <T v="small" tone="sub" style={{ fontWeight: '600' }}>Select Agent</T>
        {!selectedTeamId ? <ListNote icon="groups">Select a Team first</ListNote>
          : !agents.length ? <ListNote icon="group-off">No Agents in this team</ListNote>
            : agents.map((u) => <PersonRow key={u.id} person={u} showRole={false} selected={selectedAgent === u.id} onPress={() => setSelectedAgent(u.id)} />)}
      </View>
    </Screen>
  );
}
