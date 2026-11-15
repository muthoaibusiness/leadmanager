import { useCallback, useEffect, useMemo, useState } from 'react';
import Loader from '../ui/loader.jsx';
import Mi from '../Mi.jsx';
import useNavState from '../../hooks/useNavState.js';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { uid } from '../../lib/helpers.js';
import { SB_URL, SB_H, ensureFreshToken } from '../../lib/supabase.js';
import { SRC_LABELS } from '../../lib/constants.js';
import {
  SECRETS, FIELD_TARGETS, ASSIGN_MODES, FORWARD_TAGS, DUPLICATE_POLICIES, NEW_LEAD_STATUSES, webhookUrl, emptyForm, validateForm, validateSettings,
  formToRow, rowToForm, keysOf, cleanPageId, ago, summarizeEvents,
} from '../../lib/fbLeads.js';
import '../fbleads/fbleads.css';

// Admin > Facebook Leads: where Facebook Lead Ads forms are connected and told what
// to do with the leads they bring. This page only configures (tables from migration
// 0059); the credentials are Edge Function secrets and never pass through here.

const TABS = [{ key: 'setup', label: 'Setup' }, { key: 'forms', label: 'Forms' }, { key: 'log', label: 'Received' }];
// The chips on a Received row: who got the lead, whether the customer was messaged, whether Meta was told.
const MSG_CHIP = { sent: ['Customer messaged', 'ok'], failed: ['Message failed', 'bad'], off: ['Message off', 'mut'], skipped: ['No message', 'mut'] };
const CAPI_CHIP = { sent: ['Meta CAPI sent', 'ok'], unclear: ['Meta CAPI unclear', 'warn'], failed: ['Meta CAPI failed', 'bad'], off: ['Meta CAPI off', 'mut'] };
const EVENT_TONE = { created: 'ok', duplicate: 'warn', skipped: 'mut', failed: 'bad', received: 'mut' };

// A write to PostgREST that says what went wrong in words. A missing table (the
// migration has not been applied) is reported on its own.
async function call(path, init = {}) {
  try {
    await ensureFreshToken();
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...SB_H, ...(init.headers || {}) } });
    if (r.ok) { const t = await r.text(); return { ok: true, data: t ? JSON.parse(t) : null }; }
    let j = null; try { j = await r.json(); } catch { /* not JSON */ }
    const missing = r.status === 404 || j?.code === 'PGRST205' || j?.code === '42P01';
    return { ok: false, missing, error: missing ? 'missing' : j?.message || `HTTP ${r.status}` };
  } catch { return { ok: false, error: 'Could not reach the server. Check your connection.' }; }
}

const DEFAULT_SETTINGS = { id: 'default', enabled: false, page_id: '', page_name: '', default_status: 'NEW', duplicate_policy: 'note', notify_agent: true };

// Everything the page shows, read in one go.
async function fetchAll() {
  const [s, f, e, p, all, bq] = await Promise.all([
    call('fb_lead_settings?id=eq.default&select=*'),
    call('fb_lead_forms?select=*&order=created_at.asc'),
    call('fb_lead_events?select=*&order=received_at.desc&limit=100'),
    call('wa_projects?select=name&is_active=eq.true&order=name'),
    call('fb_lead_events?select=leadgen_id,form_id,status&limit=1000'),
    call('fb_lead_backlog?select=leadgen_id,form_id&limit=1000'),   // absent before migration 0063: no queue column
  ]);
  return {
    missing: !!(s.missing || f.missing || e.missing),
    settings: s.data?.[0] || DEFAULT_SETTINGS,
    forms: (f.data || []).map(rowToForm),
    events: e.data || [],
    score: summarizeEvents(all.data || [], bq.data || []),
    projects: (p.data || []).map((x) => x.name),
  };
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`fbl-sw${on ? ' on' : ''}`} onClick={() => onChange(!on)} aria-label={label}><i /></button>
  );
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } };
  return <button type="button" className="fbl-btn ghost" onClick={copy}><Mi>{done ? 'check' : 'content_copy'}</Mi>{done ? 'Copied' : label}</button>;
}

export default function FbLeadsView() {
  const { user, showToast } = useApp();
  const [tab, setTab] = useNavState('fbleads.tab', 'setup');
  const [settings, setSettings] = useState(null);
  const [forms, setForms] = useState([]);
  const [events, setEvents] = useState([]);
  const [shown, setShown] = useState(10);   // Received rows on screen: the latest few, more on request
  const [score, setScore] = useState({ rows: [], total: null });
  const [projects, setProjects] = useState([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const db = getDB();

  const people = useMemo(() => (db.users || []).filter((u) => u.isActive !== false && ['AGENT', 'MEETING_AGENT', 'TEAM_LEAD'].includes(u.role)).sort((a, b) => a.name.localeCompare(b.name)), [db.users]);
  const teams = db.teams || [];
  const nameOf = (id) => (db.users || []).find((u) => u.id === id)?.name || '—';

  // Put what fetchAll() read on screen.
  const apply = useCallback((d) => {
    if (d.missing) setMissing(true);
    else {
      setMissing(false);
      setSettings(d.settings);
      setForms(d.forms);
      setEvents(d.events);
      setScore(d.score);
    }
    setProjects(d.projects);
    setLoading(false);
  }, []);
  const load = useCallback(async () => apply(await fetchAll()), [apply]);
  useEffect(() => {
    let alive = true;
    fetchAll().then((d) => { if (alive) apply(d); });
    return () => { alive = false; };
  }, [apply]);

  const saveSettings = async () => {
    const errs = validateSettings(settings);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const row = { ...settings, company_id: user.companyId || null, page_id: cleanPageId(settings.page_id) || null, updated_at: new Date().toISOString(), updated_by: user.id };
    const r = await call('fb_lead_settings?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) });
    setBusy(false);
    showToast(r.ok ? 'Settings saved.' : `Not saved: ${r.error}`, r.ok ? 'ok' : 'err');
  };

  const saveForm = async () => {
    const errs = validateForm(editing, { existingFormIds: forms.filter((f) => f.id !== editing.id).map((f) => f.form_id) });
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    const r = await call('fb_lead_forms?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([formToRow(editing, user.companyId, 'fbf' + uid())]) });
    setBusy(false);
    if (!r.ok) { showToast(`Not saved: ${r.error}`, 'err'); return; }
    showToast('Form saved.', 'ok');
    setEditing(null);
    load();
  };

  const toggleForm = async (f) => {
    const r = await call(`fb_lead_forms?id=eq.${encodeURIComponent(f.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: !f.active, updated_at: new Date().toISOString() }) });
    if (!r.ok) showToast(`Not saved: ${r.error}`, 'err'); else setForms((all) => all.map((x) => (x.id === f.id ? { ...x, active: !f.active } : x)));
  };
  const removeForm = async (f) => {
    if (!window.confirm(`Remove "${f.label}"? Leads already created stay.`)) return;
    const r = await call(`fb_lead_forms?id=eq.${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!r.ok) showToast(`Not removed: ${r.error}`, 'err'); else setForms((all) => all.filter((x) => x.id !== f.id));
  };

  const url = webhookUrl(SB_URL);
  const assignText = (f) => (f.assign_mode === 'agent' ? `Agent: ${nameOf(f.assign_agent_id)}`
    : f.assign_mode === 'team' ? `Team lead of ${teams.find((t) => t.id === f.assign_team_id)?.name || '—'}`
    : f.assign_mode === 'round_robin' ? `Round robin · ${f.assign_pool.length} agents`
    : f.assign_mode === 'forward' ? `Forward ${f.forward_tag}${f.notify_customer ? ' · customer messaged' : ''}` : 'Unassigned');
  const setS = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setF = (patch) => setEditing((f) => ({ ...f, ...patch }));

  if (loading && !settings && !missing) return <div className="fbl"><Loader className="ldr-page" title="Loading Facebook Leads…" subtitle="Fetching forms and settings" /></div>;

  return (
    <div className="fbl">
      {missing && (
        <div className="fbl-warn"><Mi>database</Mi><span>The Facebook Leads tables are not in the database yet. Run <b>supabase/migrations/0059_fb_lead_forms.sql</b> in the Supabase SQL editor, then reload.</span><button className="fbl-btn" onClick={load}>Reload</button></div>
      )}

      {!missing && (
        <>
          {/* The tabs, and the receive switch at the end of their line. */}
          <div className="fbl-tabrow">
            <div className="pill-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setErrors([]); }}>
                  {t.label}{t.key === 'forms' && forms.length ? ` (${forms.length})` : ''}
                </button>
              ))}
            </div>
            {settings && (
            <label className="fbl-onoff">
              <span>{settings.enabled ? 'Receiving' : 'Off'}</span>
              <Switch on={!!settings.enabled} onChange={(v) => setS({ enabled: v })} label="Receive Facebook leads" />
            </label>
            )}
          </div>

          {/* Phones: the tab row stays put and this scrolls (index.css .tab-scroll). */}
          <div className="tab-scroll">
          {errors.length > 0 && <ul className="fbl-errs">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

          {tab === 'setup' && settings && (
            <>
              <section className="fbl-card">
                <h3>Facebook Page</h3>
                <label className="fbl-fld"><span>Page id</span>
                  <input value={settings.page_id || ''} onChange={(e) => setS({ page_id: e.target.value })} inputMode="numeric" placeholder="e.g. 104718884272119" />
                </label>
                <label className="fbl-fld"><span>Page name <small>(only for you)</small></span>
                  <input value={settings.page_name || ''} onChange={(e) => setS({ page_name: e.target.value })} placeholder="Wecon Properties" />
                </label>
              </section>

              <section className="fbl-card">
                <h3>When a lead arrives</h3>
                <label className="fbl-fld"><span>It starts as</span>
                  <select value={settings.default_status} onChange={(e) => setS({ default_status: e.target.value })}>
                    {NEW_LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <div className="fbl-fld"><span>If the phone is already a lead</span>
                  <div className="fbl-opts">
                    {DUPLICATE_POLICIES.map((p) => (
                      <label key={p.key} className={`fbl-opt${settings.duplicate_policy === p.key ? ' on' : ''}`}>
                        <input type="radio" name="dup" checked={settings.duplicate_policy === p.key} onChange={() => setS({ duplicate_policy: p.key })} />
                        <b>{p.label}</b><small>{p.hint}</small>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="fbl-check"><input type="checkbox" checked={!!settings.notify_agent} onChange={(e) => setS({ notify_agent: e.target.checked })} />Tell the agent a new lead arrived</label>
              </section>

              <section className="fbl-card">
                <h3>Connect Meta</h3>
                <ol className="fbl-steps">
                  <li>In your Facebook app, add the <b>Webhooks</b> product and choose <b>Page</b>.</li>
                  <li>Callback URL: <code>{url}</code> <CopyBtn text={url} /></li>
                  <li>Verify token: the word you set as <code>FB_VERIFY_TOKEN</code> below.</li>
                  <li>Subscribe to the <code>leadgen</code> field, and subscribe the app to your Page.</li>
                </ol>
                <h4>Secrets to set</h4>
                <p className="fbl-note">These stay on the server. Set each with <code>npx supabase secrets set NAME=value</code>.</p>
                <ul className="fbl-secrets">
                  {SECRETS.map((s) => (
                    <li key={s.name}><div><code>{s.name}</code><small>{s.what}</small></div><CopyBtn text={s.name} label="Copy name" /></li>
                  ))}
                </ul>
              </section>

              <div className="fbl-actions"><button className="fbl-btn solid" onClick={saveSettings} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
            </>
          )}

          {tab === 'forms' && !editing && (
            <>
              <div className="fbl-actions"><button className="fbl-btn solid" onClick={() => { setErrors([]); setEditing(emptyForm()); }}><Mi>add</Mi>Add form</button></div>
              {forms.length === 0 && <div className="fbl-empty"><Mi>dynamic_form</Mi>No forms yet. Add the Facebook form behind each campaign and say where its leads go.</div>}
              <ul className="fbl-forms">
                {forms.map((f) => (
                  <li key={f.id} className="fbl-card">
                    <div className="fbl-form-top">
                      <div><b>{f.label}</b><small>Form {f.form_id}</small></div>
                      <Switch on={f.active} onChange={() => toggleForm(f)} label={`${f.label} active`} />
                    </div>
                    <div className="fbl-chips">
                      <span><Mi>apartment</Mi>{f.project}</span>
                      <span><Mi>campaign</Mi>{SRC_LABELS[f.source] || f.source}</span>
                      <span><Mi>person</Mi>{assignText(f)}</span>
                    </div>
                    <div className="fbl-row-actions">
                      <button className="fbl-btn ghost" onClick={() => { setErrors([]); setEditing(f); }}><Mi>edit</Mi>Edit</button>
                      <button className="fbl-btn ghost danger" onClick={() => removeForm(f)}><Mi>delete</Mi>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === 'forms' && editing && (
            <section className="fbl-card">
              <h3>{editing.id ? 'Edit form' : 'Add form'}</h3>
              <label className="fbl-fld"><span>Facebook form id</span>
                <input value={editing.form_id} onChange={(e) => setF({ form_id: e.target.value })} inputMode="numeric" placeholder="From Meta: Leads Center → the form" />
              </label>
              <label className="fbl-fld"><span>Name</span>
                <input value={editing.label} onChange={(e) => setF({ label: e.target.value })} placeholder="Citizen Avenue – shop enquiry" />
              </label>
              <label className="fbl-fld"><span>Project</span>
                <select value={editing.project} onChange={(e) => setF({ project: e.target.value })}>
                  <option value="">Choose…</option>
                  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="fbl-fld"><span>Lead source</span>
                <select value={editing.source} onChange={(e) => setF({ source: e.target.value })}>
                  {Object.entries(SRC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="fbl-fld"><span>Starts as <small>(blank = the default in Setup)</small></span>
                <select value={editing.status} onChange={(e) => setF({ status: e.target.value })}>
                  <option value="">Default</option>
                  {NEW_LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>

              <div className="fbl-fld"><span>Who gets the lead</span>
                <div className="fbl-opts">
                  {ASSIGN_MODES.map((m) => (
                    <label key={m.key} className={`fbl-opt${editing.assign_mode === m.key ? ' on' : ''}`}>
                      <input type="radio" name="assign" checked={editing.assign_mode === m.key} onChange={() => setF({ assign_mode: m.key })} />
                      <b>{m.label}</b><small>{m.hint}</small>
                    </label>
                  ))}
                </div>
              </div>
              {editing.assign_mode === 'agent' && (
                <label className="fbl-fld"><span>Agent</span>
                  <select value={editing.assign_agent_id} onChange={(e) => setF({ assign_agent_id: e.target.value })}>
                    <option value="">Choose…</option>
                    {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
              )}
              {editing.assign_mode === 'team' && (
                <label className="fbl-fld"><span>Team</span>
                  <select value={editing.assign_team_id} onChange={(e) => setF({ assign_team_id: e.target.value })}>
                    <option value="">Choose…</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              )}
              {editing.assign_mode === 'round_robin' && (
                <div className="fbl-fld"><span>Agents in the rotation</span>
                  <div className="fbl-pool">
                    {people.map((u) => {
                      const on = editing.assign_pool.includes(u.id);
                      return <button type="button" key={u.id} className={on ? 'on' : ''} onClick={() => setF({ assign_pool: on ? editing.assign_pool.filter((x) => x !== u.id) : [...editing.assign_pool, u.id] })}>{u.name}</button>;
                    })}
                  </div>
                </div>
              )}
              {editing.assign_mode === 'forward' && (
                <>
                  <label className="fbl-fld"><span>Forward tag</span>
                    <input list="fbl-tags" value={editing.forward_tag} onChange={(e) => setF({ forward_tag: e.target.value })} placeholder="/fctg" />
                    <datalist id="fbl-tags">{FORWARD_TAGS.map((t) => <option key={t} value={t} />)}</datalist>
                  </label>
                  <label className="fbl-onoff"><span>Message the customer on WhatsApp with who their expert is</span>
                    <Switch on={editing.notify_customer} onChange={(v) => setF({ notify_customer: v })} label="Message the customer" />
                  </label>
                  <p className="fbl-note">Sent from the Eyad number, and only when the Eyad bot's &ldquo;Notify customer when an agent is assigned&rdquo; switch is on. The first message to someone who has never written to that number is what WhatsApp watches most closely, so keep the volume sensible.</p>
                </>
              )}

              <div className="fbl-fld"><span>Which form question fills which field</span>
                <p className="fbl-note">Type the question key as Facebook names it. Several keys separated by commas are tried in order.</p>
                <div className="fbl-map">
                  {FIELD_TARGETS.map((t) => (
                    <label key={t.key}><em>{t.label}{t.required ? ' *' : ''}</em>
                      <input value={keysOf(editing.field_map[t.key]).join(', ')} onChange={(e) => setF({ field_map: { ...editing.field_map, [t.key]: e.target.value } })} placeholder="question key" />
                    </label>
                  ))}
                </div>
              </div>

              <div className="fbl-actions">
                <button className="fbl-btn ghost" onClick={() => { setEditing(null); setErrors([]); }}>Cancel</button>
                <button className="fbl-btn solid" onClick={saveForm} disabled={busy}>{busy ? 'Saving…' : 'Save form'}</button>
              </div>
            </section>
          )}

          {tab === 'log' && (
            <section className="fbl-card">
              <div className="fbl-form-top"><h3>Received</h3><button className="fbl-btn ghost" onClick={load}><Mi>refresh</Mi>Refresh</button></div>
              {score.total && score.total.received + score.total.queued > 0 && (
                <div className="fbl-sum-wrap">
                  <table className="fbl-sum">
                    <thead><tr><th>Form</th><th>Received</th><th>Distributed</th><th>Duplicate</th><th>Failed</th><th>Skipped</th><th>Queued</th></tr></thead>
                    <tbody>
                      {score.rows.map((r) => (
                        <tr key={r.form_id}>
                          <td>{forms.find((f) => f.form_id === r.form_id)?.label || `Form ${r.form_id || '—'}`}</td>
                          <td>{r.received}</td><td className="ok">{r.distributed}</td><td>{r.duplicate}</td>
                          <td className={r.failed ? 'bad' : ''}>{r.failed}</td><td>{r.skipped}</td><td className={r.queued ? 'warn' : ''}>{r.queued}</td>
                        </tr>
                      ))}
                      <tr className="tot"><td>All forms</td><td>{score.total.received}</td><td className="ok">{score.total.distributed}</td><td>{score.total.duplicate}</td><td className={score.total.failed ? 'bad' : ''}>{score.total.failed}</td><td>{score.total.skipped}</td><td className={score.total.queued ? 'warn' : ''}>{score.total.queued}</td></tr>
                    </tbody>
                  </table>
                  <p className="fbl-note">Distributed = became a CRM lead and was handed out. Queued = waiting for the backlog drip (one every 5 minutes). Counts cover the latest 1000 leads.</p>
                </div>
              )}
              {events.length === 0 ? <div className="fbl-empty"><Mi>inbox</Mi>Nothing received yet. Leads from your forms will be listed here with what happened to each.</div> : (
                <ul className="fbl-log">
                  {events.slice(0, shown).map((e) => (
                    <li key={e.leadgen_id}>
                      <span className={`fbl-tag ${EVENT_TONE[e.status] || 'mut'}`}>{e.status}</span>
                      <span className="fbl-log-main"><b>{forms.find((f) => f.form_id === e.form_id)?.label || `Form ${e.form_id || '—'}`}</b><small>{e.error || e.leadgen_id}</small>
                        {(e.agent_name || e.forward_tag || e.customer_msg || e.capi) && (
                          <span className="fbl-chips">
                            {e.agent_name && <span className="fbl-tag mut">{e.forward_tag ? `${e.forward_tag} → ` : ''}{e.agent_name}</span>}
                            {MSG_CHIP[e.customer_msg] && <span className={`fbl-tag ${MSG_CHIP[e.customer_msg][1]}`}>{MSG_CHIP[e.customer_msg][0]}</span>}
                            {CAPI_CHIP[e.capi] && <span className={`fbl-tag ${CAPI_CHIP[e.capi][1]}`}>{CAPI_CHIP[e.capi][0]}</span>}
                          </span>
                        )}
                      </span>
                      <span className="fbl-log-when">{ago(e.received_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {events.length > shown && (
                <div className="fbl-actions" style={{ marginTop: 12 }}>
                  <button className="fbl-btn ghost" onClick={() => setShown((n) => n + 20)}><Mi>expand_more</Mi>Show more ({events.length - shown} more)</button>
                </div>
              )}
            </section>
          )}
          </div>
        </>
      )}
    </div>
  );
}
