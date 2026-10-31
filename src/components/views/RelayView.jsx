import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { isChatAdmin } from '../../lib/wa.js';
import { sbGet, sbUpsert, sbDelete } from '../../lib/supabase.js';
import { SectionHead, BotPanel, TrainingManager } from '../wa/RelayParts.jsx';
import { BOTS } from '../wa/relayBots.js';

// Supabase Edge Functions (wa-send, wa-webhook, wa-bot-eyad, wa-bot-dubai)
// hold the Wasender token, run the two bots, and answer customer questions
// from the catalog below — this tab controls that behaviour, not their
// deploy/webhook plumbing (see supabase/functions/ for that).

const EMPTY_PROJECT = {
  id: null, name: '', is_active: true, region: '', nature: '', sft: '', address: '', office_address: '',
  send_code: '', keywords: '', brochure_url: '', map_image_url: '', google_map_url: '', video_url: '',
  photos: '', floor_plans: '', floor_plan_labels: '',
};

// wa_projects row (DB arrays) <-> form state (newline/comma text the admin
// can actually type into a plain textarea).
function rowToForm(r) {
  return {
    id: r.id, name: r.name || '', is_active: r.is_active !== false,
    region: r.region || '', nature: r.nature || '', sft: r.sft || '', address: r.address || '',
    office_address: r.office_address || '',
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
    address: f.address.trim() || null, office_address: f.office_address.trim() || null,
    send_code: f.send_code.trim() || null,
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
          <div className="fg"><label>WECON office for this project (the bot gives this when asked where the office is)</label><input className="fi" value={f.office_address} onChange={set('office_address')} placeholder="House 5A, Road 25A, Dhaka 1212" /></div>
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
