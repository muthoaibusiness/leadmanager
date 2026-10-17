import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { isChatAdmin } from '../../lib/wa.js';
import { sbGet, sbUpsert, sbDelete, sbCount } from '../../lib/supabase.js';

// Supabase Edge Functions (wa-send, wa-webhook, wa-bot-eyad, wa-bot-dubai)
// hold the Wasender token, run the two bots, and answer customer questions
// from the catalog below — this tab controls that behaviour, not their
// deploy/webhook plumbing (see supabase/functions/ for that).

// A small uppercase label above a section's title — the only decoration this
// page uses instead of boxed info callouts, kept consistent everywhere.
function SectionHead({ icon, title, action }) {
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
const BOTS = [
  { bot: 'eyad', name: 'Eyad Bot', blurb: 'Wecon Properties WhatsApp number' },
  { bot: 'dubai', name: 'Dubai Bot', blurb: 'Dubai WhatsApp number' },
];

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

// Testing numbers (migration 0035) are stored as digits with the country code.
// A Bangladeshi number typed as 01XXXXXXXXX, +880 1XXX… or with a stray 0
// after 880 all become 8801XXXXXXXXX; anything else keeps its digits.
const normTestNumber = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  const bd = d.match(/^(?:880|0)*(1\d{9})$/);
  return bd ? '880' + bd[1] : d;
};

function BotPanel({ bot, name, blurb, showToast }) {
  const [row, setRow] = useState(null); // null = still loading
  const [busy, setBusy] = useState(null);
  const [text, setText] = useState('');
  const [n, setN] = useState(3);
  const [dirty, setDirty] = useState({ text: false, n: false });
  const [newTest, setNewTest] = useState('');

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
  const addTest = async () => {
    const num = normTestNumber(newTest);
    if (num.length < 10) { showToast('Enter a full phone number.', 'err'); return; }
    if ((row.test_numbers || []).includes(num)) { setNewTest(''); return; }
    await setTestNumbers([...(row.test_numbers || []), num]);
    setNewTest('');
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
            {(row.test_numbers || []).length === 0 && <span className="ea-count" style={{ margin: 0 }}>None yet.</span>}
            {(row.test_numbers || []).map(num => (
              <span key={num} className="cot-badge ok" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                +{num}
                <button type="button" aria-label={`Remove ${num}`} title="Remove" disabled={busy === 'test_numbers'}
                  style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                  onClick={() => setTestNumbers((row.test_numbers || []).filter(x => x !== num))}><Mi style={{ fontSize: '15px' }}>close</Mi></button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="fi" inputMode="tel" placeholder="8801XXXXXXXXX" value={newTest}
              onChange={e => setNewTest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTest(); }} style={{ flex: 1 }} />
            <button type="button" className="btn btn-g" disabled={!newTest.trim() || busy === 'test_numbers'} onClick={addTest}><Mi>add</Mi>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_PROJECT = {
  id: null, name: '', is_active: true, region: '', nature: '', sft: '', address: '',
  send_code: '', keywords: '', brochure_url: '', map_image_url: '', google_map_url: '', video_url: '',
  photos: '', floor_plans: '', floor_plan_labels: '',
};

// wa_projects row (DB arrays) <-> form state (newline/comma text the admin
// can actually type into a plain textarea).
function rowToForm(r) {
  return {
    id: r.id, name: r.name || '', is_active: r.is_active !== false,
    region: r.region || '', nature: r.nature || '', sft: r.sft || '', address: r.address || '',
    send_code: r.send_code || '', keywords: (r.keywords || []).join(', '),
    brochure_url: r.brochure_url || '', map_image_url: r.map_image_url || '',
    google_map_url: r.google_map_url || '', video_url: r.video_url || '',
    photos: (r.photos || []).join('\n'),
    floor_plans: (r.floor_plans || []).join('\n'),
    floor_plan_labels: (r.floor_plan_labels || []).join('\n'),
  };
}

function formToRow(f) {
  const row = {
    name: f.name.trim(), is_active: !!f.is_active,
    region: f.region.trim() || null, nature: f.nature.trim() || null, sft: f.sft.trim() || null,
    address: f.address.trim() || null, send_code: f.send_code.trim() || null,
    keywords: f.keywords.split(',').map(s => s.trim()).filter(Boolean),
    brochure_url: f.brochure_url.trim() || null, map_image_url: f.map_image_url.trim() || null,
    google_map_url: f.google_map_url.trim() || null, video_url: f.video_url.trim() || null,
    photos: f.photos.split('\n').map(s => s.trim()).filter(Boolean),
    floor_plans: f.floor_plans.split('\n').map(s => s.trim()).filter(Boolean),
    floor_plan_labels: f.floor_plan_labels.split('\n').map(s => s.trim()).filter(Boolean),
  };
  if (f.id != null) row.id = f.id;
  return row;
}

function ProjectModal({ initial, onClose, onSaved, showToast }) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(v => ({ ...v, [k]: e.target.value }));
  const setChecked = (k) => (e) => setF(v => ({ ...v, [k]: e.target.checked }));

  const save = async () => {
    if (!f.name.trim()) { showToast('Project name is required', 'err'); return; }
    setSaving(true);
    try {
      const res = await sbUpsert('wa_projects', [formToRow(f)]);
      if (res?.ok === false && !res.skipped) { showToast('Could not save — the database may be unavailable.', 'err'); return; }
      showToast('Project saved', 'ok');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: '640px' }}>
        <div className="m-hd">
          <div className="m-ttl">{f.id == null ? 'Add Project' : `Edit — ${f.name}`}</div>
          <button className="m-x" onClick={onClose}><Mi>close</Mi></button>
        </div>
        <div className="m-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="fg"><label>Name</label><input className="fi" value={f.name} onChange={set('name')} placeholder="Wecon Example" /></div>
          <div className="ea-row" style={{ margin: 0 }}>
            <label style={{ margin: 0 }}>Active (bot answers FAQs / sends docs for it)</label>
            <input type="checkbox" checked={f.is_active} onChange={setChecked('is_active')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="fg"><label>Region</label><input className="fi" value={f.region} onChange={set('region')} placeholder="Dhaka / Chattogram / …" /></div>
            <div className="fg"><label>Type</label><input className="fi" value={f.nature} onChange={set('nature')} placeholder="Residential / Commercial" /></div>
            <div className="fg"><label>Size</label><input className="fi" value={f.sft} onChange={set('sft')} placeholder="2850" /></div>
            <div className="fg"><label>/send code</label><input className="fi" value={f.send_code} onChange={set('send_code')} placeholder="/sendxy" /></div>
          </div>
          <div className="fg"><label>Address</label><input className="fi" value={f.address} onChange={set('address')} /></div>
          <div className="fg"><label>Keywords (comma-separated — matches the customer's own wording)</label><input className="fi" value={f.keywords} onChange={set('keywords')} placeholder="nuznan, jolshiri" /></div>
          <div className="fg"><label>Brochure URL</label><input className="fi" value={f.brochure_url} onChange={set('brochure_url')} /></div>
          <div className="fg"><label>Location map image URL</label><input className="fi" value={f.map_image_url} onChange={set('map_image_url')} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="fg"><label>Google Maps link</label><input className="fi" value={f.google_map_url} onChange={set('google_map_url')} /></div>
            <div className="fg"><label>Video URL</label><input className="fi" value={f.video_url} onChange={set('video_url')} /></div>
          </div>
          <div className="fg"><label>Photo URLs (one per line)</label><textarea className="fi" rows={3} value={f.photos} onChange={set('photos')} /></div>
          <div className="fg"><label>Floor plan image URLs (one per line)</label><textarea className="fi" rows={3} value={f.floor_plans} onChange={set('floor_plans')} /></div>
          <div className="fg"><label>Floor plan labels (one per line, same order as above — e.g. Ground Floor)</label><textarea className="fi" rows={3} value={f.floor_plan_labels} onChange={set('floor_plan_labels')} /></div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function ProjectsManager({ showToast }) {
  const [projects, setProjects] = useState(null); // null = loading
  const [editing, setEditing] = useState(null); // form state object, or null when modal closed

  const reload = () => {
    sbGet('wa_projects?select=*&order=name').then(setProjects);
  };
  useEffect(reload, []);

  const del = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? The bot will stop knowing about it.`)) return;
    await sbDelete('wa_projects', [row.id]);
    showToast('Project deleted', 'ok');
    reload();
  };

  return (
    <div>
      <SectionHead
        icon="apartment" title="Projects"
        action={(
          <button type="button" className="btn btn-p" onClick={() => setEditing(rowToForm(EMPTY_PROJECT))}>
            <Mi>add</Mi>Add Project
          </button>
        )}
      />
      <p className="ea-count" style={{ margin: '0 0 12px' }}>
        What the FAQ agent knows and can send. An inactive project is kept but never mentioned.
      </p>

      {projects === null ? (
        <div className="ea-count">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="ea-count">No projects yet.</div>
      ) : (
        <div className="analytics-card">
          {projects.map(p => (
            <div key={p.id} className="ea-row relay-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {p.name}
                  {!p.is_active && <span className="cot-badge off">inactive</span>}
                  {p.send_code && <span className="ea-count" style={{ margin: 0 }}>{p.send_code}</span>}
                </div>
                <div className="ea-count" style={{ margin: 0 }}>
                  {[p.region, p.nature, p.sft && `${p.sft} sft`].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button type="button" className="btn btn-g" onClick={() => setEditing(rowToForm(p))}><Mi>edit</Mi></button>
                <button type="button" className="btn btn-g" onClick={() => del(p)}><Mi>delete</Mi></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProjectModal initial={editing} onClose={() => setEditing(null)} onSaved={reload} showToast={showToast} />
      )}
    </div>
  );
}

const EMPTY_KNOWLEDGE = { id: null, title: '', body: '', is_active: true };

function KnowledgeModal({ initial, onClose, onSaved, showToast }) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!f.title.trim() || !f.body.trim()) { showToast('Title and text are both required', 'err'); return; }
    setSaving(true);
    try {
      const row = { title: f.title.trim(), body: f.body.trim(), is_active: !!f.is_active };
      if (f.id != null) row.id = f.id;
      const res = await sbUpsert('wa_knowledge', [row]);
      if (res?.ok === false && !res.skipped) { showToast('Could not save — the database may be unavailable.', 'err'); return; }
      showToast('Saved', 'ok');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: '560px' }}>
        <div className="m-hd">
          <div className="m-ttl">{f.id == null ? 'Add Rule' : 'Edit Rule'}</div>
          <button className="m-x" onClick={onClose}><Mi>close</Mi></button>
        </div>
        <div className="m-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="fg"><label>Title</label><input className="fi" value={f.title} onChange={e => setF(v => ({ ...v, title: e.target.value }))} placeholder="e.g. Land acquisition inquiries" /></div>
          <div className="fg">
            <label>What the AI should do / know</label>
            <textarea
              className="fi" rows={6} value={f.body}
              onChange={e => setF(v => ({ ...v, body: e.target.value }))}
              placeholder="Write it the way you'd brief a new team member. Bangla or English, the AI reads both."
            />
          </div>
          <div className="ea-row" style={{ margin: 0 }}>
            <label style={{ margin: 0 }}>Active</label>
            <input type="checkbox" checked={f.is_active} onChange={e => setF(v => ({ ...v, is_active: e.target.checked }))} />
          </div>
        </div>
        <div className="m-ft">
          <button className="btn btn-g" onClick={onClose}>Cancel</button>
          <button className="btn btn-p" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// Free-text behavioural rules the FAQ agent follows — e.g. the Land Team's
// number, the Jolshiri price-range script. Every active row is appended to
// the system prompt (getKnowledge() in _shared/wa.ts) so these change
// without touching code.
function KnowledgeManager({ showToast }) {
  const [rows, setRows] = useState(null); // null = loading
  const [editing, setEditing] = useState(null);

  const reload = () => {
    sbGet('wa_knowledge?select=*&order=created_at.asc').then(setRows);
  };
  useEffect(reload, []);

  const del = async (row) => {
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    await sbDelete('wa_knowledge', [row.id]);
    showToast('Deleted', 'ok');
    reload();
  };

  return (
    <div>
      <SectionHead
        icon="menu_book" title="Knowledge &amp; Rules"
        action={(
          <button type="button" className="btn btn-p" onClick={() => setEditing(EMPTY_KNOWLEDGE)}>
            <Mi>add</Mi>Add Rule
          </button>
        )}
      />
      <p className="ea-count" style={{ margin: '0 0 12px' }}>
        How the AI should handle a type of question — the Land Team's number, the price-range script, anything else
        not covered by a project's own details.
      </p>

      {rows === null ? (
        <div className="ea-count">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="ea-count">No rules yet.</div>
      ) : (
        <div className="analytics-card">
          {rows.map(r => (
            <div key={r.id} className="relay-row">
              <div className="ea-row" style={{ marginBottom: '4px' }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {r.title}
                  {!r.is_active && <span className="cot-badge off">inactive</span>}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button type="button" className="btn btn-g" onClick={() => setEditing(r)}><Mi>edit</Mi></button>
                  <button type="button" className="btn btn-g" onClick={() => del(r)}><Mi>delete</Mi></button>
                </div>
              </div>
              <div className="ea-count" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.body}</div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <KnowledgeModal initial={editing} onClose={() => setEditing(null)} onSaved={reload} showToast={showToast} />
      )}
    </div>
  );
}

// Headline numbers for the Training section — how much the AI is actually
// carrying, and how often it needed a human correction.
function TrainingStats() {
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
function TrainingRow({ item, onCorrected, showToast }) {
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
      showToast('Correction saved — the AI will use it going forward', 'ok');
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
function TrainingManager({ showToast }) {
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
            <TrainingRow key={item.id} item={item} showToast={showToast} onCorrected={() => setReloadKey(k => k + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RelayView() {
  const { user, showToast } = useApp();

  if (!isChatAdmin(user)) {
    return <div className="ea-count" style={{ padding: 18 }}>Only Management can see the WhatsApp relay setup.</div>;
  }

  return (
    <div className="acc">
      <p className="ea-count" style={{ margin: '0 0 24px' }}>
        Replaces n8n — these Edge Functions hold the Wasender token, run the two bots, and answer customer
        questions from the catalog below. Deployed straight into this CRM's own Supabase project.
      </p>

      <KnowledgeManager showToast={showToast} />

      <SectionHead icon="tune" title="Bots" />
      <p className="ea-count" style={{ margin: '0 0 12px' }}>
        Each bot has its own checklist. Changes apply to the next message, no redeploy needed.
      </p>
      {BOTS.map(b => <BotPanel key={b.bot} {...b} showToast={showToast} />)}

      <ProjectsManager showToast={showToast} />
      <TrainingManager showToast={showToast} />
    </div>
  );
}
