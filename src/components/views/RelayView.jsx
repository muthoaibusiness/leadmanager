import { useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { waLoadSettings, waSaveSettings, isChatAdmin } from '../../lib/wa.js';

// Where these come from: supabase/functions/wa-send and wa-webhook, deployed
// to a dedicated project (wepro-wa-relay) rather than the CRM's own — they
// reach the CRM's real data over the network via TARGET_SUPABASE_URL /
// TARGET_SUPABASE_SERVICE_ROLE_KEY secrets, the same way the n8n relay does.
// Replaces n8n as the thing that holds the Wasender token and talks to it.
const FN_BASE = 'https://mvbqfrgixdkktgypyaan.supabase.co/functions/v1';
const EDGE_SEND_URL = `${FN_BASE}/wa-send`;
const EDGE_WEBHOOK_URL = `${FN_BASE}/wa-webhook`;

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

export default function RelayView() {
  const { user, waSettings, setWaSettings, showToast } = useApp();
  const [switching, setSwitching] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState(null);

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

  const ping = async () => {
    setPinging(true);
    setPingResult(null);
    try {
      const r = await fetch(EDGE_SEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ping' }) });
      // A reachable function answers 400 "Unknown action" — that IS the healthy
      // response here, not a failure; only a network error means it's down.
      setPingResult({ ok: true, detail: `Reachable (HTTP ${r.status})` });
    } catch (e) {
      setPingResult({ ok: false, detail: e.message || 'Unreachable' });
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="acc">
      <div className="sec-hd"><div className="sec-t"><Mi>dns</Mi>WhatsApp Relay</div></div>
      <div className="m-hint" style={{ marginBottom: '16px' }}>
        <Mi>info</Mi>
        Replaces n8n: these Edge Functions hold the Wasender token and talk to it, hosted on a separate project
        but reading/writing the CRM's real WhatsApp data over the network.
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

      <div className="fl">
        <button type="button" className="btn btn-g" disabled={pinging} onClick={ping}>
          <Mi>{pinging ? 'hourglass_empty' : 'network_check'}</Mi>{pinging ? 'Checking…' : 'Check the send relay is reachable'}
        </button>
        {pingResult && (
          <div className="ea-count" style={{ color: pingResult.ok ? 'var(--green)' : 'var(--red)', marginTop: '8px' }}>
            <Mi>{pingResult.ok ? 'check_circle' : 'error'}</Mi> {pingResult.detail}
          </div>
        )}
      </div>
    </div>
  );
}
