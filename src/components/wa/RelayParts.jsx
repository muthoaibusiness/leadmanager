import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { sbGet, sbUpsert, sbCount } from '../../lib/supabase.js';
import { normTestNumber } from './relayBots.js';

// WA Relay pieces that the AI Trainer page renders too (Bots tab, Live
// replies). One copy, so both pages behave the same.

// A small uppercase label above a section's title — the only decoration this
// page uses instead of boxed info callouts, kept consistent everywhere.
export function SectionHead({ icon, title, action }) {
  return (
    <div className="sec-hd" style={{ marginTop: '28px' }}>
      <div className="sec-t"><Mi>{icon}</Mi>{title}</div>
      {action}
    </div>
  );
}

// The checklist for one bot. Every switch is a column on that bot's
// wa_bot_settings row (migration 0034); the Edge Functions read the row on every
// message, so a change lands immediately. The note says what Off actually does.


const CHECKLIST = {
  eyad: [
    ['welcome_enabled', 'Intro / greeting message', 'First-contact welcome is not sent.'],
    ['faq_agent_enabled', 'AI reply (FAQ agent)', 'No automatic answers to customer questions.'],
    ['ai_media_enabled', 'AI sends photo / floor plan / brochure', 'AI answers in text only.'],
    ['auto_forward_enabled', 'Auto forward', 'Leads are never created automatically after the message count below.'],
    ['manual_forward_enabled', 'Manual forward (/fdh /fctg /fcml /fdu)', 'Agent forward commands are ignored.'],
    ['docs_command_enabled', 'Document sending (/send… commands)', 'Agent /send commands send nothing.'],
    ['takeover_enabled', 'Takeover (/t)', 'The handover message is not sent.'],
    ['notes_enabled', 'Notes (/n)', 'Agent notes are not saved to the lead.'],
    ['customer_notify_enabled', 'Notify customer when an agent is assigned', 'The customer gets no message about their assigned agent.'],
    ['meta_capi_enabled', 'Meta ads lead event (CAPI)', 'New ad leads are not reported to Meta.'],
  ],
  dubai: [
    ['welcome_enabled', 'Intro / greeting message', 'First-contact welcome is not sent.'],
    ['faq_agent_enabled', 'AI reply (FAQ agent)', 'No automatic answers to customer questions.'],
    ['ai_media_enabled', 'AI sends photo / floor plan / brochure', 'AI answers in text only.'],
    ['auto_forward_enabled', 'Auto forward (create a lead for every new contact)', 'Contacts are saved as pre-leads only, no lead is created.'],
    ['manual_forward_enabled', 'Manual forward (/f… commands)', 'Agent forward commands are ignored.'],
    ['docs_command_enabled', 'Document sending (drip)', 'The documents drip is not started.'],
    ['takeover_enabled', 'Takeover (/t)', 'The handover message is not sent.'],
    ['notes_enabled', 'Notes (/n)', 'Agent notes are not saved to the lead.'],
    ['customer_notify_enabled', 'Notify customer when an agent is assigned', 'The customer gets no message about their assigned agent.'],
    ['meta_capi_enabled', 'Meta ads lead event (CAPI)', 'New ad leads are not reported to Meta.'],
  ],
};

// What the bot sends when an agent gets assigned. Read-only here: the text lives
// in each bot's Edge Function, so editing it means changing that function.
const ASSIGN_TEMPLATES = {
  eyad: [
    ['New assignment', `প্রিয় {first name},

আপনার জন্য একজন ডেডিকেটেড এক্সপার্ট নির্ধারণ করা হয়েছে।

👨‍💼 {agent name}
📞 {agent phone}

তিনি শীঘ্রই আপনার সাথে যোগাযোগ করে সব কিছু বুঝিয়ে দেবেন।`],
    ['Already assigned', `প্রিয় {first name},

আপনি ইতিমধ্যে আমাদের একজন ডেডিকেটেড এক্সপার্টের সাথে যুক্ত আছেন।

👨‍💼 {agent name}
📞 {agent phone}

তিনি আপনার সব প্রশ্নের উত্তর দিতে থাকবেন।`],
  ],
  dubai: [
    ['New assignment', `Hello {first name},

A dedicated sales consultant has been assigned to assist you.

👨‍💼 {agent name}
📞 {agent phone}

He will contact you shortly and guide you through everything. 🤝

If you need anything in the meantime, feel free to reach out. Thank you! 💙`],
    ['Already assigned', `Hello {first name},

Thanks for reaching out again!
You’re already connected with one of our dedicated sales consultants.

👨‍💼 {agent name}
📞 {agent phone}

He is handling your query and will continue assisting you with all the details.

If you have any new questions or need further support, feel free to let us know anytime. Thank you!`],
  ],
};

// Mirrors the column defaults in migration 0034 so the panel still renders
// before the migration has been run.
const BOT_DEFAULTS = {
  welcome_enabled: true, welcome_message: '', faq_agent_enabled: true, ai_media_enabled: true,
  auto_forward_enabled: false, auto_forward_after_messages: 3, manual_forward_enabled: true,
  docs_command_enabled: true, takeover_enabled: true, notes_enabled: true,
  customer_notify_enabled: true, meta_capi_enabled: true, test_numbers: [],
};



// The allow-list chips and the Add field. Shared by BotPanel and the AI
// Trainer's Test numbers tab; the caller owns the list and saves it.
export function TestNumbersEditor({ numbers, busy, onChange, showToast }) {
  const [newTest, setNewTest] = useState('');
  const addTest = async () => {
    const num = normTestNumber(newTest);
    if (num.length < 10) { showToast('Enter a full phone number.', 'err'); return; }
    if (numbers.includes(num)) { setNewTest(''); return; }
    await onChange([...numbers, num]);
    setNewTest('');
  };
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
        {numbers.length === 0 && <span className="ea-count" style={{ margin: 0 }}>None yet.</span>}
        {numbers.map(num => (
          <span key={num} className="cot-badge ok" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            +{num}
            <button type="button" aria-label={`Remove ${num}`} title="Remove" disabled={busy}
              style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
              onClick={() => onChange(numbers.filter(x => x !== num))}><Mi style={{ fontSize: '15px' }}>close</Mi></button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input className="fi" inputMode="tel" placeholder="8801XXXXXXXXX" aria-label="Test number" value={newTest}
          onChange={e => setNewTest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTest(); }} style={{ flex: 1 }} />
        <button type="button" className="btn btn-g" disabled={!newTest.trim() || busy} onClick={addTest}><Mi>add</Mi>Add</button>
      </div>
    </>
  );
}

export function BotPanel({ bot, name, blurb, showToast }) {
  const [row, setRow] = useState(null); // null = still loading
  const [busy, setBusy] = useState(null);
  const [text, setText] = useState('');
  const [n, setN] = useState(3);
  const [dirty, setDirty] = useState({ text: false, n: false });

  useEffect(() => {
    let live = true;
    sbGet(`wa_bot_settings?bot=eq.${bot}&select=*`).then(rows => {
      if (!live) return;
      const r = { ...BOT_DEFAULTS, ...(bot === 'dubai' ? { auto_forward_enabled: true } : {}), ...(rows?.[0] || {}) };
      setRow(r);
      setText(r.welcome_message || '');
      setN(r.auto_forward_after_messages ?? 3);
    });
    return () => { live = false; };
  }, [bot]);

  // One upsert per change; display_name rides along so the insert is valid
  // even when this bot's row doesn't exist yet.
  const save = async (patch) => {
    const res = await sbUpsert('wa_bot_settings', [{ bot, display_name: name, ...patch }]);
    if (res?.ok === false) {
      showToast('Could not save. Run migrations 0034 and 0035 first.', 'err');
      return false;
    }
    return true;
  };

  const toggle = async (col) => {
    const next = !row[col];
    setRow(r => ({ ...r, [col]: next })); // optimistic
    setBusy(col);
    if (!(await save({ [col]: next }))) setRow(r => ({ ...r, [col]: !next }));
    setBusy(null);
  };

  const saveText = async () => {
    setBusy('welcome_message');
    if (await save({ welcome_message: text.trim() || null })) setDirty(d => ({ ...d, text: false }));
    setBusy(null);
  };

  const saveN = async () => {
    const value = Math.max(1, Number(n) || 3);
    setN(value);
    setBusy('auto_forward_after_messages');
    if (await save({ auto_forward_after_messages: value })) setDirty(d => ({ ...d, n: false }));
    setBusy(null);
  };

  const setTestNumbers = async (next) => {
    const prev = row.test_numbers || [];
    setRow(r => ({ ...r, test_numbers: next }));
    setBusy('test_numbers');
    if (!(await save({ test_numbers: next }))) setRow(r => ({ ...r, test_numbers: prev }));
    setBusy(null);
  };

  const list = CHECKLIST[bot];
  const onCount = row ? list.filter(([col]) => row[col]).length : 0;

  return (
    <div className="analytics-card" style={{ marginBottom: '18px' }}>
      <div className="ea-row relay-row">
        <div>
          <div style={{ fontWeight: 700 }}>{name}</div>
          <div className="ea-count" style={{ margin: 0 }}>{blurb}</div>
        </div>
        <span className="ea-count" style={{ margin: 0 }}>{row ? `${onCount} of ${list.length} on` : '…'}</span>
      </div>

      {row && list.map(([col, label, note]) => (
        <div key={col}>
          <div className="ea-row relay-row">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{label}</div>
              {!row[col] && <div className="ea-count" style={{ margin: 0 }}>Off: {note}</div>}
            </div>
            <button
              type="button"
              className={`cot-badge ${row[col] ? 'ok' : 'off'}`}
              style={{ cursor: 'pointer', border: 'none', minWidth: '46px', flexShrink: 0 }}
              disabled={busy === col}
              onClick={() => toggle(col)}
            >
              {row[col] ? 'On' : 'Off'}
            </button>
          </div>

          {col === 'customer_notify_enabled' && (
            <details className="relay-row">
              <summary className="ea-count" style={{ margin: 0, cursor: 'pointer' }}>View message templates</summary>
              {ASSIGN_TEMPLATES[bot].map(([title, body]) => (
                <div key={title} style={{ marginTop: '10px' }}>
                  <div style={{ fontWeight: 600, fontSize: '12px' }}>{title}</div>
                  <pre className="fi" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontFamily: 'inherit' }}>{body}</pre>
                </div>
              ))}
            </details>
          )}

          {col === 'welcome_enabled' && row.welcome_enabled && (
            <div className="relay-row">
              <div className="fg" style={{ margin: 0 }}>
                <label>Greeting text — leave empty to use the default</label>
                <textarea
                  className="fi" rows={3} value={text}
                  onChange={e => { setText(e.target.value); setDirty(d => ({ ...d, text: true })); }}
                  placeholder={'Hi {name},\nThank you for your interest in Wecon Properties Limited.'}
                />
              </div>
              <div className="ea-row" style={{ marginTop: '8px' }}>
                <div className="ea-count" style={{ margin: 0 }}>Use <code>{'{name}'}</code> for the customer's name.</div>
                <button type="button" className="btn btn-g" disabled={!dirty.text || busy === 'welcome_message'} onClick={saveText}>
                  {busy === 'welcome_message' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {col === 'auto_forward_enabled' && bot === 'eyad' && row.auto_forward_enabled && (
            <div className="ea-row relay-row">
              <label style={{ margin: 0, fontWeight: 600 }}>Forward after this many messages</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="number" min={1} className="fi" style={{ width: '64px' }}
                  value={n} onChange={e => { setN(e.target.value); setDirty(d => ({ ...d, n: true })); }}
                />
                <button type="button" className="btn btn-g" disabled={!dirty.n || busy === 'auto_forward_after_messages'} onClick={saveN}>
                  {busy === 'auto_forward_after_messages' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {row && (
        <div className="relay-row">
          <div style={{ fontWeight: 600 }}>Testing numbers</div>
          <div className="ea-count" style={{ margin: '2px 0 8px' }}>
            Chats with these numbers get every feature above, even the ones turned Off, so you can test a feature before switching it on for customers.
          </div>
          <TestNumbersEditor numbers={row.test_numbers || []} busy={busy === 'test_numbers'} onChange={setTestNumbers} showToast={showToast} />
        </div>
      )}
    </div>
  );
}

// Headline numbers for the Training section — how much the AI is actually
// carrying, and how often it needed a human correction.
export function TrainingStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const todayISO = new Date(new Date().toDateString()).toISOString();
      const [total, today, eyad, dubai, corrections] = await Promise.all([
        sbCount('wa_messages?sender_name=eq.AI Agent&direction=eq.OUT&type=eq.text'),
        sbCount(`wa_messages?sender_name=eq.AI Agent&direction=eq.OUT&type=eq.text&wa_timestamp=gte.${encodeURIComponent(todayISO)}`),
        sbCount('wa_messages?sender_name=eq.AI Agent&direction=eq.OUT&type=eq.text&conversation_id=like.eyad:*'),
        sbCount('wa_messages?sender_name=eq.AI Agent&direction=eq.OUT&type=eq.text&conversation_id=like.dubai:*'),
        sbCount('wa_message_corrections?is_active=eq.true'),
      ]);
      if (!live) return;
      setStats({ total, today, eyad, dubai, corrections });
    })();
    return () => { live = false; };
  }, []);

  if (!stats) return null;
  const items = [
    { label: 'Replies today', value: stats.today },
    { label: 'Replies total', value: stats.total },
    { label: 'Eyad bot', value: stats.eyad },
    { label: 'Dubai bot', value: stats.dubai },
    { label: 'Corrections made', value: stats.corrections },
  ];
  return (
    <div className="ea-row" style={{ gap: '12px', flexWrap: 'wrap', margin: '0 0 16px' }}>
      {items.map(it => (
        <div key={it.label} className="analytics-card" style={{ padding: '10px 16px', minWidth: '120px' }}>
          <div style={{ fontSize: '22px', fontWeight: 700 }}>{it.value}</div>
          <div className="ea-count">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// One past AI reply, with an inline editor to mark it wrong and save the fix.
// onSaved, when given, also runs after the legacy correction is stored (the
// AI Trainer uses it to save the same correction as a draft example).
export function TrainingRow({ item, onCorrected, onSaved, showToast }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.aiReply);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await sbUpsert('wa_message_corrections', [{
        conversation_id: item.conversationId, phone: item.phone,
        customer_message: item.customerMessage, original_reply: item.aiReply,
        corrected_reply: text.trim(),
      }]);
      if (res?.ok === false && !res.skipped) { showToast('Could not save — the database may be unavailable.', 'err'); return; }
      if (onSaved) await onSaved(item, text.trim());
      else showToast('Correction saved — the AI will use it going forward', 'ok');
      setEditing(false);
      onCorrected();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relay-row">
      <div className="ea-count" style={{ margin: '0 0 4px' }}>
        {item.phone} · {new Date(item.wa_timestamp).toLocaleString()}
      </div>
      <div style={{ marginBottom: '6px' }}><span style={{ fontWeight: 600 }}>Customer: </span>{item.customerMessage || '—'}</div>
      <div style={{ marginBottom: '8px' }}><span style={{ fontWeight: 600 }}>AI replied: </span>{item.aiReply}</div>
      {item.hasCorrection && !editing && (
        <div className="ea-count" style={{ margin: '0 0 8px', color: 'var(--green)' }}><Mi>check_circle</Mi> Already corrected</div>
      )}
      {editing ? (
        <>
          <textarea className="fi" rows={3} value={text} onChange={e => setText(e.target.value)} />
          <div className="ea-row" style={{ marginTop: '8px' }}>
            <button type="button" className="btn btn-g" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn btn-p" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save correction'}</button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-g" onClick={() => setEditing(true)}>
          <Mi>edit</Mi>{item.hasCorrection ? 'Edit correction' : 'This was wrong — fix it'}
        </button>
      )}
    </div>
  );
}

// Lets an admin review what the AI has been telling customers and, where it
// got something wrong, write the correct reply — saved corrections are fed
// back into the prompt (getCorrections() in _shared/wa.ts) as examples, so
// the same mistake doesn't repeat.
export function TrainingManager({ showToast, onSaved }) {
  const [items, setItems] = useState(null); // null = loading
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const replies = await sbGet(
        'wa_messages?sender_name=eq.AI Agent&direction=eq.OUT&type=eq.text&order=wa_timestamp.desc&limit=30&select=id,conversation_id,phone,body,wa_timestamp',
      );
      const [customerMsgs, corrections] = await Promise.all([
        Promise.all(replies.map(r => sbGet(
          `wa_messages?conversation_id=eq.${encodeURIComponent(r.conversation_id)}&direction=eq.IN&wa_timestamp=lt.${encodeURIComponent(r.wa_timestamp)}&order=wa_timestamp.desc&limit=1&select=body`,
        ))),
        sbGet(`wa_message_corrections?is_active=eq.true&select=conversation_id,original_reply`),
      ]);
      if (!live) return;
      const correctedKeys = new Set(corrections.map(c => `${c.conversation_id}::${c.original_reply}`));
      setItems(replies.map((r, i) => ({
        id: r.id, conversationId: r.conversation_id, phone: r.phone, aiReply: r.body, wa_timestamp: r.wa_timestamp,
        customerMessage: customerMsgs[i]?.[0]?.body || '',
        hasCorrection: correctedKeys.has(`${r.conversation_id}::${r.body}`),
      })));
    })();
    return () => { live = false; };
  }, [reloadKey]);

  return (
    <div>
      <SectionHead icon="school" title="Training" />
      <p className="ea-count" style={{ margin: '0 0 12px' }}>
        Recent AI replies to customers. Wrong one? Fix it here — the correction feeds back into future replies.
      </p>

      <TrainingStats />

      {items === null ? (
        <div className="ea-count">Loading…</div>
      ) : items.length === 0 ? (
        <div className="ea-count">No AI replies yet.</div>
      ) : (
        <div className="analytics-card">
          {items.map(item => (
            <TrainingRow key={item.id} item={item} showToast={showToast} onSaved={onSaved} onCorrected={() => setReloadKey(k => k + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}
