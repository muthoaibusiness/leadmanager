import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, updLead, addAct } from '../../lib/db.js';
import { ROLES } from '../../lib/constants.js';

export default function TransferLeadModal() {
  const { modal, closeModal, panLead, user, refreshDB, showToast } = useApp();
  const isOpen = modal === 'transfer-lead';

  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedIA, setSelectedIA] = useState('');
  const [selectedMA, setSelectedMA] = useState('');

  const db = getDB();
  
  // Find all available Teams and their Team Leads
  const teams = (db.teams || []).filter(t => !user?.companyId || !t.companyId || t.companyId === user?.companyId);
  const teamOptions = teams.map(t => {
    const tl = (db.users || []).find(u => u.id === t.leadId);
    return { teamId: t.id, tlName: tl ? tl.name : 'Team ' + t.id };
  }).sort((a, b) => a.tlName.localeCompare(b.tlName));

  // Find all agents under the currently selected team
  const iAgents = selectedTeamId
    ? (db.users || []).filter(u => u.teamId === selectedTeamId && u.role === ROLES.IA && u.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];
    
  const mAgents = selectedTeamId
    ? (db.users || []).filter(u => u.teamId === selectedTeamId && u.role === ROLES.MA && u.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];

  useEffect(() => {
    if (isOpen) {
      setSelectedTeamId('');
      setSelectedIA('');
      setSelectedMA('');
    }
  }, [isOpen]);

  // Auto-clear agents if team changes
  useEffect(() => {
    setSelectedIA('');
    setSelectedMA('');
  }, [selectedTeamId]);

  const handleIAChange = (val) => {
    setSelectedIA(val);
    if (val) setSelectedMA(''); // clear the other
  };

  const handleMAChange = (val) => {
    setSelectedMA(val);
    if (val) setSelectedIA(''); // clear the other
  };

  const submit = () => {
    const selectedAgentId = selectedIA || selectedMA;
    if (!selectedTeamId || !selectedAgentId || !panLead) return;
    
    const team = (db.teams || []).find(t => t.id === selectedTeamId);
    const tl = (db.users || []).find(u => u.id === team?.leadId);
    const newAgent = (db.users || []).find(u => u.id === selectedAgentId);
    if (!team || !newAgent) return;

    // Update the lead
    updLead(panLead, {
      teamId: selectedTeamId,
      assignedTo: selectedAgentId,
      assignedToName: newAgent.name,
      assignedRole: newAgent.role
    });

    // Add activity log
    const tlName = tl ? tl.name : 'Team ' + team.id;
    addAct(panLead, {
      type: 'NOTE',
      description: `Lead transferred to ${tlName}'s Team (Assigned to: ${newAgent.name} - ${newAgent.role === ROLES.IA ? 'Initial Agent' : 'Meeting Agent'})`,
      userId: user.id,
      userName: user.name,
      durationSeconds: 0
    });

    closeModal();
    refreshDB();
    showToast('Lead transferred successfully', 'ok');
  };

  if (!user) return null;

  return (
    <div className={`mov${isOpen ? ' on' : ''}`} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal">
        <div className="m-hd">
          <div className="m-ttl">Transfer Lead</div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>
        <div className="m-body">
          <div className="fl">
            <label>Select Team (Team Lead)</label>
            <select className="finp" value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}>
              <option value="">— Choose a Team —</option>
              {teamOptions.map(t => (
                <option key={t.teamId} value={t.teamId}>{t.tlName}'s Team</option>
              ))}
            </select>
          </div>
          
          <div className="fl" style={{ marginTop: '16px' }}>
            <label>Select Initial Agent</label>
            <select 
              className="finp" 
              value={selectedIA} 
              onChange={e => handleIAChange(e.target.value)}
              disabled={!selectedTeamId || iAgents.length === 0}
            >
              <option value="">{selectedTeamId ? (iAgents.length ? '— Choose Initial Agent —' : 'No Initial Agents in this team') : '— Select a Team first —'}</option>
              {iAgents.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="fl" style={{ marginTop: '16px' }}>
            <label>Select Meeting Agent</label>
            <select 
              className="finp" 
              value={selectedMA} 
              onChange={e => handleMAChange(e.target.value)}
              disabled={!selectedTeamId || mAgents.length === 0}
            >
              <option value="">{selectedTeamId ? (mAgents.length ? '— Choose Meeting Agent —' : 'No Meeting Agents in this team') : '— Select a Team first —'}</option>
              {mAgents.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" disabled={!selectedTeamId || (!selectedIA && !selectedMA)} onClick={submit}>Transfer</button>
        </div>
      </div>
    </div>
  );
}
