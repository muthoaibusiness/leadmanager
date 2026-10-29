import { useCallback, useEffect, useMemo, useState } from 'react';
import Mi from '../Mi.jsx';
import { Select as SelectRoot, SelectTrigger, SelectValue, SelectPopover, SelectListBox, SelectItem } from '../ui/select.jsx';
import { CAPI_TABS, STATUS_HINT, OUTCOME_LABEL, RESULT_LABEL, fmtTime, fmtBoth } from '../../lib/metaCapi.js';
import '../aitrainer/aitrainer.css'; // .ait-* and the .bc-switch toggle
import './metacapi.css';

// Admin › Meta CAPI: whether each Meta ad lead was reported to Meta, every
// send attempt with Meta's own answer, and a confirmed, server-checked send.
// Every figure comes from the meta-capi function; the browser computes none.
// Nothing is sent on load: a send needs a selection, a preview and a confirm.
// Only leads an agent marked Connected or Interested can be ticked; the server
// checks that again, with the shared rate limiter, right before each send.
const PAGE = 50;
const ZONES = [['Asia/Dhaka', 'Dhaka'], ['UTC', 'UTC']];

function Stat({ label, n, hint }) {
  return (
    <div className="mc-stat" title={hint}>
      <div className="mc-stat-n">{n ?? '…'}</div>
      <div className="mc-stat-l">{label}</div>
    </div>
  );
}

// Why a row cannot be ticked, in the row itself.
const blockedWhy = (r) => (r.status === 'ineligible' ? (r.has_clid ? 'No agent action' : 'No click id') : '');

function Badge({ status }) {
  const cls = status === 'success' ? 'pass' : status === 'failed' ? 'fail' : status === 'pending' ? 'inc' : '';
  return <span className={`ait-badge ${cls}`} title={STATUS_HINT[status]}>{CAPI_TABS.find(([k]) => k === status)?.[1] ?? status}</span>;
}

function History({ api, lead, canAct, paused, onClose, onSent, showToast }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [pre, setPre] = useState(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => { api('history', { id: lead.id }).then((d) => setRows(d.attempts), (e) => setErr(e.message)); }, [api, lead.id, n]);
  const eligible = canAct && !paused && lead.qualified !== false && (lead.status === 'pending' || lead.status === 'failed');
  // One lead, same path as a batch: server preview first, then an explicit send.
  const ask = async () => { setBusy(true); try { setPre(await api('retry', { lead_ids: [lead.id] })); } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); } };
  const send = async () => {
    setBusy(true);
    try { const r = await api('retry', { lead_ids: [lead.id], confirm: true, resend_unsure: !!pre?.preview.unsure }); setPre(null); setN((x) => x + 1); onSent(); showToast(RESULT_LABEL[r.results[0]?.result] ?? 'Done', r.results[0]?.result === 'accepted' ? undefined : 'err'); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="mov on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mc-hist-ttl" style={{ maxWidth: 720 }}>
        <div className="m-hd">
          <div className="m-ttl" id="mc-hist-ttl">Lead {lead.id}</div>
          <button className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button>
        </div>
        <div className="m-body mc-hist">
          <dl className="mc-kv">
            <dt>Lead created</dt><dd>{fmtBoth(lead.created_at)}</dd>
            <dt>Meta cutoff (7 days)</dt><dd>{fmtBoth(lead.cutoff_at)}</dd>
            <dt>Status</dt><dd><Badge status={lead.status} /></dd>
            <dt>Event ID</dt><dd><code>{lead.event_id}</code></dd>
            <dt>Click id (ctwa_clid)</dt><dd>{lead.has_clid ? 'Present' : 'Missing'}</dd>
            <dt>Agent marked Connected or Interested</dt><dd>{lead.qualified ? fmtBoth(lead.qualified_at) : 'No'}</dd>
            <dt>Accepted by Meta</dt><dd>{fmtBoth(lead.accepted_at)}</dd>
          </dl>
          {eligible && !pre && <div><button className="btn btn-p btn-sm" disabled={busy} onClick={ask}><Mi>send</Mi>Retry this lead</button></div>}
          {pre && (
            <div className="mc-confirm" role="alertdialog" aria-label="Confirm retry of this lead">
              <b>{pre.preview.eligible || pre.preview.unsure ? 'Send this event to Meta?' : 'This lead cannot be sent now.'}</b>
              <div className="ait-trace">Checked on the server just now: {pre.preview.eligible} eligible, {pre.preview.already_reported} already reported, {pre.preview.expired} past 7 days. It is checked again right before sending.</div>
              {pre.warnings.map((m) => <div key={m} className="ait-err">{m}</div>)}
              <div className="ea-row">
                <button className="btn btn-p btn-sm" disabled={busy || !(pre.preview.eligible || pre.preview.unsure)} onClick={send}>{busy ? 'Sending…' : pre.preview.unsure ? 'Resend 1 anyway' : 'Send 1'}</button>
                <button className="btn btn-g btn-sm" disabled={busy} onClick={() => setPre(null)}>Cancel</button>
              </div>
            </div>
          )}
          {lead.status === 'success' && !lead.attempts && <div className="ait-trace">Reported before this log existed: no attempt time was recorded.</div>}
          {err && <div className="ait-err" role="alert">{err}</div>}
          {rows === null && !err && <div className="ea-count">Loading…</div>}
          {rows?.length === 0 && <div className="ea-count">No attempt recorded.</div>}
          {rows?.map((a) => (
            <div key={a.id ?? a.attempt_no} className="ait-row" style={{ flexDirection: 'column', gap: 4 }}>
              <div><b>#{a.attempt_no}</b> <span className={`ait-badge ${a.outcome === 'accepted' ? 'pass' : 'fail'}`}>{OUTCOME_LABEL[a.outcome] ?? a.outcome}</span>
                <span className="meta"> · {a.source}{a.initiated_by ? ` · by ${a.initiated_by}` : ''}</span></div>
              <div className="ait-trace">
                Sent {fmtBoth(a.attempted_at)} · answered {fmtBoth(a.responded_at)}{a.accepted_at ? ` · accepted ${fmtBoth(a.accepted_at)}` : ''}
              </div>
              <div className="ait-trace">
                HTTP {a.http_status ?? '-'} · events_received {a.events_received ?? '-'} · fbtrace_id {a.fbtrace_id ?? '-'}
                {a.error_code != null ? ` · code ${a.error_code}${a.error_subcode != null ? `/${a.error_subcode}` : ''}` : ''}{a.error_type ? ` · ${a.error_type}` : ''}
              </div>
              {a.error_message && <div className="ait-err">{a.error_message}</div>}
              {a.meta_response && <details><summary className="ait-trace">Meta response</summary><pre className="mc-pre">{JSON.stringify(a.meta_response, null, 2)}</pre></details>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The existing bots' switch for the event they send when they create a lead.
function BotSwitches({ api, canAct, showToast, nonce }) {
  const [bots, setBots] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { api('bots').then((d) => setBots(d.bots), (e) => showToast(e.message, 'err')); }, [api, nonce, showToast]);
  const flip = async (b) => {
    setBusy(b.bot);
    try { setBots((await api('bot.set', { bot: b.bot, enabled: !b.meta_capi_enabled })).bots); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(null); }
  };
  if (!bots) return null;
  return (
    <div className="mc-bots" aria-label="Bots">
      {bots.map((b) => (
        <div key={b.bot} className="mc-bot">
          <div className="bc-grow">
            <div className="bc-strong">{b.display_name}</div>
            <p className="bc-note">{b.meta_capi_enabled ? 'Reports each new ad lead to Meta when it creates the lead.' : 'Off: sends no LeadSubmitted when it creates a lead.'}</p>
          </div>
          <button type="button" role="switch" aria-checked={b.meta_capi_enabled} aria-label={`${b.display_name}: send lead event to Meta`}
            className={`bc-switch ${b.meta_capi_enabled ? 'on' : ''}`} disabled={!canAct || busy === b.bot} onClick={() => flip(b)}>
            <span className="bc-knob" aria-hidden="true" />
            <span className="bc-switch-txt">{b.meta_capi_enabled ? 'On' : 'Off'}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

export default function MetaCapiPanel({ api, showToast }) {
  const [cfg, setCfg] = useState(null);
  const [sum, setSum] = useState(null);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState({ search: '', from: '', to: '', sort: 'created_desc' });
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(null);
  const [tz, setTz] = useState('Asia/Dhaka');
  const [nonce, setNonce] = useState(0);
  const [resend, setResend] = useState(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => { api('config').then(setCfg, (e) => setErr(e.message)); }, [api, nonce]);
  useEffect(() => { api('summary').then(setSum, (e) => setErr(e.message)); }, [api, nonce]);
  useEffect(() => {
    const t = setTimeout(() => {
      api('list', { status: tab, search: q.search, from: q.from || null, to: q.to ? `${q.to}T23:59:59Z` : null, sort: q.sort, limit: PAGE, offset: page * PAGE })
        .then((d) => { setData(d); setErr(null); }, (e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [api, tab, q, page, nonce]);

  const by = sum?.by_status || {};
  const rate = sum && sum.attempts ? `${Math.round((sum.accepted_attempts / sum.attempts) * 100)}%` : '-';
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  // Sending is a privileged action: off until the server allows it (CR-001 D1).
  const canAct = cfg?.actions_enabled === true;
  const selectable = useMemo(() => new Set(canAct ? (data?.rows || []).filter((r) => r.qualified !== false && (r.status === 'pending' || r.status === 'failed')).map((r) => r.id) : []), [data, canAct]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Select-all covers the sendable rows on this page only.
  const allOn = selectable.size > 0 && [...selectable].every((id) => sel.has(id));
  const someOn = !allOn && [...selectable].some((id) => sel.has(id));
  const toggleAll = () => setSel((s) => { const n = new Set(s); for (const id of selectable) { if (allOn) n.delete(id); else n.add(id); } return n; });
  const changeTab = (k) => { setTab(k); setPage(0); setSel(new Set()); };

  const ask = async () => {
    setBusy(true); setResults(null);
    try { setPreview(await api('retry', { lead_ids: [...sel] })); setResend(false); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('retry', { lead_ids: [...sel], confirm: true, resend_unsure: resend });
      setResults(r.results); setPreview(null); refresh();
      // Rate-limited leads stay ticked, ready for the next attempt.
      setSel(new Set(r.results.filter((x) => x.result === 'rate_limited').map((x) => x.id)));
      const n = r.results.filter((x) => x.result === 'accepted').length;
      showToast(`${n} of ${r.results.length} accepted by Meta`, n === r.results.length ? undefined : 'err');
    } catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const toSend = preview ? preview.preview.eligible + (resend ? preview.preview.unsure : 0) : 0;
  const pause = async (v) => {
    setBusy(true);
    try { setCfg(await api('settings.set', { ui_recovery_paused: v })); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mc">
      <section className="analytics-card mc-head">
        <div className="mc-bar">
          <div>
            <b>Meta Conversions API</b>
            <div className="ait-trace" style={{ marginTop: 2 }}>
              Dataset {cfg?.dataset_id ?? '…'} · token: {cfg ? (cfg.token.configured ? 'Configured' : 'Missing') : '…'} (kept on the server, never shown) · CRM recovery: {cfg ? (cfg.ui_recovery_paused ? 'Paused' : 'On') : '…'}
            </div>
          </div>
          <div className="mc-actions">
            <SelectRoot value={tz} onChange={setTz}>
              <SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger>
              <SelectPopover><SelectListBox>
                {ZONES.map(([v, l]) => <SelectItem key={v} value={v}>{`Times: ${l}`}</SelectItem>)}
              </SelectListBox></SelectPopover>
            </SelectRoot>
            {canAct && <button className="btn btn-g btn-sm" disabled={busy} onClick={() => pause(!cfg.ui_recovery_paused)}><Mi>{cfg.ui_recovery_paused ? 'play_arrow' : 'pause'}</Mi>{cfg.ui_recovery_paused ? 'Resume recovery' : 'Pause recovery'}</button>}
            <button className="btn btn-g btn-sm" onClick={refresh}><Mi>refresh</Mi>Refresh</button>
          </div>
        </div>
        <div className="mc-stats" aria-label="Meta CAPI summary">
          <Stat label="Total ad leads" n={sum?.total} />
          <Stat label="Success" n={by.success ?? 0} hint={STATUS_HINT.success} />
          <Stat label="Failed" n={by.failed ?? 0} hint={STATUS_HINT.failed} />
          <Stat label="Pending" n={by.pending ?? 0} hint={STATUS_HINT.pending} />
          <Stat label="Expired" n={by.expired ?? 0} hint={STATUS_HINT.expired} />
          <Stat label="Ineligible" n={by.ineligible ?? 0} hint={STATUS_HINT.ineligible} />
          <Stat label="Attempts" n={sum?.attempts} />
          <Stat label="Attempt success rate" n={rate} />
        </div>
        <div className="ait-trace">
          Last accepted by Meta: {sum ? fmtTime(sum.last_accepted_at, tz) : '…'}
          {' · '}Oldest still to report: {sum?.oldest_pending ? <>{sum.oldest_pending.id}, cutoff {fmtTime(sum.oldest_pending.cutoff_at, tz)}</> : (sum ? 'none' : '…')}
        </div>
        <BotSwitches api={api} canAct={canAct} showToast={showToast} nonce={nonce} />
        {cfg && !canAct && (
          <div className="ait-trace" role="note">
            Viewing only. Sending to Meta, the bot switches and settings need a verified sign-in, which the CRM does not have yet (CR-001 decision D1).
          </div>
        )}
        {err && <div className="ait-err" role="alert">{err}</div>}
      </section>

      <section className="analytics-card mc-list">
        <div className="mc-tabs" role="tablist" aria-label="Lead status">
          {CAPI_TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`mc-tab${tab === k ? ' on' : ''}`} onClick={() => changeTab(k)} title={STATUS_HINT[k]}>
              {l}{k !== 'all' && by[k] != null ? <span className="mc-tab-n">{by[k]}</span> : null}
            </button>
          ))}
        </div>
        <div className="mc-filters">
          <input className="fi" type="search" placeholder="Search lead id or name" aria-label="Search leads" value={q.search} onChange={(e) => { setQ({ ...q, search: e.target.value }); setPage(0); }} />
          <label className="ait-trace">From <input className="fi" type="date" value={q.from} onChange={(e) => { setQ({ ...q, from: e.target.value }); setPage(0); }} /></label>
          <label className="ait-trace">To <input className="fi" type="date" value={q.to} onChange={(e) => { setQ({ ...q, to: e.target.value }); setPage(0); }} /></label>
          <SelectRoot value={q.sort} onChange={(v) => setQ({ ...q, sort: v })}>
            <SelectTrigger aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectPopover><SelectListBox>
              <SelectItem value="created_desc">Newest first</SelectItem><SelectItem value="created_asc">Oldest first</SelectItem>
              <SelectItem value="cutoff_asc">Cutoff soonest</SelectItem><SelectItem value="last_attempt_desc">Last attempt</SelectItem>
            </SelectListBox></SelectPopover>
          </SelectRoot>
        </div>
        <div className="mc-bulk" role="toolbar" aria-label="Selected leads">
          <span className="ait-trace" aria-live="polite">{sel.size} selected</span>
          <button className="btn btn-p btn-sm" disabled={busy || !canAct || !sel.size || cfg?.ui_recovery_paused} onClick={ask}><Mi>send</Mi>Send selected</button>
          <button className="btn btn-g btn-sm" disabled={busy || !sel.size} onClick={() => setSel(new Set())}>Clear selection</button>
        </div>

        {preview && (
          <div className="mc-confirm" role="alertdialog" aria-label="Confirm retry">
            <b>Send {toSend} event{toSend === 1 ? '' : 's'} to Meta?</b>
            <div className="ait-trace">
              {preview.preview.selected} selected · {preview.preview.eligible} eligible · {preview.preview.already_reported} already reported · {preview.preview.expired} past 7 days · {preview.preview.ineligible} not eligible{preview.preview.unsure ? ` · ${preview.preview.unsure} unclear earlier answer` : ''}.
              {' '}Each lead is checked again on the server just before it is sent, and every send passes the shared rate limit. A reported lead is never sent again.
            </div>
            {preview.warnings.map((m) => <div key={m} className="ait-err">{m}</div>)}
            {preview.preview.unsure > 0 && (
              <label className="ait-trace"><input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} /> Resend the {preview.preview.unsure} lead{preview.preview.unsure === 1 ? '' : 's'} with an unclear earlier answer anyway</label>
            )}
            <div className="ea-row">
              <button className="btn btn-p btn-sm" disabled={busy || !toSend} onClick={send}>{busy ? 'Sending…' : `Send ${toSend}`}</button>
              <button className="btn btn-g btn-sm" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        )}
        {results && (
          <ul className="mc-results" aria-label="Retry results">
            {results.map((r) => (
              <li key={r.id}><code>{r.id}</code> {RESULT_LABEL[r.result] ?? r.result}
                {r.http_status != null ? ` · HTTP ${r.http_status}` : ''}{r.error_code != null ? ` · code ${r.error_code}` : ''}{r.fbtrace_id ? ` · ${r.fbtrace_id}` : ''}
                {r.retry_at ? ` · try again after ${fmtTime(r.retry_at, tz)}` : ''}</li>
            ))}
          </ul>
        )}

        <div className="mc-table-wrap">
          <table className="mc-table">
            <thead><tr>
              <th scope="col">{selectable.size > 0
                ? <input type="checkbox" aria-label="Select all sendable leads on this page" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn; }} onChange={toggleAll} />
                : <span className="sr-only">Select</span>}</th><th scope="col">Lead</th><th scope="col">Name</th><th scope="col">Created</th>
              <th scope="col">Click id</th><th scope="col">Status</th><th scope="col">Last attempt</th><th scope="col">Attempts</th>
              <th scope="col">Last answer</th><th scope="col">Cutoff</th><th scope="col"><span className="sr-only">History</span></th>
            </tr></thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.id}>
                  <td>{selectable.has(r.id) && <input type="checkbox" aria-label={`Select ${r.id}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                  <td><code>{r.id}</code></td>
                  <td>{r.name || '-'}</td>
                  <td>{fmtTime(r.created_at, tz)}</td>
                  <td>{r.has_clid ? 'Yes' : 'No'}</td>
                  <td><Badge status={r.status} />{blockedWhy(r) && <span className="ait-trace"> · {blockedWhy(r)}</span>}</td>
                  <td>{fmtTime(r.last_attempt_at, tz)}</td>
                  <td>{r.attempts}</td>
                  <td>{r.latest_outcome ? `${OUTCOME_LABEL[r.latest_outcome] ?? r.latest_outcome}${r.latest_http ? ` · ${r.latest_http}` : ''}` : '-'}</td>
                  <td>{fmtTime(r.cutoff_at, tz)}</td>
                  <td><button className="btn btn-g btn-sm" onClick={() => setOpen(r)} aria-label={`History of ${r.id}`}><Mi>history</Mi></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.rows.length && <div className="ea-count">No leads here.</div>}
          {!data && !err && <div className="ea-count">Loading…</div>}
        </div>
        <div className="ea-row" style={{ justifyContent: 'space-between' }}>
          <span className="ait-trace">{data ? `${data.total} lead${data.total === 1 ? '' : 's'}` : ''}</span>
          <div className="ea-row">
            <button className="btn btn-g btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="ait-trace">Page {page + 1} of {pages}</span>
            <button className="btn btn-g btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      </section>
      {open && <History api={api} lead={open} canAct={canAct} paused={!!cfg?.ui_recovery_paused} onClose={() => setOpen(null)} onSent={refresh} showToast={showToast} />}
    </div>
  );
}
