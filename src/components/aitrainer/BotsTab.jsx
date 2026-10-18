import { BotPanel } from '../wa/RelayParts.jsx';
import { BOTS } from '../wa/relayBots.js';

// The WA Relay bot checklist, greeting, auto-forward threshold, assignment
// templates and testing numbers: the same component and the same
// wa_bot_settings rows, so a change here is a change there.
export default function BotsTab({ showToast }) {
  return (
    <div>
      <p className="ea-count" style={{ margin: '0 0 12px' }}>
        Each bot has its own checklist. Changes apply to the next message, no redeploy needed. The same settings are on WA Relay.
      </p>
      {BOTS.map(b => <BotPanel key={b.bot} {...b} showToast={showToast} />)}
    </div>
  );
}
