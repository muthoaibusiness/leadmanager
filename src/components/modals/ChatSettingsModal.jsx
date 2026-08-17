import { useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { rlabel, avc, ini } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import { waLoadSettings, waSaveSettings, waSaveToken, isChatAdmin } from '../../lib/wa.js';

// Admin-only WhatsApp configuration: which accounts get the Conversations
// section, where outbound messages are relayed, and rotation of the Wasender
// credential. The token is write-only — it is posted to the relay, stored by the
// service role in wa_secrets, and never read back into the browser.
export default function ChatSettingsModal() {
  const { modal, closeModal, user, waSettings, setWaSettings, showToast } = useApp();
  const isOpen = modal === 'chat-settings';

  const [relayUrl, setRelayUrl] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [allowed, setAllowed] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenSet, setTokenSet] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const s = waSettings;
    if (!s) return;
    setRelayUrl(s.relayUrl || '');
    setSessionName(s.sessionName || '');
    setWebhookUrl(s.webhookUrl || '');
    setEnabled(s.enabled !== false);
    setAllowed(new Set(s.allowedUserIds || []));
    setTokenSet(!!s.tokenSet);
    setToken('');
    setSecret('');
  }, [isOpen, waSettings]);

  if (!isOpen) return <div className="mov" onClick={closeModal} />;
  if (!isChatAdmin(user)) {
    return (
      <div className="mov on" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
        <div className="modal">
          <div className="m-hd"><div className="m-ttl">Chat Settings</div><button className="m-x" onClick={closeModal}><Mi>close</Mi></button></div>
          <div className="m-body"><p className="ea-count">Only Management can change chat settings.</p></div>
        </div>
      </div>
    );
  }

  const db = getDB();
  // Master sees every tenant; Management stays inside its own company.
  const candidates = db.users
    .filter(u => (user.role === ROLES.MASTER ? true : u.companyId === user.companyId))
    .filter(u => u.role !== ROLES.MASTER)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? candidates.filter(u => (u.name || '').toLowerCase().includes(ql) || (u.email || '').toLowerCase().includes(ql) || rlabel(u.role).toLowerCase().includes(ql))
    : candidates;

  const toggle = (id) => setAllowed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const next = {
        relayUrl: relayUrl.trim(), sessionName: sessionName.trim(), webhookUrl: webhookUrl.trim(),
        enabled, allowedUserIds: [...allowed],
      };
      const res = await waSaveSettings(next, user);
      if (res && res.ok === false && !res.skipped) {
        showToast('Could not save — run migration 0002 in Supabase first.', 'err');
        return;
      }
      const fresh = await waLoadSettings();
      setWaSettings(fresh);
      showToast('Chat settings saved', 'ok');
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const saveToken = async () => {
    if (!token.trim()) { showToast('Enter a token first.', 'err'); return; }
    setTokenSaving(true);
    try {
      const res = await waSaveToken({ relayUrl: relayUrl.trim() }, { apiToken: token.trim(), webhookSecret: secret.trim() }, user);
      if (!res.ok) { showToast(res.error || 'Could not store the token.', 'err'); return; }
      setTokenSet(true);
      setToken('');
      setSecret('');
      setWaSettings(await waLoadSettings());
      showToast('Credentials stored server-side', 'ok');
    } finally {
      setTokenSaving(false);
    }
  };

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="modal modal-lg">
        <div className="m-hd">
          <div className="m-ttl">Chat Settings · <span style={{ color: 'var(--t3)', fontWeight: 600 }}>WhatsApp (Wasender)</span></div>
          <button className="m-x" onClick={closeModal}><Mi>close</Mi></button>
        </div>

        <div className="m-body">
          <div className="fl">
            <div className="ea-row">
              <label style={{ margin: 0 }}>Chat enabled</label>
              <button className={`ea-all${enabled ? ' on' : ''}`} onClick={() => setEnabled(v => !v)}>
                <Mi>{enabled ? 'toggle_on' : 'toggle_off'}</Mi>{enabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="ea-count">Turning this off hides Conversations for every non-admin account.</div>
          </div>

          <div className="fl">
            <label>Relay URL</label>
            <input
              className="finp"
              value={relayUrl}
              onChange={e => setRelayUrl(e.target.value)}
              placeholder="https://<project>.functions.supabase.co/wa-send  ·  or your n8n webhook"
            />
            <div className="ea-count">Server endpoint that holds the API token and talks to Wasender. The browser only ever POSTs here.</div>
          </div>

          <div className="fl">
            <label>Inbound webhook URL <span style={{ color: 'var(--t3)' }}>(paste this into Wasender)</span></label>
            <input
              className="finp"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://<project>.functions.supabase.co/wa-webhook"
            />
            <div className="ea-count">Reference only — stored so the team can find it later.</div>
          </div>

          <div className="fl">
            <label>Session / device name <span style={{ color: 'var(--t3)' }}>(optional)</span></label>
            <input className="finp" value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="wecon-main" />
          </div>

          <div className="fl wa-cred">
            <div className="ea-row">
              <label style={{ margin: 0 }}>Wasender credentials</label>
              <span className={`wa-cred-state${tokenSet ? ' on' : ''}`}>
                <Mi>{tokenSet ? 'lock' : 'lock_open'}</Mi>{tokenSet ? 'Token stored' : 'Not set'}
              </span>
            </div>
            <div className="wa-cred-row">
              <input
                className="finp"
                type={showToken ? 'text' : 'password'}
                value={token}
                autoComplete="new-password"
                onChange={e => setToken(e.target.value)}
                placeholder={tokenSet ? 'Enter a new token to rotate' : 'Private API token'}
              />
              <button className="wa-cbtn" onClick={() => setShowToken(v => !v)} title={showToken ? 'Hide' : 'Show'}>
                <Mi>{showToken ? 'visibility_off' : 'visibility'}</Mi>
              </button>
            </div>
            <input
              className="finp"
              type="password"
              value={secret}
              autoComplete="new-password"
              onChange={e => setSecret(e.target.value)}
              placeholder="Webhook signing secret (optional)"
              style={{ marginTop: '8px' }}
            />
            <button className="btn btn-g wa-fullbtn" disabled={tokenSaving || !relayUrl.trim()} onClick={saveToken}>
              <Mi>key</Mi>{tokenSaving ? 'Storing…' : (tokenSet ? 'Rotate credentials' : 'Store credentials')}
            </button>
            <div className="ea-count">
              Sent straight to the relay and written to <code>wa_secrets</code> by the service role. It is never stored in
              the browser, never returned by the API, and never included in the built bundle. Set the relay URL first.
            </div>
          </div>

          <div className="fl">
            <div className="ea-row">
              <label style={{ margin: 0 }}>Who can use chat</label>
              <span className="ea-count" style={{ margin: 0 }}>{allowed.size} account{allowed.size === 1 ? '' : 's'}</span>
            </div>
            <div className="wa-search wa-search-inline">
              <Mi>search</Mi>
              <input placeholder="Search accounts" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div className="wa-userlist">
              {shown.map(u => (
                <button key={u.id} className={`wa-userrow${allowed.has(u.id) ? ' on' : ''}`} onClick={() => toggle(u.id)}>
                  <Mi>{allowed.has(u.id) ? 'check_box' : 'check_box_outline_blank'}</Mi>
                  {u.avatar
                    ? <img className="wa-ci-av wa-ci-img wa-userav" src={u.avatar} alt="" />
                    : <div className="wa-ci-av wa-userav" style={{ background: avc(u.name) }}>{ini(u.name)}</div>}
                  <span className="wa-usertx">
                    <span className="wa-username">{u.name}</span>
                    <span className="wa-userrole">{rlabel(u.role)}{u.email ? ' · ' + u.email : ''}</span>
                  </span>
                </button>
              ))}
              {!shown.length && <div className="cl-none">No account matches.</div>}
            </div>
            <div className="ea-count">
              Management and Master always have access. With this list empty, only a Dubai Initial Agent account can open
              Conversations.
            </div>
          </div>
        </div>

        <div className="m-ft">
          <button className="btn btn-g" onClick={closeModal}>Cancel</button>
          <button className="btn btn-p" disabled={saving} onClick={save}><Mi>save</Mi>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </div>
    </div>
  );
}
