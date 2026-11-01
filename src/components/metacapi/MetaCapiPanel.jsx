import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Mi from '../Mi.jsx';
import Pagination from '../Pagination.jsx';
import Loader from '../ui/loader.jsx';
import useCountUp from '../../hooks/useCountUp.js';
import useMediaQuery from '../../hooks/useMediaQuery.js';
import { Menu, MenuItem, MenuLabel, MenuRadio, MenuRadioGroup, MenuSep } from '../ui/menu.jsx';
import { CAPI_TABS, STATUS_HINT, OUTCOME_LABEL, RESULT_LABEL, CAPI_PAGE as PAGE, fmtTime, blockedWhy } from '../../lib/metaCapi.js';
import { RANGES, DEFAULT_RANGE, rangeKeyToPeriod, fetchPeriodSummary, buildReportData, renderPdf, reportMeta, reportRows, reportFileName } from '../../lib/metaCapiReport.js';
import '../aitrainer/aitrainer.css'; // .ait-* and the .bc-switch toggle
import './metacapi.css';

// Admin › Meta CAPI: whether each Meta ad lead was reported to Meta, every
// send attempt with Meta's own answer, and a confirmed, server-checked send.
// Every figure comes from the meta-capi function; the browser computes none.
// Nothing is sent on load: a send needs a selection, a preview and a confirm.
// Only leads an agent marked Connected or Interested can be ticked; the server
// checks that again, with the shared rate limiter, right before each send.
//
// Built from the CRM's own parts: the Users toolbar (search, then Filter / Sort
// / Export menus), the Prospects selection bar, the shared Pagination and the
// Inventory loader. The Prospects Refresh button sits in the page header
// (App.jsx), fed through pageRefresh.
const ZONES = [['Asia/Dhaka', 'Dhaka time'], ['UTC', 'UTC']];
const SORTS = [['created_desc', 'Newest first'], ['created_asc', 'Oldest first'], ['cutoff_asc', 'Cutoff soonest'], ['last_attempt_desc', 'Last attempt']];
const NO_FILTER = { search: '', from: '', to: '', sort: 'created_desc' };
// A range pick keeps the Export menu open, so the action comes next.
const keepOpen = (e) => e.preventDefault();

function Num({ n }) {
  const ref = useCountUp(n);
  return <span ref={ref} data-n={n}>0</span>;
}

function Stat({ label, n, hint }) {
  return (
    <div className="mcx-stat" title={hint}>
      <div className="mcx-stat-n">{typeof n === 'number' ? <Num n={n} /> : n}</div>
      <div className="mcx-stat-l">{label}</div>
    </div>
  );
}

function Badge({ status }) {
  const cls = status === 'success' ? 'pass' : status === 'failed' ? 'fail' : status === 'pending' ? 'inc' : '';
  return <span className={`ait-badge ${cls}`} title={STATUS_HINT[status]}>{CAPI_TABS.find(([k]) => k === status)?.[1] ?? status}</span>;
}

// A modal over the page (portalled to <body>, so no card can trap it). Escape
// and the backdrop close it; focus moves in on open and back out on close.
function Dialog({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, [onClose]);
  return createPortal(
    <div className="mov on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mcx-dlg-ttl" tabIndex={-1} ref={ref} style={{ maxWidth: wide ? 720 : 460 }}>
        <div className="m-hd">
          <div className="m-ttl" id="mcx-dlg-ttl">{title}</div>
          <button type="button" className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button>
        </div>
        <div className="m-body mcx-hist">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function History({ api, lead, tz, canAct, paused, manualSendOn, onClose, onSent, showToast }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [pre, setPre] = useState(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api('history', { id: lead.id }).then((d) => { if (live) { setRows(d.attempts); setErr(null); } }, (e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [api, lead.id, n]);
  const t = (iso) => fmtTime(iso, tz);
  const eligible = canAct && !paused && manualSendOn && lead.qualified !== false && (lead.status === 'pending' || lead.status === 'failed');
  // One lead, same path as a batch: server preview first, then an explicit send.
  const ask = async () => { setBusy(true); try { setPre(await api('retry', { lead_ids: [lead.id] })); } catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); } };
  const send = async () => {
    setBusy(true);
    try { const r = await api('retry', { lead_ids: [lead.id], confirm: true, resend_unsure: !!pre?.preview.unsure }); setPre(null); setN((x) => x + 1); onSent(); showToast(RESULT_LABEL[r.results[0]?.result] ?? 'Done', r.results[0]?.result === 'accepted' ? undefined : 'err'); }
    catch (e) { showToast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Dialog title={lead.name ? `${lead.name}: Meta history` : 'Meta history'} onClose={onClose} wide>
      <dl className="mcx-kv">
        <dt>Lead</dt><dd>{lead.name || '-'} <code className="mcx-id">{lead.id}</code></dd>
        <dt>Status</dt><dd><Badge status={lead.status} />{blockedWhy(lead, true) && <span className="mcx-why"> · {blockedWhy(lead, true)}</span>}</dd>
        <dt>Created</dt><dd>{t(lead.created_at)}</dd>
        <dt>Meta cutoff (7 days)</dt><dd>{t(lead.cutoff_at)}</dd>
        <dt>Agent marked Connected or Interested</dt><dd>{lead.qualified ? t(lead.qualified_at) : 'No'}</dd>
        <dt>Click id (ctwa_clid)</dt><dd>{lead.has_clid ? 'Present' : 'Missing'}</dd>
        <dt>Accepted by Meta</dt><dd>{t(lead.accepted_at)}</dd>
      </dl>
      {eligible && !pre && <div><button type="button" className="btn btn-p btn-sm" disabled={busy} onClick={ask}><Mi>send</Mi>Retry this lead</button></div>}
      {pre && (
        <div className="mcx-confirm" style={{ margin: 0 }} role="alertdialog" aria-label="Confirm retry of this lead">
          <b>{pre.preview.eligible || pre.preview.unsure ? 'Send this event to Meta?' : 'This lead cannot be sent now.'}</b>
          <div className="ait-trace">Checked on the server just now: {pre.preview.eligible} eligible, {pre.preview.already_reported} already reported, {pre.preview.expired} past 7 days. It is checked again right before sending.</div>
          {pre.warnings.map((m) => <div key={m} className="ait-err">{m}</div>)}
          <div className="ea-row">
            <button type="button" className="btn btn-p btn-sm" disabled={busy || !(pre.preview.eligible || pre.preview.unsure)} onClick={send}>{busy ? 'Sending…' : pre.preview.unsure ? 'Resend 1 anyway' : 'Send 1'}</button>
            <button type="button" className="btn btn-g btn-sm" disabled={busy} onClick={() => setPre(null)}>Cancel</button>
          </div>
        </div>
      )}
      {lead.status === 'success' && !lead.attempts && <div className="ait-trace">Reported before this log existed: no attempt time was recorded.</div>}
      <div className="sec-t">Send attempts</div>
      {err && (
        <div className="empty fin-err" role="alert"><Mi>warning</Mi><p>{err}</p>
          <button type="button" className="btn btn-g btn-sm" onClick={() => setN((x) => x + 1)}><Mi>sync</Mi>Try again</button></div>
      )}
      {rows === null && !err && <div className="mcx-loading"><Loader size="sm" title="Loading history…" subtitle="Fetching this lead's send attempts" /></div>}
      {rows?.length === 0 && <div className="ait-trace">No send attempt recorded for this lead.</div>}
      {rows?.map((a) => (
        <div key={a.id ?? a.attempt_no} className="ait-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div><b>#{a.attempt_no}</b> <span className={`ait-badge ${a.outcome === 'accepted' ? 'pass' : 'fail'}`}>{OUTCOME_LABEL[a.outcome] ?? a.outcome}</span>
            <span className="meta"> · {a.source}{a.initiated_by ? ` · by ${a.initiated_by}` : ''}</span></div>
          <div className="ait-trace">Sent {t(a.attempted_at)} · answered {t(a.responded_at)}{a.accepted_at ? ` · accepted ${t(a.accepted_at)}` : ''}</div>
          <div className="ait-trace">
            HTTP {a.http_status ?? '-'} · events_received {a.events_received ?? '-'} · fbtrace_id {a.fbtrace_id ?? '-'}
            {a.error_code != null ? ` · code ${a.error_code}${a.error_subcode != null ? `/${a.error_subcode}` : ''}` : ''}{a.error_type ? ` · ${a.error_type}` : ''}
          </div>
          {a.error_message && <div className="ait-err">{a.error_message}</div>}
          {a.meta_response && <details><summary className="ait-trace">Meta response</summary><pre className="mcx-pre">{JSON.stringify(a.meta_response, null, 2)}</pre></details>}
        </div>
      ))}
    </Dialog>
  );
}

// The existing bots' switch for the event they send when they create a lead.
function BotSwitches({ api, canAct, showToast, initial }) {
  const [bots, setBots] = useState(initial);
  const [busy, setBusy] = useState(null);
  // A new page load replaces the list; a switch flip updates it in place.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) { setSeen(initial); setBots(initial); }
  const flip = async (b) => {
    setBusy(b.bot);
    try { setBots((await api('bot.set', { bot: b.bot, enabled: !b.meta_capi_enabled })).bots); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(null); }
  };
  if (!bots?.length) return null;
  return (
    <div className="mcx-bots" aria-label="Bots">
      {bots.map((b) => (
        <div key={b.bot} className="mcx-bot">
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

// The report lives only in this tab: counts, a jsPDF Blob and its object URL.
// Nothing is uploaded or stored; whoever holds the URL revokes it.
async function makeReport(api, range) {
  const now = Date.now();
  const counts = await fetchPeriodSummary(api, rangeKeyToPeriod(range, now));
  const data = buildReportData({ range, counts, generatedAtMs: now });
  return { data, blob: new Blob([renderPdf(data)], { type: 'application/pdf' }) };
}
const savePdf = ({ data, url }) => Object.assign(document.createElement('a'), { href: url, download: reportFileName(data) }).click();
// Touch devices print from their own PDF viewer: a hidden frame prints the page behind it there.
const coarse = () => window.matchMedia('(pointer: coarse)').matches;

// Preview, then Download PDF or Print: all three show the one generated PDF.
function ReportPreview({ rep, onClose }) {
  const { data, url } = rep;
  const frame = useRef(null);
  const print = useCallback(() => {
    if (coarse()) { window.open(url, '_blank', 'noopener'); return; }
    if (frame.current) { if (frame.current.dataset.ready) frame.current.contentWindow.print(); return; }
    const f = Object.assign(document.createElement('iframe'), { src: url, title: 'Report PDF', className: 'mcx-print-frame', tabIndex: -1 });
    f.setAttribute('aria-hidden', 'true');
    f.onload = () => { f.dataset.ready = '1'; try { f.contentWindow.print(); } catch { window.open(url, '_blank', 'noopener'); } };
    document.body.appendChild(f);
    frame.current = f;
  }, [url]);
  // Print chosen from the menu prints as the preview opens (not on touch, where a popup needs a tap).
  // The frame is removed on close; a StrictMode remount finds it gone and makes a new one.
  useEffect(() => {
    if (rep.print && !coarse()) print();
    return () => { frame.current?.remove(); frame.current = null; };
  }, [rep.print, print]);
  return (
    <Dialog title="Report preview" onClose={onClose}>
      <div className="mcx-rep">
        <div className="mcx-rep-brand">{data.brand}</div>
        <dl className="mcx-kv">{reportMeta(data).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        <table className="mcx-rep-t">
          <thead><tr><th scope="col">Metric</th><th scope="col">Count</th></tr></thead>
          <tbody>{reportRows(data.counts).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="ea-row">
        <button type="button" className="btn btn-p btn-sm" onClick={() => savePdf(rep)}><Mi>download</Mi>Download PDF</button>
        <button type="button" className="btn btn-g btn-sm" onClick={print}><Mi>print</Mi>Print</button>
      </div>
    </Dialog>
  );
}

// `onDelete(ids)` deletes leads through the CRM's own path; it is passed only
// to accounts that may delete (Management, Master), so no one else sees it.
// `refreshRef` receives this panel's refresh, for the page header's button.
export default function MetaCapiPanel({ api, showToast, onDelete, refreshRef, onBusy }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState(NO_FILTER);
  const [page, setPage] = useState(0);
  // Everything the page shows, set in one go: config, summary, bots and the list.
  const [view, setView] = useState(null);
  // The request whose answer is on screen; loading = it differs from the newest one asked.
  const [shownKey, setShownKey] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [delAsk, setDelAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(null);
  const [tz, setTz] = useState('Asia/Dhaka');
  const [nonce, setNonce] = useState(0);
  const [resend, setResend] = useState(false);
  const [reportRange, setReportRange] = useState(DEFAULT_RANGE);
  const [reportBusy, setReportBusy] = useState(false);
  // The report on screen ({ data, url, print }); its URL is revoked when it is replaced, closed or unmounted.
  const [rep, setRep] = useState(null);
  useEffect(() => () => { if (rep) URL.revokeObjectURL(rep.url); }, [rep]);
  const closeRep = useCallback(() => setRep(null), []);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const narrow = useMediaQuery('(max-width: 767px)'); // ds-allow-hardcode: the app's phone breakpoint, no token (index.css)

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => { if (refreshRef) refreshRef.current = refresh; }, [refreshRef, refresh]);
  const askKey = JSON.stringify([tab, q, page, nonce]);
  // The first load and every Refresh fetch the whole set and show it at once,
  // so counts and rows never come from two different moments. A filter or page
  // change refetches the list only. Only the newest request may land.
  const whole = useRef(null);
  useEffect(() => {
    let live = true;
    const full = whole.current !== nonce;
    const list = () => api('list', { status: tab, search: q.search, from: q.from || null, to: q.to ? `${q.to}T23:59:59Z` : null, sort: q.sort, limit: PAGE, offset: page * PAGE });
    const t = setTimeout(() => {
      const ask = full
        ? Promise.all([api('config'), api('summary'), api('bots').catch(() => ({ bots: [] })), list()])
          .then(([cfg, sum, b, data]) => ({ cfg, sum, bots: b.bots, data }))
        : list().then((data) => ({ data }));
      ask.then((v) => { if (live) { if (full) whole.current = nonce; setView((o) => ({ ...o, ...v })); setErr(null); } },
        (e) => { if (live) setErr(e.message); })
        .finally(() => { if (live) setShownKey(askKey); });
    }, full ? 0 : 200);
    return () => { live = false; clearTimeout(t); };
  }, [api, tab, q, page, nonce, askKey]);
  const loading = shownKey !== askKey;
  const { cfg = null, sum = null, data = null, bots = null } = view || {};
  // The header's Refresh button spins while the list loads.
  useEffect(() => { onBusy?.(loading); }, [onBusy, loading]);

  // Refresh policy: stamp the time of the last completed full fetch, refresh on
  // tab/window focus, and poll quietly while the tab is visible. Overlapping or
  // stale responses are impossible: every fetch is tagged with the nonce it was
  // asked for, and only the newest request lands (shownKey). The 60s poll only
  // bumps the nonce when the tab is visible and a fetch is not already running.
  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    const shown = shownKey === askKey && !loading && whole.current === nonce;
    if (shown) setLastUpdated(new Date());
  }, [shownKey, askKey, loading, nonce]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' || loading) return; // refresh() here would be stale; guarded by shownKey anyway
      refresh();
    };
    const onFocus = () => { if (!loading) refresh(); };
    const id = setInterval(tick, 60000);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [loading, refresh]);

  // Every export opens the preview of the one PDF it made; Download saves that PDF, Print prints it.
  const exportAs = async (action) => {
    setReportBusy(true);
    try {
      const { data, blob } = await makeReport(api, reportRange);
      if (!alive.current) return; // left the page while it was generating: no URL is made
      const r = { data, url: URL.createObjectURL(blob), print: action === 'print' };
      if (action === 'download') savePdf(r);
      setRep(r);
    } catch (e) { showToast(e?.message || 'Could not generate the report', 'err'); }
    finally { if (alive.current) setReportBusy(false); }
  };

  const by = sum?.by_status || {};
  const rate = sum && sum.attempts ? `${Math.round((sum.accepted_attempts / sum.attempts) * 100)}%` : '-';
  // Sending is a privileged action: off until the server allows it (CR-001 D1).
  const canAct = cfg?.actions_enabled === true;
  // World switches (manual send, recovery pause, bot on/off) edit one global row
  // shared by every company, so they are Master-only.
  const canManage = cfg?.can_manage === true;
  const rows = useMemo(() => data?.rows || [], [data]);
  // A row is sendable from here when it is pending or failed, an agent
  // qualified it, it had no unclear earlier answer, and the server allows sends.
  const sendable = useMemo(() => new Set(canAct ? rows.filter((r) => !blockedWhy(r, true)).map((r) => r.id) : []), [rows, canAct]);
  // With delete, any row can be ticked (to delete it); without, only sendable ones.
  const tickable = useMemo(() => (onDelete ? new Set(rows.map((r) => r.id)) : sendable), [rows, sendable, onDelete]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Select-all covers the tickable rows on this page only.
  const allOn = tickable.size > 0 && [...tickable].every((id) => sel.has(id));
  const someOn = !allOn && [...tickable].some((id) => sel.has(id));
  const toggleAll = () => setSel((s) => { const n = new Set(s); for (const id of tickable) { if (allOn) n.delete(id); else n.add(id); } return n; });
  const toSendIds = [...sel].filter((id) => sendable.has(id));
  // A new view of the list drops the old selection; nothing is ever sent or deleted by it.
  const reset = () => { setPage(0); setSel(new Set()); setPreview(null); setDelAsk(null); };
  const changeTab = (k) => { setTab(k); reset(); };
  const setFilter = (patch) => { setQ((v) => ({ ...v, ...patch })); reset(); };
  const goPage = (p) => { setPage(p); setSel(new Set()); setPreview(null); setDelAsk(null); };

  const ask = async () => {
    setBusy(true); setResults(null); setDelAsk(null);
    try { setPreview(await api('retry', { lead_ids: toSendIds })); setResend(false); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await api('retry', { lead_ids: toSendIds, confirm: true, resend_unsure: resend });
      setResults(r.results); setPreview(null); refresh();
      // Rate-limited leads stay ticked, ready for the next attempt.
      setSel(new Set(r.results.filter((x) => x.result === 'rate_limited').map((x) => x.id)));
      const n = r.results.filter((x) => x.result === 'accepted').length;
      showToast(`${n} of ${r.results.length} accepted by Meta`, n === r.results.length ? undefined : 'err');
    } catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    const ids = delAsk.map((r) => r.id);
    setBusy(true);
    try {
      await onDelete(ids);
      setDelAsk(null); setSel(new Set()); refresh();
      showToast(`${ids.length} lead${ids.length === 1 ? '' : 's'} deleted`, 'ok');
    } catch (e) { showToast(e?.message || 'Could not delete', 'err'); }
    finally { setBusy(false); }
  };
  const toSend = preview ? preview.preview.eligible + (resend ? preview.preview.unsure : 0) : 0;
  const pause = async (v) => {
    setBusy(true);
    try { const c = await api('settings.set', { ui_recovery_paused: v }); setView((o) => ({ ...o, cfg: c })); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const setManualSend = async (v) => {
    setBusy(true);
    try { const c = await api('settings.set', { manual_send_enabled: v }); setView((o) => ({ ...o, cfg: c })); }
    catch (e) { showToast(e.message, 'err'); }
    finally { setBusy(false); }
  };
  const filtered = q.search || q.from || q.to || tab !== 'all';
  const nFilters = (tab !== 'all') + !!(q.from || q.to);

  // First load: the CRM loader in the space the page will take, nothing else.
  if (!view) {
    return (
      <div className="mcx mcx-boot" aria-busy="true">
        {err ? (
          <div className="empty fin-err" role="alert"><Mi>warning</Mi><p>{err}</p>
            <button type="button" className="btn btn-g btn-sm" onClick={refresh}><Mi>sync</Mi>Try again</button></div>
        ) : <Loader className="fin-loader" title="Loading Meta CAPI…" subtitle="Fetching ad leads, counts and bot settings" />}
      </div>
    );
  }

  return (
    <div className={`mcx${loading ? ' mcx-busy' : ''}`} aria-busy={loading}>
      <section className="analytics-card mcx-head">
        <div className="mcx-meta">
          <div className="ait-trace">
            Dataset {cfg?.dataset_id ?? '…'} · token {cfg ? (cfg.token.configured ? 'configured' : 'missing') : '…'} (kept on the server, never shown) · CRM recovery {cfg ? (cfg.ui_recovery_paused ? 'paused' : 'on') : '…'} · manual send {cfg ? (cfg.manual_send_enabled === false ? 'off' : 'on') : '…'}
          </div>
          {canManage && (
            <div className="mcx-switches">
              <button type="button" role="switch" aria-checked={cfg?.manual_send_enabled !== false} aria-label="Manual send to Meta"
                className={`bc-switch ${cfg?.manual_send_enabled !== false ? 'on' : ''}`} disabled={busy}
                onClick={() => setManualSend(!(cfg?.manual_send_enabled !== false))}>
                <span className="bc-knob" aria-hidden="true" />
                <span className="bc-switch-txt">{cfg?.manual_send_enabled !== false ? 'Manual send on' : 'Manual send off'}</span>
              </button>
              <button type="button" className="btn btn-g btn-sm" disabled={busy} onClick={() => pause(!cfg.ui_recovery_paused)}><Mi>{cfg.ui_recovery_paused ? 'play_arrow' : 'pause'}</Mi>{cfg.ui_recovery_paused ? 'Resume recovery' : 'Pause recovery'}</button>
            </div>
          )}
        </div>
        <div className="mcx-stats" aria-label="Meta CAPI summary">
          <Stat label="Total ad leads" n={sum?.total} />
          <Stat label="Success" n={sum ? by.success ?? 0 : null} hint={STATUS_HINT.success} />
          <Stat label="Failed" n={sum ? by.failed ?? 0 : null} hint={STATUS_HINT.failed} />
          <Stat label="Pending" n={sum ? by.pending ?? 0 : null} hint={STATUS_HINT.pending} />
          <Stat label="Expired" n={sum ? by.expired ?? 0 : null} hint={STATUS_HINT.expired} />
          <Stat label="Ineligible" n={sum ? by.ineligible ?? 0 : null} hint={STATUS_HINT.ineligible} />
          <Stat label="Attempts" n={sum?.attempts} />
          <Stat label="Attempt success rate" n={sum ? rate : null} />
        </div>
        <div className="ait-trace">
          Last accepted by Meta: {sum ? fmtTime(sum.last_accepted_at, tz) : '…'}
          {' · '}Oldest still to report: {sum?.oldest_pending ? <>cutoff {fmtTime(sum.oldest_pending.cutoff_at, tz)}</> : (sum ? 'none' : '…')}
          {lastUpdated ? ` · Updated ${fmtTime(lastUpdated.toISOString(), tz)}` : ''}
        </div>
        <BotSwitches api={api} canAct={canManage} showToast={showToast} initial={bots} />
        {cfg && !canAct && (
          <div className="mcx-note" role="note"><Mi>lock</Mi>
            <span>View only. Sending to Meta, the bot switches and pausing need a verified sign-in, which the CRM does not have yet (CR-001 decision D1).</span>
          </div>
        )}
      </section>

      <section className="analytics-card mcx-list">
        {/* The Users toolbar: search, then Filter / Sort / Export (AccountsView). */}
        <div className="uct-bar mcx-bar">
          <div className="acc-search uct-search"><Mi>search</Mi>
            <input type="search" placeholder={narrow ? 'Search' : 'Search lead id or name'} aria-label="Search leads" value={q.search} onChange={(e) => setFilter({ search: e.target.value })} />
          </div>
          <div className="uct-bar-r">
            <Menu label="Filter leads" className="uct-menu" trigger={
              <button type="button" className={`uct-btn${nFilters ? ' on' : ''}`}><Mi>filter_list</Mi><span className="mcx-lbl">Filter</span>{nFilters > 0 && <span className="uct-n">{nFilters}</span>}</button>
            }>
              <MenuLabel>Status</MenuLabel>
              <MenuRadioGroup value={tab} onChange={changeTab}>
                {CAPI_TABS.map(([k, l]) => <MenuRadio key={k} value={k}>{k === 'all' ? 'All status' : `${l}${by[k] != null ? ` (${by[k]})` : ''}`}</MenuRadio>)}
              </MenuRadioGroup>
              <MenuSep />
              <MenuLabel>Created</MenuLabel>
              {/* Keys typed into a date stay in the field: the menu would read them as navigation or typeahead. */}
              <div className="mcx-dates" onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
                <label>From<input type="date" aria-label="Created from" value={q.from} max={q.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} /></label>
                <label>To<input type="date" aria-label="Created to" value={q.to} min={q.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} /></label>
              </div>
              {(q.from || q.to) && <MenuItem icon="close" onSelect={() => setFilter({ from: '', to: '' })}>Clear dates</MenuItem>}
              <MenuSep />
              <MenuLabel>Time zone</MenuLabel>
              <MenuRadioGroup value={tz} onChange={setTz}>{ZONES.map(([v, l]) => <MenuRadio key={v} value={v}>{l}</MenuRadio>)}</MenuRadioGroup>
            </Menu>
            <Menu label="Sort leads" trigger={
              <button type="button" className="uct-btn"><Mi>swap_vert</Mi><span className="mcx-lbl">Sort</span>{q.sort !== NO_FILTER.sort && <span className="uct-n">1</span>}<Mi className="uct-chev">expand_more</Mi></button>
            }>
              <MenuRadioGroup value={q.sort} onChange={(v) => setFilter({ sort: v })}>{SORTS.map(([v, l]) => <MenuRadio key={v} value={v}>{l}</MenuRadio>)}</MenuRadioGroup>
            </Menu>
            <Menu label="Export report" trigger={
              <button type="button" className="uct-btn" disabled={reportBusy}><Mi>{reportBusy ? 'hourglass_empty' : 'download'}</Mi><span className="mcx-lbl">Export</span><Mi className="uct-chev">expand_more</Mi></button>
            }>
              <MenuLabel>Report range</MenuLabel>
              <MenuRadioGroup value={reportRange} onChange={setReportRange}>{RANGES.map(([k, l]) => <MenuRadio key={k} value={k} onSelect={keepOpen}>{l}</MenuRadio>)}</MenuRadioGroup>
              <MenuSep />
              <MenuItem icon="visibility" onSelect={() => exportAs('preview')}>Preview</MenuItem>
              <MenuItem icon="picture_as_pdf" onSelect={() => exportAs('download')}>Download PDF</MenuItem>
              <MenuItem icon="print" onSelect={() => exportAs('print')}>Print</MenuItem>
            </Menu>
          </div>
        </div>

        <div className="bulk-bar" role="toolbar" aria-label="Selected leads">
          <span className="bulk-ct" aria-live="polite">{sel.size} selected</span>
          <button type="button" className="btn btn-p btn-sm" disabled={busy || !canAct || !toSendIds.length || cfg?.ui_recovery_paused || cfg?.manual_send_enabled === false} onClick={ask}
            title={!canAct ? 'Needs a verified sign-in' : cfg?.manual_send_enabled === false ? 'Manual sending is off' : undefined}><Mi>send</Mi>Send<span className="mcx-wide"> selected</span>{toSendIds.length && toSendIds.length !== sel.size ? ` (${toSendIds.length})` : ''}</button>
          {onDelete && (
            <button type="button" className="btn btn-sm" style={{ background: 'var(--red-l)', color: 'var(--red)' }} disabled={busy || !sel.size}
              onClick={() => { setPreview(null); setDelAsk(rows.filter((r) => sel.has(r.id))); }}><Mi>delete</Mi>Delete</button>
          )}
          <button type="button" className="btn btn-g btn-sm" disabled={busy || !sel.size} onClick={() => { setSel(new Set()); setPreview(null); setDelAsk(null); }}>Clear<span className="mcx-wide"> selection</span></button>
        </div>

        {delAsk && (
          <div className="mcx-confirm danger" role="alertdialog" aria-label="Confirm delete">
            <b>Delete {delAsk.length} lead{delAsk.length === 1 ? '' : 's'} from the CRM? This cannot be undone.</b>
            <ul className="mcx-results" style={{ margin: 0 }}>
              {delAsk.slice(0, 8).map((r) => <li key={r.id}>{r.name || '-'} <code className="mcx-id">{r.id}</code></li>)}
              {delAsk.length > 8 && <li>and {delAsk.length - 8} more</li>}
            </ul>
            <div className="ait-trace">The lead, its activity, notifications and bookings are removed, as when deleting from Prospects. Meta keeps any event already sent.</div>
            <div className="ea-row">
              <button type="button" className="btn btn-sm" style={{ background: 'var(--red)', color: 'var(--surf)' }} disabled={busy} onClick={doDelete}>{busy ? 'Deleting…' : `Delete ${delAsk.length}`}</button>
              <button type="button" className="btn btn-g btn-sm" disabled={busy} onClick={() => setDelAsk(null)}>Cancel</button>
            </div>
          </div>
        )}
        {preview && (
          <div className="mcx-confirm" role="alertdialog" aria-label="Confirm send">
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
              <button type="button" className="btn btn-p btn-sm" disabled={busy || !toSend} onClick={send}>{busy ? 'Sending…' : `Send ${toSend}`}</button>
              <button type="button" className="btn btn-g btn-sm" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        )}
        {results && (
          <ul className="mcx-results" aria-label="Send results">
            {results.map((r) => (
              <li key={r.id}><code className="mcx-id">{r.id}</code> {RESULT_LABEL[r.result] ?? r.result}
                {r.http_status != null ? ` · HTTP ${r.http_status}` : ''}{r.error_code != null ? ` · code ${r.error_code}` : ''}{r.fbtrace_id ? ` · ${r.fbtrace_id}` : ''}
                {r.retry_at ? ` · try again after ${fmtTime(r.retry_at, tz)}` : ''}</li>
            ))}
          </ul>
        )}

        <div className={`mcx-table-wrap${loading ? ' busy' : ''}`} aria-busy={loading}>
          {/* While a refresh or filter loads, the last answer stays put, dimmed, under the loader. */}
          {loading && <div className="mcx-veil"><Loader size="sm" title="Updating…" subtitle="" /></div>}
          {err && !data ? (
            <div className="empty fin-err" role="alert"><Mi>warning</Mi><p>{err}</p>
              <button type="button" className="btn btn-g btn-sm" onClick={refresh}><Mi>sync</Mi>Try again</button></div>
          ) : !rows.length ? (
            <div className="empty"><Mi>inbox</Mi>
              <p>{filtered ? 'No ad lead matches this tab, search or date range.' : 'No Meta ad leads yet.'}</p>
              {filtered && <button type="button" className="btn btn-g btn-sm" onClick={() => { setTab('all'); setQ(NO_FILTER); reset(); }}>Show all leads</button>}
            </div>
          ) : (
            <table className="mcx-table">
              <thead><tr>
                <th scope="col"><input type="checkbox" aria-label="Select all selectable leads on this page" checked={allOn} disabled={!tickable.size}
                  ref={(el) => { if (el) el.indeterminate = someOn; }} onChange={toggleAll} /></th>
                <th scope="col">Lead</th><th scope="col">Created</th><th scope="col">Status</th><th scope="col">Click id</th>
                <th scope="col">Last attempt</th><th scope="col">Attempts</th><th scope="col">Last answer</th><th scope="col">Cutoff</th>
                <th scope="col"><span className="sr-only">History</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const why = blockedWhy(r, canAct);
                  const can = tickable.has(r.id);
                  return (
                    <tr key={r.id} className={sel.has(r.id) ? 'mcx-row-sel' : undefined}>
                      <td><input type="checkbox" aria-label={`Select ${r.name || r.id}`} checked={sel.has(r.id)} disabled={!can}
                        title={!can ? why : undefined} onChange={() => toggle(r.id)} /></td>
                      <td><div>{r.name || '-'}</div><code className="mcx-id" title={r.id}>{r.id}</code></td>
                      <td>{fmtTime(r.created_at, tz)}</td>
                      <td><Badge status={r.status} />{why && why !== 'View only' && <div className="mcx-why">{why}</div>}</td>
                      <td>{r.has_clid ? 'Yes' : 'No'}</td>
                      <td>{fmtTime(r.last_attempt_at, tz)}</td>
                      <td>{r.attempts}</td>
                      <td>{r.latest_outcome ? `${OUTCOME_LABEL[r.latest_outcome] ?? r.latest_outcome}${r.latest_http ? ` · ${r.latest_http}` : ''}` : '-'}</td>
                      <td>{fmtTime(r.cutoff_at, tz)}</td>
                      <td><button type="button" className="mcx-hist-btn" onClick={() => setOpen(r)} aria-label={`Meta history of ${r.name || r.id}`} title="Meta history"><Mi>history</Mi></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {err && data && <div className="ait-err" role="alert" style={{ padding: '8px 16px' }}>{err}</div>}
        </div>
        {data && data.total > 0 && (data.total <= PAGE
          ? <div className="pg-wrap"><span className="pg-info">{data.total} lead{data.total === 1 ? '' : 's'}</span></div>
          : <Pagination page={page} total={data.total} pageSize={PAGE} onChange={goPage} />)}
      </section>
      {open && <History api={api} lead={open} tz={tz} canAct={canAct} paused={!!cfg?.ui_recovery_paused} manualSendOn={cfg?.manual_send_enabled !== false} onClose={() => setOpen(null)} onSent={refresh} showToast={showToast} />}
      {rep && <ReportPreview key={rep.url} rep={rep} onClose={closeRep} />}
    </div>
  );
}
