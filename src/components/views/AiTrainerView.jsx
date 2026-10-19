import { useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import { isChatAdmin } from '../../lib/wa.js';
import { trainerCall } from '../../lib/aiTrainer.js';
import KnowledgeTab from '../aitrainer/KnowledgeTab.jsx';
import BehaviourTab from '../aitrainer/BehaviourTab.jsx';
import PlaygroundTab from '../aitrainer/PlaygroundTab.jsx';
import QualityTab from '../aitrainer/QualityTab.jsx';
import BotsTab from '../aitrainer/BotsTab.jsx';
import TestNumbersTab from '../aitrainer/TestNumbersTab.jsx';
import ModelTab from '../aitrainer/ModelTab.jsx';
import PromptTab from '../aitrainer/PromptTab.jsx';
import AiTrainerPills from '../aitrainer/AiTrainerPills.jsx';
import { AI_TRAINER_TABS } from '../aitrainer/tabs.js';
import '../aitrainer/aitrainer.css';

// AI Trainer: Management trains the WhatsApp bot here. Edits are drafts; the
// bots only use a snapshot after it passes every regression test and is
// published (docs/superpowers/specs/2026-10-18-wecon-ai-trainer-design.md).
// isChatAdmin only decides what to show; the server checks the user's role.

export default function AiTrainerView() {
  const { user, showToast } = useApp();
  const [tab, setTab] = useNavState('aitrainer.tab', 'knowledge');
  // Stable across renders: the tabs load data in effects keyed on `api`, so a
  // new function every render would refetch in a loop.
  const api = useCallback((action, payload) => trainerCall(user, action, payload), [user]);
  if (!isChatAdmin(user)) return <div className="ea-count" style={{ padding: 18 }}>Only Management can use the AI Trainer.</div>;
  const props = { api, showToast, user };
  return (
    <div className="ait">
      <AiTrainerPills tabs={AI_TRAINER_TABS} active={tab} onChange={setTab} />
      <div className="ait-panel" id={`aitrainer-panel-${tab}`} role="tabpanel" aria-labelledby={`aitrainer-tab-${tab}`}>
        {tab === 'knowledge' && <KnowledgeTab {...props} />}
        {tab === 'behaviour' && <BehaviourTab {...props} />}
        {tab === 'playground' && <PlaygroundTab {...props} />}
        {tab === 'quality' && <QualityTab {...props} />}
        {tab === 'bots' && <BotsTab {...props} />}
        {tab === 'testnumbers' && <TestNumbersTab {...props} />}
        {tab === 'prompt' && <PromptTab {...props} />}
        {tab === 'model' && <ModelTab {...props} />}
      </div>
    </div>
  );
}
