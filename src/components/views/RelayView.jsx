import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { waLoadSettings, waSaveSettings, isChatAdmin } from '../../lib/wa.js';
import { sbGet, sbUpsert, sbDelete } from '../../lib/supabase.js';

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
// Derived from the same VITE_SUPABASE_URL every other client call uses —
// a literal copy of that URL here trips Netlify's secrets scanner (it flags
// any build output that echoes a configured env var's value verbatim).
const FN_BASE = `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1`;
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
npx supabase secrets set META_CAPI_ACCESS_TOKEN=<the Meta CAPI token>
npx supabase secrets set OPENROUTER_API_KEY=<the OpenRouter key>`;

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

function CopyRow({ value, onCopy }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); onCopy?.(); }
    catch { /* clipboard not available — the field is still selectable */ }
  };
  return (
    <div className="relay-copy-row">
      <input className="finp" value={value} readOnly onFocus={e => e.target.select()} />
      <button type="button" className="btn btn-g" onClick={copy}><Mi>{copied ? 'check' : 'content_copy'}</Mi>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

// One row per deployed function: name, live/unknown status (checked lazily,
// never assumed), its URL, copy. A function that exists answers (even a
// 400/401 is a real response); one that was never deployed times out.
function EndpointRow({ label, sub, url }) {
  const [state, setState] = useState('unknown'); // unknown | checking | up | down
  const check = async () => {
    setState('checking');
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ping' }) });
      setState('up');
    } catch {
      setState('down');
    }
  };
  const badge = { unknown: null, checking: '…', up: 'Live', down: 'Unreachable' }[state];
  const tone = { unknown: 'off', checking: 'off', up: 'ok', down: 'warn' }[state];

  return (
    <div className="relay-row">
      <div className="ea-row" style={{ marginBottom: '8px' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{label}</div>
          {sub && <div className="ea-count" style={{ margin: 0 }}>{sub}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {badge && <span className={`cot-badge ${tone}`}>{badge}</span>}
          <button type="button" className="btn btn-g" disabled={state === 'checking'} onClick={check}>
            <Mi>network_check</Mi>Check
          </button>
        </div>
      </div>
      <CopyRow value={url} />
    </div>
  );
}

// Plain on/off switch, backed directly by a wa_settings column. Each toggle
// owns its own load/save — a slow save on one never blocks the other.
function SettingToggle({ label, hint, column }) {
  const [value, setValue] = useState(null); // null = still loading
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    sbGet(`wa_settings?id=eq.default&select=${column}`).then(rows => {
      if (live) setValue(rows?.[0]?.[column] === true);
    });
    return () => { live = false; };
  }, [column]);

  const toggle = async () => {
    const next = !value;
    setValue(next); // optimistic — a bot reads this within ~0 extra latency of it landing
    setSaving(true);
    try {
      const res = await sbUpsert('wa_settings', [{ id: 'default', [column]: next }]);
      if (res?.ok === false && !res.skipped) setValue(!next); // revert on a real failure
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ea-row relay-row">
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="ea-count" style={{ margin: 0 }}>{hint}</div>
      </div>
      <button
        type="button"
        className={`cot-badge ${value ? 'ok' : 'off'}`}
        style={{ cursor: 'pointer', border: 'none', minWidth: '46px', flexShrink: 0 }}
        disabled={value === null || saving}
        onClick={toggle}
      >
        {value === null ? '…' : value ? 'On' : 'Off'}
      </button>
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
        icon="apartment" title="Knowledge"
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
      <p className="ea-count" style={{ margin: '0 0 24px' }}>
        Replaces n8n — these Edge Functions hold the Wasender token, run the two bots, and answer customer
        questions from the catalog below. Deployed straight into this CRM's own Supabase project.
      </p>

      <SectionHead icon="dns" title="Relay" />
      <div className="analytics-card">
        <div className="relay-row">
          <div className="ea-row" style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 600 }}>Send relay</div>
            <span className={`cot-badge ${onEdge ? 'ok' : 'off'}`}>{onEdge ? 'Edge Function' : (s?.relayUrl ? 'n8n / custom' : 'Not set')}</span>
          </div>
          <CopyRow value={EDGE_SEND_URL} />
          {!onEdge && (
            <button type="button" className="btn btn-p" style={{ marginTop: '10px' }} disabled={switching} onClick={switchToEdge}>
              <Mi>swap_horiz</Mi>{switching ? 'Switching…' : 'Switch to this'}
            </button>
          )}
        </div>
        <div className="relay-row">
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>Inbound webhook — paste into Wasender</div>
          <CopyRow value={EDGE_WEBHOOK_URL} />
        </div>
      </div>

      <SectionHead icon="smart_toy" title="Bots" />
      <p className="ea-count" style={{ margin: '0 0 12px' }}>
        Each is its own Wasender webhook subscription (paste its URL into the matching session) — welcome message,
        /t /n /f* /send* commands, Meta CAPI, and the FAQ agent, independent of the inbound mirror above.
      </p>
      <div className="analytics-card">
        <EndpointRow label="Eyad" sub="paste into Wasender → Eyad session" url={EDGE_BOT_EYAD_URL} />
        <EndpointRow label="Dubai" sub="paste into Wasender → Dubai session" url={EDGE_BOT_DUBAI_URL} />
      </div>

      <SectionHead icon="tune" title="Automation" />
      <div className="analytics-card">
        <SettingToggle
          column="faq_agent_enabled"
          label="FAQ / Knowledge agent"
          hint="Answers customer questions from the catalog below, sends photos/floor plans/brochures on request."
        />
        <SettingToggle
          column="auto_forward_enabled"
          label="Auto-forward eligible leads (Eyad)"
          hint="After 3+ messages with no region set and no takeover, run the forward command automatically."
        />
      </div>

      <ProjectsManager showToast={showToast} />

      <div style={{ marginTop: '28px' }}>
        <button type="button" className="btn btn-g" onClick={() => setShowCmds(v => !v)}>
          <Mi>terminal</Mi>{showCmds ? 'Hide deploy commands' : 'Show deploy commands'}
        </button>
        {showCmds && (
          <pre style={{ background: 'var(--surf2)', border: '1px solid var(--bd)', borderRadius: 'var(--r-sm)', padding: '12px 14px', marginTop: '10px', fontSize: '12px', overflowX: 'auto', whiteSpace: 'pre' }}>
            {DEPLOY_COMMANDS}
          </pre>
        )}
      </div>
    </div>
  );
}
