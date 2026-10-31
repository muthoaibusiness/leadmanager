import { BotPanel } from '../wa/RelayParts.jsx';
import { BOTS } from '../wa/relayBots.js';
import BotControl from './BotControl.jsx';

// Bot control (customer replies, what customers get, versions, production
// actions) on top; below it, the full WA Relay checklist on the same
// wa_bot_settings rows, so a change here is a change there.
export default function BotsTab({ api, showToast }) {
  return (
    <div className="ait">
      <BotControl api={api} showToast={showToast} />
      <details>
        <summary className="ea-count" style={{ cursor: 'pointer', margin: 0 }}>All bot settings (greeting, forwarding, commands, testing numbers)</summary>
        <p className="ea-count" style={{ margin: '12px 0' }}>
          Each bot has its own checklist. Changes apply to the next message, no redeploy needed. The same settings are on WA Relay.
        </p>
        {BOTS.map(b => <BotPanel key={b.bot} {...b} showToast={showToast} />)}
      </details>
    </div>
  );
}
