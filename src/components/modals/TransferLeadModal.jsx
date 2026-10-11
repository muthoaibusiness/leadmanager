import { useState, useId } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import useChanged from '../../hooks/useChanged.js';
import { getDB, bulkTransferLeads } from '../../lib/db.js';
import { ROLES } from '../../lib/constants.js';

// Two callers, one modal.
//
//   panel  (no props)   the lead open in LeadPanel, via context `panLead`.
//   bulk   (props)      a selection from LeadTable — `leadIds` is the checked
//                       set and the host owns open/close, so the table can clear
//                       its checkboxes once the transfer actually lands.
//
// The picking UI and the write path are identical either way; only the count in
// the button and the toast differ.
export default function TransferLeadModal({ leadIds = null, open = null, onClose = null, onDone = null }) {
  const { modal, closeModal, panLead, user, refreshDB, showToast } = useApp();
  const uid = useId(); // field ids, so each <label htmlFor> points at its field
  const bulk = leadIds != null;
  const isOpen = bulk ? !!open : modal === 'transfer-lead';
  const ids = bulk ? leadIds : (panLead ? [panLead] : []);
  const close = onClose || closeModal;

  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');

  const db = getDB();

  // Find all available Teams and their Team Leads
  const teams = (db.teams || []).filter(t => !user?.companyId || !t.companyId || t.companyId === user?.companyId);
  const teamOptions = teams.map(t => {
    const tl = (db.users || []).find(u => u.id === t.leadId);
    return { teamId: t.id, tlName: tl ? tl.name : 'Team ' + t.id };
  }).sort((a, b) => a.tlName.localeCompare(b.tlName));

  // Find all agents under the currently selected team
  const agents = selectedTeamId
    ? (db.users || []).filter(u => u.teamId === selectedTeamId && u.role === ROLES.AGENT && u.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];

  if (useChanged(isOpen) && isOpen) {
    setSelectedTeamId('');
    setSelectedAgent('');
  }

  const submit = () => {
    const selectedAgentId = selectedAgent;
    if (!selectedTeamId || !selectedAgentId || !ids.length) return;

    const team = (db.teams || []).find(t => t.id === selectedTeamId);
    const tl = (db.users || []).find(u => u.id === team?.leadId);
    const newAgent = (db.users || []).find(u => u.id === selectedAgentId);
    if (!team || !newAgent) return;

    const teamLabel = `${tl ? tl.name : 'Team ' + team.id}'s Team`;
    const n = bulkTransferLeads(ids, { teamId: selectedTeamId, agent: newAgent, teamLabel }, user);

    close();
    onDone?.();
    refreshDB();
    showToast(n > 1 ? `${n} leads transferred to ${newAgent.name}` : 'Lead transferred successfully', 'ok');
  };

  if (!user) return null;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">{ids.length > 1 ? `Transfer ${ids.length} Leads` : 'Transfer Lead'}</div>
          <button className="m-x" onClick={close}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          {ids.length > 1 && (
            <div className="m-hint" style={{ marginBottom: '14px' }}>
              <Mi>swap_horiz</Mi>All {ids.length} selected customers move to the agent you pick below.
            </div>
          )}
          <div className="fl">
            <label htmlFor={`${uid}team`}>Select Team (Team Lead)</label>
            <select id={`${uid}team`} className="finp" value={selectedTeamId} onChange={e => { setSelectedTeamId(e.target.value); setSelectedAgent(''); }} style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}>
              <option value="">— Choose a Team —</option>
              {teamOptions.map(t => (
                <option key={t.teamId} value={t.teamId}>{t.tlName}'s Team</option>
              ))}
            </select>
          </div>

          <div className="fl" style={{ marginTop: '16px' }}>
            <label htmlFor={`${uid}agent`}>Select Agent</label>
            <select
              id={`${uid}agent`}
              className="finp"
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              disabled={!selectedTeamId || agents.length === 0}
            >
              <option value="">{selectedTeamId ? (agents.length ? '— Choose Agent —' : 'No Agents in this team') : '— Select a Team first —'}</option>
              {agents.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={close}>Cancel</button>
          <button className="btn btn-p" disabled={!selectedTeamId || !selectedAgent || !ids.length} onClick={submit}>
            {ids.length > 1 ? `Transfer ${ids.length}` : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
