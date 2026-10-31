import { useCallback, useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { sbGet, sbUpsert } from '../../lib/supabase.js';
import { TestNumbersEditor } from '../wa/RelayParts.jsx';
import { BOTS } from '../wa/relayBots.js';

// Trainer test mode (migration 0038). Off by default. When on, a chat with one
// of the bot's test numbers is answered by the trainer core over the current
// drafts instead of the legacy FAQ agent; every other chat stays on legacy.
// The switch goes through the ai-trainer function (audited, Management only);
// the allow-list is the same test_numbers WA Relay edits.
const fmt = (t) => (t ? new Date(t).toLocaleString() : '');

function Thread({ th }) {
  return (
    <div className="analytics-card" style={{ padding: '12px' }}>
      <div className="meta" style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{th.name || th.phone} · {th.id}</div>
      <div className="ait-chat" style={{ minHeight: 0 }}>
        {th.messages.length === 0 && <div className="ea-count">No messages yet.</div>}
        {th.messages.map(m => (
          <div key={m.id} className={`ait-msg ${m.direction === 'IN' ? 'customer' : 'bot'}`}>
            {m.type === 'text' ? m.body : `[${m.type}] ${m.caption || ''}`}
            <div className="ait-trace">
              {m.direction === 'IN' ? 'customer' : m.sender_name || 'agent'} · {fmt(m.wa_timestamp)}
              {m.direction === 'OUT' && <> · <span className={`ait-badge ${m.status === 'FAILED' ? 'fail' : 'pass'}`}>{m.status}</span></>}
              {m.error && <span className="ait-err"> {m.error}</span>}
            </div>
          </div>
        ))}
      </div>
      {th.turns.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="ea-count" style={{ cursor: 'pointer', margin: 0 }}>Trainer turns ({th.turns.length})</summary>
          {th.turns.map(t => (
            <div key={t.id} className="ait-row" style={{ marginTop: 6, flexDirection: 'column' }}>
              <div><span className={`ait-badge ${t.outcome === 'ok' ? 'pass' : /fallback|failed|error|blocked/.test(t.outcome || '') ? 'fail' : 'inc'}`}>{t.outcome}</span> <span className="meta">{fmt(t.started_at)} · core {t.core_version} · {t.model}</span></div>
              {t.trace?.reply && <div className="ait-trace">reply: {t.trace.reply}</div>}
              <div className="ait-trace">
                project: {(t.trace?.project?.projects || []).join(', ') || '—'} ({t.trace?.project?.source || 'none'})
                {' · '}used: {(t.trace?.used_item_ids || []).join(', ') || '—'}
                {t.trace?.guard_errors?.length ? ` · guard: ${t.trace.guard_errors.join(', ')}` : ''}
                {t.trace?.send_errors?.length ? ` · send: ${t.trace.send_errors.join(', ')}` : ''}
                {t.trace?.model_error ? ` · model: ${t.trace.model_error}` : ''}
                {t.trace?.error ? ` · error: ${t.trace.error}` : ''}
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function BotTestNumbers({ bot, name, api, showToast }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('testnumbers.get', { bot }).then(setData).catch(e => showToast(e.message, 'err')), [api, bot, showToast]);
  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    const next = !data.trainer_test_mode;
    if (next && !window.confirm(`Turn trainer test mode on for ${name}? Only the test numbers below get trainer replies; customers stay on the current bot.`)) return;
    setBusy(true);
    try { await api('testnumbers.set', { bot, trainer_test_mode: next }); await load(); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  // Same write as WA Relay's Testing numbers (wa_bot_settings.test_numbers).
  const setNumbers = async (next) => {
    setBusy(true);
    try {
      const cur = (await sbGet(`wa_bot_settings?bot=eq.${bot}&select=bot`))[0];
      if (!cur) { showToast('This bot has no settings row yet. Open the Bots tab once.', 'err'); return; }
      const res = await sbUpsert('wa_bot_settings', [{ bot, display_name: name, test_numbers: next }]);
      if (res?.ok === false) { showToast('Could not save. Run migrations 0034 and 0035 first.', 'err'); return; }
      await load();
    } finally { setBusy(false); }
  };

  if (!data) return <div className="analytics-card"><div className="ea-count">Loading…</div></div>;
  const numbers = data.numbers.map(n => n.number);
  return (
    <section className="analytics-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="ea-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700 }}>{name}</div>
          <div className="ea-count" style={{ margin: 0 }}>
            {data.trainer_test_mode ? 'Trainer test mode is on: test numbers get trainer replies from the current drafts.' : 'Trainer test mode is off: every chat, test numbers included, uses the current bot.'}
          </div>
        </div>
        <button type="button" role="switch" aria-checked={data.trainer_test_mode} aria-label={`Trainer test mode for ${name}`}
          className={`cot-badge ${data.trainer_test_mode ? 'ok' : 'off'}`} style={{ cursor: 'pointer', border: 'none', minWidth: 46 }}
          disabled={busy} onClick={toggle}>{data.trainer_test_mode ? 'On' : 'Off'}</button>
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>Test numbers</div>
        <div className="ea-count" style={{ margin: '2px 0 8px' }}>
          The same list as WA Relay. These chats also get every bot checklist feature. Replies go only to these numbers.
        </div>
        <TestNumbersEditor numbers={numbers} busy={busy} onChange={setNumbers} showToast={showToast} />
      </div>
      <div className="ea-row" style={{ justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Conversations</div>
        <button type="button" className="btn btn-g btn-sm" onClick={load} disabled={busy}><Mi>refresh</Mi>Refresh</button>
      </div>
      {data.numbers.map(n => (
        <div key={n.number} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="ea-count" style={{ margin: 0 }}>+{n.number}</div>
          {n.threads.length === 0 ? <div className="ea-count">No chat from this number yet.</div> : n.threads.map(th => <Thread key={th.id} th={th} />)}
        </div>
      ))}
    </section>
  );
}

export default function TestNumbersTab({ api, showToast }) {
  return (
    <div className="ait">
      <p className="ea-count" style={{ margin: 0 }}>
        Try the trainer on a real WhatsApp chat before publishing. Bot pointers are not changed; customers keep the current bot.
      </p>
      {BOTS.map(b => <BotTestNumbers key={b.bot} bot={b.bot} name={b.name} api={api} showToast={showToast} />)}
    </div>
  );
}
