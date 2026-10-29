// Visual check only: the real MetaCapiPanel over the real capi-core handler
// with in-memory fixtures. No network, no Supabase, no Meta.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import MetaCapiPanel from '../../src/components/metacapi/MetaCapiPanel.jsx';
import { handleCapi } from '../../supabase/functions/_shared/capi-core.ts';

const theme = new URLSearchParams(location.search).get('theme');
if (theme) document.documentElement.setAttribute('data-theme', theme);
const NOW = Date.now(), DAY = 864e5;
const names = ['Rahim Uddin', 'Karim Ahmed', 'Salma Begum', 'Nusrat Jahan', 'Tanvir Hasan', 'Farhana Akter', 'Imran Hossain', 'Sadia Islam', 'Arif Khan', 'Mitu Rahman'];
const leads = names.map((n, i) => ({ id: `lead-${1000 + i}`, name: n, company_id: 'c1', source: 'WHATSAPP_ADS', ctwa_clid: i === 9 ? null : `clid${i}`,
  CAPI_STATUS: i < 3 ? 'LeadSubmitted' : null, qualified: i !== 7, created_at: new Date(NOW - (i < 3 ? 20 : i === 8 ? 9 : i) * DAY).toISOString() }));
const attempts = [
  { lead_id: 'lead-1003', attempt_no: 1, source: 'bot', outcome: 'rejected', http_status: 400, events_received: 0, error_code: 190, error_subcode: 464, error_type: 'OAuthException',
    error_message: 'Error validating access token: Sessions for the user are not allowed because the user is not a confirmed user.', fbtrace_id: 'ANLIMLRbF0v6CrtXnxqzM1m', attempted_at: new Date(NOW - 2 * DAY).toISOString(), responded_at: new Date(NOW - 2 * DAY).toISOString(), accepted_at: null },
  { lead_id: 'lead-1001', attempt_no: 1, source: 'ui_retry', initiated_by: 'admin', outcome: 'accepted', http_status: 200, events_received: 1, fbtrace_id: 'AVyTyOUex4IgQ7dcOyOzM27',
    attempted_at: new Date(NOW - 3600e3).toISOString(), responded_at: new Date(NOW - 3600e3).toISOString(), accepted_at: new Date(NOW - 3600e3).toISOString(), meta_response: { events_received: 1, messages: [], fbtrace_id: 'AVyTyOUex4IgQ7dcOyOzM27' } },
];
const st = (l) => { const a = attempts.filter((x) => x.lead_id === l.id); return l.CAPI_STATUS === 'LeadSubmitted' || a.some((x) => x.outcome === 'accepted') ? 'success' : !l.ctwa_clid || !l.qualified ? 'ineligible' : Date.parse(l.created_at) + 7 * DAY <= NOW ? 'expired' : a.length ? 'failed' : 'pending'; };
const row = (l) => { const a = attempts.filter((x) => x.lead_id === l.id); const last = a.at(-1);
  return { ...l, has_clid: !!l.ctwa_clid, status: st(l), unsure: false, attempts: a.length, cutoff_at: new Date(Date.parse(l.created_at) + 7 * DAY).toISOString(), event_id: l.id,
    first_attempt_at: a[0]?.attempted_at ?? null, last_attempt_at: last?.attempted_at ?? null, accepted_at: a.find((x) => x.outcome === 'accepted')?.accepted_at ?? null,
    latest_outcome: last?.outcome ?? null, latest_http: last?.http_status ?? null }; };
const bots = [{ bot: 'eyad', display_name: 'Eyad Bot', meta_capi_enabled: true }, { bot: 'dubai', display_name: 'Dubai Bot', meta_capi_enabled: false }];
const deps = {
  now: () => NOW, token: () => 'configured-but-hidden',
  async user() { return { id: 'admin', role: 'MANAGEMENT', is_active: true, company_id: 'c1', allowed_features: null }; },
  async lead(id) { const l = leads.find((x) => x.id === id); return l ? { ...l, capi_status_column: l.CAPI_STATUS, unsure: false } : null; },
  async page(q) { let rs = leads.map(row); if (q.status !== 'all') rs = rs.filter((r) => r.status === q.status); return { rows: rs.slice(q.offset, q.offset + q.limit), total: rs.length }; },
  async summary() { const by = {}; for (const l of leads) by[st(l)] = (by[st(l)] || 0) + 1;
    const p = leads.filter((l) => ['pending', 'failed'].includes(st(l))).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return { total: leads.length, by_status: by, attempts: attempts.length, accepted_attempts: attempts.filter((a) => a.outcome === 'accepted').length,
      last_accepted_at: attempts.find((a) => a.outcome === 'accepted')?.accepted_at ?? null, oldest_pending: p ? { id: p.id, created_at: p.created_at, cutoff_at: new Date(Date.parse(p.created_at) + 7 * DAY).toISOString() } : null }; },
  async history(id) { return attempts.filter((a) => a.lead_id === id); },
  async acquire() { return { result: 'ok' }; }, async unlock() {}, async throttle() { return new Date(NOW + 60e3).toISOString(); },
  async bots() { return bots; }, async setBot(bot, on) { const b = bots.find((x) => x.bot === bot); b.meta_capi_enabled = on; return b; },
  allowUnverifiedActor: () => true, async record(a) { attempts.push({ ...a, attempt_no: 1, attempted_at: new Date().toISOString() }); return { attempt_no: 1 }; },
  async settings() { return { ui_recovery_paused: false }; }, async saveSettings() {},
  async postMeta() { return { status: 200, json: { events_received: 1, fbtrace_id: 'harness' } }; },
};
const api = async (action, payload = {}) => {
  const r = await handleCapi(new Request('https://h/x', { method: 'POST', body: JSON.stringify({ action, payload, userId: 'admin' }) }), deps);
  const j = await r.json(); if (!j.ok) throw new Error(j.error.message); return j.data;
};
createRoot(document.getElementById('root')).render(React.createElement(MetaCapiPanel, { api, showToast: () => {} }));
