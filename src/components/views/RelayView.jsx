import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { waLoadSettings, waSaveSettings, isChatAdmin } from '../../lib/wa.js';

// Where these come from: supabase/functions/{wa-send,wa-webhook,wa-bot-eyad,
// wa-bot-dubai}, deployed straight into the CRM's own Supabase project — no
// cross-project hop needed, the platform-injected SUPABASE_URL/SERVICE_ROLE_KEY
// already point at this same project. Replaces n8n as the thing that holds the
// Wasender token and talks to it (wa-send/wa-webhook), and as the two WhatsApp
// bots (wa-bot-eyad/wa-bot-dubai, ported from "Wecon WA Bot"/"Wecon WA Bot
// Dubai"). The two bots are independent Wasender webhook subscriptions of
// their own — Wasender fans each delivery out to a bot function AND
// wa-webhook in parallel, same as n8n's trigger fanned out to "Parse Event"
// and "Forward to CRM Chat".
const FN_BASE = 'https://sbqmougcvnplgjgihpwe.supabase.co/functions/v1';
const EDGE_SEND_URL = `${FN_BASE}/wa-send`;
const EDGE_WEBHOOK_URL = `${FN_BASE}/wa-webhook`;
const EDGE_BOT_EYAD_URL = `${FN_BASE}/wa-bot-eyad`;
const EDGE_BOT_DUBAI_URL = `${FN_BASE}/wa-bot-dubai`;

const DEPLOY_COMMANDS = `cd c:\\Projects\\wepro
npx supabase link --project-ref sbqmougcvnplgjgihpwe
npx supabase functions deploy wa-send --no-verify-jwt
npx supabase functions deploy wa-webhook --no-verify-jwt
npx supabase functions deploy wa-bot-eyad --no-verify-jwt
npx supabase functions deploy wa-bot-dubai --no-verify-jwt
npx supabase secrets set META_CAPI_ACCESS_TOKEN=<the Meta CAPI token>`;

function CopyField({ label, value, hint }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard not available — the field is still selectable */ }
  };
  return (
    <div className="fl">
      <label>{label}</label>
      <div className="relay-copy-row">
        <input className="finp" value={value} readOnly onFocus={e => e.target.select()} />
        <button type="button" className="btn btn-g" onClick={copy}><Mi>{copied ? 'check' : 'content_copy'}</Mi>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {hint && <div className="ea-count">{hint}</div>}
    </div>
  );
}

// A function that exists answers (even a 400/401 is a real response); one
// that was never deployed times out / fails the fetch outright. That's the
// only "is it deployed yet" signal available from the browser.
function PingRow({ label, url }) {
  const [pinging, setPinging] = useState(false);
  const [result, setResult] = useState(null);

  const ping = async () => {
    setPinging(true);
    setResult(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ping' }) });
      setResult({ ok: true, detail: `Deployed and reachable (HTTP ${r.status})` });
    } catch (e) {
      setResult({ ok: false, detail: 'Not reachable — ' + (e.message || 'not deployed yet?') });
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="ea-row" style={{ alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="ea-count" style={{ wordBreak: 'break-all', margin: 0 }}>{url}</div>
        {result && (
          <div className="ea-count" style={{ color: result.ok ? 'var(--green)' : 'var(--red)', marginTop: '4px' }}>
            <Mi>{result.ok ? 'check_circle' : 'error'}</Mi> {result.detail}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-g" disabled={pinging} onClick={ping}>
        <Mi>{pinging ? 'hourglass_empty' : 'network_check'}</Mi>{pinging ? 'Checking…' : 'Check'}
      </button>
    </div>
  );
}

export default function RelayView() {
  const { user, waSettings, setWaSettings, showToast } = useApp();
  const [switching, setSwitching] = useState(false);
  const [showCmds, setShowCmds] = useState(false);

  if (!isChatAdmin(user)) {
    return <div className="ea-count" style={{ padding: 18 }}>Only Management can see the WhatsApp relay setup.</div>;
  }

  const s = waSettings;
  const onEdge = s?.relayUrl === EDGE_SEND_URL;

  const switchToEdge = async () => {
    setSwitching(true);
    try {
      const next = {
        relayUrl: EDGE_SEND_URL, webhookUrl: EDGE_WEBHOOK_URL,
        sessionName: s?.sessionName || '', enabled: s?.enabled !== false, allowedUserIds: s?.allowedUserIds || [],
      };
      const res = await waSaveSettings(next, user);
      if (res && res.ok === false && !res.skipped) { showToast('Could not save — the database may still be unavailable.', 'err'); return; }
      setWaSettings(await waLoadSettings());
      showToast('Relay switched to the Edge Function. Paste the webhook URL into Wasender too.', 'ok');
    } catch (e) {
      showToast(e.message || 'Could not reach the database.', 'err');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="acc">
      <div className="sec-hd"><div className="sec-t"><Mi>dns</Mi>WhatsApp Relay</div></div>
      <div className="m-hint" style={{ marginBottom: '16px' }}>
        <Mi>info</Mi>
        Replaces n8n: these Edge Functions hold the Wasender token and talk to it, deployed straight into this
        CRM's own Supabase project.
      </div>

      <div className="analytics-card" style={{ marginBottom: '16px' }}>
        <div className="ea-row" style={{ marginBottom: '12px' }}>
          <label style={{ margin: 0 }}>Currently active relay</label>
          <span className={`cot-badge ${onEdge ? 'ok' : 'warn'}`}>{onEdge ? 'Edge Function' : (s?.relayUrl ? 'n8n (or custom)' : 'Not set')}</span>
        </div>
        <div className="ea-count" style={{ marginBottom: '14px', wordBreak: 'break-all' }}>{s?.relayUrl || '— none configured —'}</div>
        <button type="button" className="btn btn-p" disabled={switching || onEdge} onClick={switchToEdge}>
          <Mi>swap_horiz</Mi>{switching ? 'Switching…' : onEdge ? 'Already on the Edge Function' : 'Switch to the Edge Function'}
        </button>
      </div>

      <CopyField
        label="Send relay URL"
        value={EDGE_SEND_URL}
        hint="Set automatically by the switch button above (Chat Settings → Relay URL)."
      />
      <CopyField
        label="Inbound webhook URL — paste into Wasender"
        value={EDGE_WEBHOOK_URL}
        hint="Wasender dashboard → your session → Webhook URL. Not something this app can set for you."
      />

      <div className="sec-hd" style={{ marginTop: '22px' }}><div className="sec-t"><Mi>smart_toy</Mi>WhatsApp Bots</div></div>
      <div className="m-hint" style={{ marginBottom: '12px' }}>
        <Mi>info</Mi>
        Ported from the n8n "Wecon WA Bot" / "Wecon WA Bot Dubai" workflows — welcome message, /t /f* /send* commands,
        Meta CAPI. Each is its own Wasender webhook subscription, independent of the inbound mirror above.
      </div>
      <div className="analytics-card" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <PingRow label="Bot — Eyad" url={EDGE_BOT_EYAD_URL} />
        <PingRow label="Bot — Dubai" url={EDGE_BOT_DUBAI_URL} />
      </div>
      <CopyField label="Eyad bot webhook URL — paste into Wasender (Eyad session)" value={EDGE_BOT_EYAD_URL} />
      <CopyField label="Dubai bot webhook URL — paste into Wasender (Dubai session)" value={EDGE_BOT_DUBAI_URL} />

      <div className="fl" style={{ marginTop: '18px' }}>
        <button type="button" className="btn btn-g" onClick={() => setShowCmds(v => !v)}>
          <Mi>terminal</Mi>{showCmds ? 'Hide deploy commands' : 'Show deploy commands'}
        </button>
        {showCmds && (
          <pre style={{ background: 'var(--surf2)', border: '1px solid var(--bd)', borderRadius: 'var(--r-sm)', padding: '12px 14px', marginTop: '10px', fontSize: '12px', overflowX: 'auto', whiteSpace: 'pre' }}>
            {DEPLOY_COMMANDS}
          </pre>
        )}
        <div className="ea-count">Run once from a terminal to (re)deploy all four functions — the "Check" buttons above tell you if a function is live yet.</div>
      </div>
    </div>
  );
}
