import { useState, useRef, useDeferredValue } from 'react';
import Mi from '../Mi.jsx';
import { getDB, getProperties } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import {
  CATEGORIES, OTHERS, categoryOf, categoryValue, PAY_METHODS, EXPENSE_KIND, readAsBase64, statementTotal, statementDoc, renderStatement,
  docMoney, fmtMoney, staleLines, TEMPLATE_LIST, templateOf, templateForCategory, CURRENCIES, periodEnd, adSetExtra, docDate, time12,
  newReferenceId, newTransactionId, newInvoiceNo,
} from '../../lib/finance.js';
import useDiscardGuard from '../../hooks/useDiscardGuard.js';
import { usePageOverlay } from '../../hooks/useNavHistory.js';
import DocPreview from './DocPreview.jsx';

// The finance forms, each a modal on the app's .mov/.modal shell. Every save
// goes to the Edge Function through `onSave`, which resolves on success and
// throws the server's message on failure; the form shows that message inline.

// `guard` (from useDiscardGuard) makes ✕, an outside click and Esc ask before
// typed input is dropped; without it they close at once. `actions` (the
// statement editor) puts the form's buttons in the header, top right, in place
// of ✕ and the footer; an outside click, Esc and Back still close.
export function Modal({ title, wide, xwide, onClose, children, footer, actions, guard }) {
  const backdrop = guard ? guard.backdropProps : { onClick: e => { if (e.target === e.currentTarget) onClose(); } };
  return (
    <div className="mov on" {...backdrop}>
      <div className={`modal fin-modal${wide ? ' wide' : ''}${xwide ? ' xwide' : ''}`} role="dialog" aria-modal="true" aria-label={title} {...(guard ? guard.modalProps : {})}>
        <div className="m-hd"><div className="m-ttl">{title}</div>
          {actions ? <div className="m-hd-a">{actions}</div> : <button type="button" className="m-x" onClick={guard ? guard.requestClose : onClose} aria-label="Close"><Mi>close</Mi></button>}</div>
        <div className="m-body">{children}</div>
        {footer && <div className="m-ft">{footer}</div>}
      </div>
    </div>
  );
}

// A list's select-all checkbox and a row checkbox (clicks don't open the row).
export function SelectAll({ sel, label }) {
  return <th className="fin-chk"><input type="checkbox" aria-label={label} checked={sel.allOn} ref={el => { if (el) el.indeterminate = sel.someOn; }} onChange={sel.toggleAll} /></th>;
}
export function SelectRow({ sel, id, label }) {
  return <td className="fin-chk" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={label} checked={sel.has(id)} onChange={() => sel.toggle(id)} /></td>;
}
// Shown above a list while rows are selected, with the one bulk action the
// list allows (archive budgets, delete draft statements).
export function BulkBar({ sel, noun, onAction, busy, actionLabel, actionIcon }) {
  if (!sel.selected.length) return null;
  const n = sel.selected.length;
  return (
    <div className="fin-bulk" role="region" aria-label="Selection">
      <span><b>{n}</b> {noun}{n === 1 ? '' : 's'} selected</span>
      <span className="sp" />
      <button type="button" className="btn btn-g btn-sm fin-ibtn" onClick={sel.clear} title="Clear selection" aria-label="Clear selection"><Mi>delete_sweep</Mi></button>
      <button type="button" className="btn btn-g btn-sm" onClick={onAction} disabled={busy}><Mi>{actionIcon}</Mi>{actionLabel}</button>
    </div>
  );
}

// Runs `fn`, keeps the busy flag and the error message for the form.
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(e.message || 'Something went wrong'); } finally { setBusy(false); } };
  return { busy, err, run };
}
const Err = ({ msg }) => (msg ? <div className="fin-warn full" style={{ marginBottom: 12 }}><Mi>warning</Mi>{msg}</div> : null);

const today = () => new Date().toISOString().slice(0, 10);

// ── category (statements and expenses) ──
// The picker's { key, name } and whether it was touched. An untouched field
// saves the stored text exactly as it was, so older values ("Salaries & fees")
// and custom names survive an edit of anything else.
function useCategory(stored) {
  const [orig] = useState(() => String(stored ?? ''));
  const [c, setC] = useState(() => ({ key: categoryOf(orig).key, name: categoryOf(orig).name, touched: false }));
  const set = (patch) => setC(x => ({ ...x, ...patch, touched: true }));
  return { key: c.key, name: c.name, set, value: c.touched ? categoryValue(c.key, c.name) : orig };
}

// Category, then either the custom name (Others) or a spacer beside it. With
// `beside` (the statement editor puts Currency there), that field takes the
// second column and the custom name gets a row of its own when needed.
// `required` (statements) marks it * and offers no "Uncategorised"; `error`
// shows under it.
// `locked` (a saved statement): shown, never changed.
function CategoryField({ cat, beside, required, error, ref, locked }) {
  const custom = <input className="fi" value={cat.name} onChange={e => cat.set({ name: e.target.value })} placeholder="e.g. Google Ads" aria-label="Custom category" readOnly={locked} />;
  return (
    <>
      <div className="fg"><div className="fin-pick-hd"><label>Category{required && <span className="fin-req" aria-hidden="true"> *</span>}</label>
        {locked && <span className="fin-idlock" title="Set when the statement was first saved; it can't be changed"><Mi>lock</Mi>Locked</span>}</div>
        <select ref={ref} className={`fsel${error ? ' fin-invalid' : ''}${locked ? ' fin-locked' : ''}`} value={cat.key} onChange={e => cat.set({ key: e.target.value })} disabled={locked} aria-label="Category" aria-required={required || undefined} aria-invalid={error ? true : undefined}>
          <option value="" disabled={required}>{required ? 'Select a category' : 'Uncategorised'}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          <option value={OTHERS}>{OTHERS}</option>
        </select>
        {error && <div className="fin-help fin-field-err" role="alert">{error}</div>}
      </div>
      {beside
        ? <>{beside}{cat.key === OTHERS && <div className="fg full"><label>Custom category</label>{custom}</div>}</>
        : cat.key === OTHERS
          ? <div className="fg"><label>Custom category</label>{custom}</div>
          : <div className="fg fin-fg-gap" aria-hidden="true" />}
    </>
  );
}

// ── budget ──
// The amount is the budget's spending limit (budget approval is off). When
// editing, `initial.draftAmount` is the limit in force, which for a budget
// approved before then is its approved amount. A budget can span several
// projects.
export function BudgetForm({ initial, onSave, onClose }) {
  const projects = getProperties();
  const teams = getDB().teams || [];
  // A null team on a stored budget becomes '' (a <select> value can't be null).
  const [f, setF] = useState(() => ({ title: '', purpose: '', notes: '', draftAmount: '', ...(initial || {}), teamId: initial?.teamId || '' }));
  // Budgets saved before 0024 carry only property_id; read that as a one-project list.
  const [picked, setPicked] = useState(() => new Set(initial?.projects?.length ? initial.projects.map(p => p.id) : initial?.propertyId ? [initial.propertyId] : []));
  const { busy, err, run } = useSubmit();
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const toggleProject = (id) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const submit = () => run(async () => {
    const t = teams.find(x => x.id === f.teamId);
    const chosen = projects.filter(p => picked.has(p.id)).map(p => ({ id: p.id, name: p.name }));
    await onSave({ ...f, draftAmount: Number(f.draftAmount || 0), projects: chosen, teamName: t?.name || '' });
    onClose();
  });
  return (
    <Modal title={initial?.id ? 'Edit budget' : 'New budget'} onClose={onClose} footer={<>
      <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-p" onClick={submit} disabled={busy}><Mi>check</Mi>{initial?.id ? 'Save' : 'Create budget'}</button>
    </>}>
      <Err msg={err} />
      <div className="fin-form">
        <div className="fg full"><label>Title</label><input className="fi" value={f.title} onChange={set('title')} placeholder="e.g. Q4 marketing" autoFocus /></div>
        <div className="fg"><label>Budget amount (BDT)</label><input className="fi" type="number" min="1" step="1" value={f.draftAmount} onChange={set('draftAmount')} placeholder="0" /><div className="fin-help">The spending limit. Committed and paid expenses count against it. Must be above zero.</div></div>
        <div className="fg"><label>Purpose</label><input className="fi" value={f.purpose} onChange={set('purpose')} placeholder="What it pays for" /></div>
        <div className="fg full"><label>Projects {picked.size > 0 && <span className="fin-sub" style={{ display: 'inline' }}>· {picked.size} selected</span>}</label>
          {projects.length === 0 ? <div className="fin-help">No projects yet.</div> : (
            <div className="fin-pick">{projects.map(p => (
              <label key={p.id}><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggleProject(p.id)} /><span>{p.name}</span></label>
            ))}</div>
          )}
        </div>
        <div className="fg"><label>Responsible team</label><select className="fsel" value={f.teamId} onChange={set('teamId')}><option value="">No team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="fg full"><label>Notes</label><textarea className="fi" rows={3} value={f.notes} onChange={set('notes')} /></div>
      </div>
    </Modal>
  );
}

// ── attachments (shared by expenses and comments) ──
export function FilePicker({ files, setFiles, upload, max = 10 }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (e) => {
    const list = [...(e.target.files || [])]; e.target.value = '';
    if (!list.length) return;
    setErr(''); setBusy(true);
    try {
      for (const file of list.slice(0, max - files.length)) {
        const data = await readAsBase64(file);
        const { file: saved } = await upload({ name: file.name, mime: file.type, data });
        setFiles(fs => [...fs, saved]);
      }
    } catch (x) { setErr(x.message || 'Upload failed'); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="fin-files">
        {files.map((f, i) => <span key={i} className="fin-file"><Mi>attach_file</Mi><span>{f.name}</span><button type="button" className="x" style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'inline-flex' }} onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Mi>close</Mi></button></span>)}
        <button type="button" className="fin-file" onClick={() => ref.current?.click()} disabled={busy || files.length >= max}><Mi>{busy ? 'sync' : 'upload_file'}</Mi><span>{busy ? 'Uploading…' : 'Attach receipt'}</span></button>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden onChange={pick} />
      </div>
      {err && <div className="fin-help" style={{ color: 'var(--red)' }}>{err}</div>}
    </div>
  );
}

// ── expense ──
export function ExpenseForm({ budget, initial, onSave, onClose, upload }) {
  const db = getDB();
  const members = db.users.filter(u => u.isActive !== false && u.role !== 'MASTER');
  const projects = getProperties();
  const [f, setF] = useState(() => ({ amount: '', spentOn: today(), description: '', paymentMethod: PAY_METHODS[1], kind: 'PAID', spentBy: '', propertyId: budget.propertyId || '', ...(initial || {}) }));
  const cat = useCategory(initial?.category);
  const [files, setFiles] = useState(initial?.attachments || []);
  const { busy, err, run } = useSubmit();
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const submit = () => run(async () => {
    const m = members.find(u => u.id === f.spentBy), p = projects.find(x => x.id === f.propertyId);
    await onSave({ ...f, category: cat.value, amount: Number(f.amount || 0), spentByName: m?.name || '', propertyName: p?.name || '', attachments: files });
    onClose();
  });
  return (
    <Modal title={initial?.id ? 'Edit expense' : `Record expense · ${budget.title}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-p" onClick={submit} disabled={busy}><Mi>check</Mi>{initial?.id ? 'Save' : 'Record'}</button>
    </>}>
      <Err msg={err} />
      <div className="fin-form">
        <div className="fg"><label>Amount (BDT)</label><input className="fi" type="number" min="0" step="1" value={f.amount} onChange={set('amount')} autoFocus /></div>
        <div className="fg"><label>Date</label><input className="fi" type="date" value={f.spentOn} onChange={set('spentOn')} /></div>
        <div className="fg full"><label>Kind</label>
          <div className="fin-kinds">{Object.entries(EXPENSE_KIND).map(([k, l]) => <button key={k} type="button" className={f.kind === k ? 'on' : ''} onClick={() => setF(x => ({ ...x, kind: k }))}>{l}{k === 'COMMITTED' ? ' · ordered, not yet paid' : ' · actual'}</button>)}</div>
          <div className="fin-help">A committed expense becomes paid by editing it, so it is never counted twice.</div>
        </div>
        <CategoryField cat={cat} />
        <div className="fg"><label>Payment method</label><select className="fsel" value={f.paymentMethod} onChange={set('paymentMethod')}>{PAY_METHODS.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="fg full"><label>Description</label><input className="fi" value={f.description} onChange={set('description')} placeholder="What was bought" /></div>
        <div className="fg"><label>Responsible team member</label><select className="fsel" value={f.spentBy || ''} onChange={set('spentBy')}><option value="">—</option>{members.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="fg"><label>Project</label><select className="fsel" value={f.propertyId || ''} onChange={set('propertyId')}><option value="">—</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="fg full"><label>Receipts</label><FilePicker files={files} setFiles={setFiles} upload={upload} /></div>
      </div>
    </Modal>
  );
}

// ── ad spend lines (Meta): campaign cards, each with its ad sets ──
// Lines stay flat (one per ad set); extra.cid ties an ad set to its campaign
// card and extra.campaign carries the name the statement groups by.
const newCid = () => 'c' + Math.random().toString(36).slice(2, 9);
function AdCampaigns({ lines, setLines, cpm, currency, billing, estimate, setAdAmount, setAdImpressions }) {
  const groups = [];
  lines.forEach((l, i) => {
    const cid = l.extra?.cid || '';
    let g = groups.find(x => x.cid === cid);
    if (!g) groups.push(g = { cid, name: l.extra?.campaign || '', rows: [] });
    g.rows.push(i);
  });
  const blank = (cid, campaign) => estimate({ expenseId: null, description: '', qty: 1, unitPrice: 0, extra: { cid, campaign, impressions: '' } }, cpm);
  const rename = (cid, campaign) => setLines(ls => ls.map(l => ((l.extra?.cid || '') === cid ? { ...l, extra: { ...l.extra, campaign } } : l)));
  const addSet = (cid, campaign) => setLines(ls => { const at = ls.map(l => l.extra?.cid || '').lastIndexOf(cid); const out = [...ls]; out.splice(at + 1, 0, blank(cid, campaign)); return out; });
  const total = statementTotal(lines);
  const unallocated = Math.round((Number(billing || 0) - total) * 100) / 100;
  return (
    <div className="fin-camps">
      <div className="fin-camps-hd">
        <div><b>Campaign breakdown</b><span>Add each campaign and its ad sets from the Meta receipt.</span></div>
        <button type="button" className="btn btn-g btn-sm" onClick={() => setLines(ls => [...ls, blank(newCid(), '')])}><Mi>add</Mi>Add Campaign</button>
      </div>
      {groups.length === 0 && <div className="fin-help">No campaigns yet.</div>}
      {groups.map(g => (
        <div key={g.cid || 'none'} className="fin-camp">
          <div className="fin-camp-hd">
            <input className="fi" value={g.name} placeholder="Campaign name" aria-label="Campaign name" onChange={e => rename(g.cid, e.target.value)} />
            <button type="button" className="x" onClick={() => setLines(ls => ls.filter(l => (l.extra?.cid || '') !== g.cid))} aria-label="Remove campaign"><Mi>close</Mi></button>
          </div>
          <div className="fin-line-hd ad"><span>Ad set</span><span>Impressions</span><span>Amount ({currency})</span><span /></div>
          {g.rows.map(i => { const l = lines[i]; return (
            <div key={i} className="fin-line ad">
              <input className="fi" value={l.description} aria-label="Ad set" placeholder="Ad set name" onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <input className="fi" type="number" min="0" step="1" value={l.extra?.impressions ?? ''} placeholder={Number(cpm) > 0 ? '' : 'Set CPM'} aria-label="Impressions" title={l.extra?.est ? '1,000 × Amount ÷ CPM. Type the exact number from Meta to replace it.' : 'Typed, from Meta'} style={l.extra?.est ? { fontStyle: 'italic' } : undefined} onChange={e => setAdImpressions(i, e.target.value)} />
              <input className="fi" type="number" min="0" step="0.01" value={l.unitPrice} aria-label="Amount" onChange={e => setAdAmount(i, Number(e.target.value))} />
              <button type="button" className="x" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove ad set"><Mi>close</Mi></button>
            </div>); })}
          <button type="button" className="fin-addset" onClick={() => addSet(g.cid, g.name)}><Mi>add</Mi>Add Ad Set</button>
        </div>
      ))}
      <div className="fin-help">Enter each ad set's Amount; Impressions = 1,000 × Amount ÷ CPM fills in (italic here, marked (est.) on the statement). Type the exact number from Meta to replace one; clear it to go back to the formula.</div>
      <div className="fin-sumline"><span>Total</span><span>{fmtMoney(total, currency)}</span></div>
      {Number(billing) > 0 && <div className={`fin-sumline${unallocated ? ' fin-unalloc' : ''}`}><span>Unallocated amount</span><span>{fmtMoney(unallocated, currency)}</span></div>}
    </div>
  );
}

// ── Meta statement: IDs and payment time ──
// The date and time now in Bangladesh, as YYYY-MM-DD and HH:MM (24-hour).
const dhakaNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
// Random IDs shaped like Meta's (finance-doc.js). They are WEPRO's own and
// print as internal references (layout.*Gen, see INTERNAL_NOTE there).
const NEW_ID = { vendorRef: newTransactionId, paymentRef: newReferenceId, invoiceNo: newInvoiceNo };

// A time stored as HH:MM (24-hour), picked on a 12-hour clock. "--" for the
// hour clears it.
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
function Time12({ value, onChange, label }) {
  const m = /^(\d{2}):(\d{2})$/.exec(value || '');
  const h24 = m ? +m[1] : null;
  const h = h24 == null ? '' : String(h24 % 12 || 12), min = m ? m[2] : '', ap = h24 != null && h24 >= 12 ? 'PM' : 'AM';
  const put = (hh, mm, a) => onChange(hh === '' ? '' : `${String((+hh % 12) + (a === 'PM' ? 12 : 0)).padStart(2, '0')}:${mm || '00'}`);
  return (
    <div className="fin-time12" role="group" aria-label={label}>
      <select className="fsel" value={h} onChange={e => put(e.target.value, min, ap)} aria-label="Hour"><option value="">--</option>{HOURS.map(x => <option key={x}>{x}</option>)}</select>
      <select className="fsel" value={min} onChange={e => put(h || '12', e.target.value, ap)} aria-label="Minute"><option value="" disabled>--</option>{MINUTES.map(x => <option key={x}>{x}</option>)}</select>
      <select className="fsel" value={ap} onChange={e => put(h || '12', min, e.target.value)} aria-label="AM or PM"><option>AM</option><option>PM</option></select>
    </div>
  );
}

// One of the statement's IDs. Typed or pasted = copied from the vendor's
// receipt; generated = a WEPRO internal reference. A typed ID is never
// replaced by a click: clear it first to generate one. `locked`: issued on the
// statement's first save; shown, never changed. Without `onGenerate` it can
// only be copied from the receipt.
function RefField({ label, value, gen, locked, onType, onGenerate }) {
  return (
    <div className="fg">
      <div className="fin-pick-hd"><label>{label}{value && <span className="fin-idsrc">{gen ? 'WEPRO internal' : 'From receipt'}</span>}</label>
        {locked ? <span className="fin-idlock" title="Issued on the first save; it can't be changed"><Mi>lock</Mi>Locked</span>
          : onGenerate && (!value || gen) && <button type="button" className="fin-linkbtn" onClick={onGenerate}>{value ? 'New ID' : 'Generate'}</button>}
      </div>
      <input className="fi" value={value} onChange={e => onType(e.target.value)} placeholder={locked ? 'Issued when saved' : 'From the Meta receipt'} spellCheck={false} aria-label={label} readOnly={locked} />
    </div>
  );
}

// ── the bar between the editor and its preview ──
// Drag it to resize the two (the form gets 30–70%), double-click or Enter for
// the default, ← → Home End when focused. The split is remembered per browser.
const SPLIT_KEY = 'propcrm_fin_split', SPLIT_DEF = 0.5;
const clampSplit = (v) => Math.min(0.7, Math.max(0.3, v));
const readSplit = () => { try { const v = parseFloat(localStorage.getItem(SPLIT_KEY)); return v >= 0.3 && v <= 0.7 ? v : SPLIT_DEF; } catch { return SPLIT_DEF; } };
const storeSplit = (v) => { try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* storage blocked: the default next time */ } };
function SplitDivider({ grid, value, onChange, onDragging }) {
  const drag = useRef(null); // the pointer being dragged
  const at = (clientX) => { const r = grid.current.getBoundingClientRect(); return clampSplit((clientX - r.left) / r.width); };
  const end = (e, commit) => { if (drag.current !== e.pointerId) return; drag.current = null; onDragging(false); if (commit) onChange(at(e.clientX), true); };
  const keys = { ArrowLeft: () => clampSplit(value - 0.02), ArrowRight: () => clampSplit(value + 0.02), Home: () => 0.3, End: () => 0.7, Enter: () => SPLIT_DEF };
  return (
    <div className="fin-divider" role="separator" aria-orientation="vertical" aria-label="Resize editor and preview" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(value * 100)} tabIndex={0}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = e.pointerId; onDragging(true); }}
      onPointerMove={e => { if (drag.current === e.pointerId) onChange(at(e.clientX), false); }}
      onPointerUp={e => end(e, true)} onPointerCancel={e => end(e, false)}
      onDoubleClick={() => onChange(SPLIT_DEF, true)}
      onKeyDown={e => { const k = keys[e.key]; if (k) { e.preventDefault(); onChange(k(), true); } }}>
      <span aria-hidden="true" />
    </div>
  );
}

// ── statement (invoice) editor ──
// The form beside a live preview. The preview is drawn by the same renderer as
// the saved statement and its share link, so it shows exactly what will print.
// The category picks the layout: Meta or Supabase lays the statement out like
// that vendor's receipt (finance-doc.js TEMPLATES) and shows the vendor's
// fields; switching only fills fields that are still empty or at a template's
// default, so typed input is never replaced. Unsaved input is guarded: ✕,
// Cancel, an outside click, Esc and the browser's Back all ask first.
// A new Meta statement gets generated IDs (internal, see NEW_ID) and today's
// Bangladesh date and time as its payment date and time; both stay as saved
// when the draft is reopened.
const LAYOUT_KEYS = ['template', 'currency', 'accent', 'showQty', 'footer', 'vendorRef', 'paidOn', 'periodFrom', 'periodTo', 'paidTime', 'accountId', 'paymentMethod', 'paymentRef', 'productType', 'cpm', 'billingAmount', 'periodToTime', 'vendorRefGen', 'paymentRefGen', 'invoiceNo', 'invoiceNoGen'];
const DEFAULT_TITLES = new Set(['', 'Expense statement', ...TEMPLATE_LIST.map(t => t.defaults?.title).filter(Boolean)]);
const VENDOR_NAMES = new Set(TEMPLATE_LIST.map(t => t.vendor?.name).filter(Boolean));

export function StatementForm({ budget, expenses, initial, initialLines, onSave, onClose, takenExpenseIds, preparedBy }) {
  const [start] = useState(() => {
    const f = {
      title: 'Expense statement', issuedOn: today(), fromName: '', billTo: '', notes: '', accent: '#1F6FEB', showQty: true, footer: '',
      template: 'default', currency: 'BDT', vendorRef: '', paidOn: '', periodFrom: '', periodTo: '', paidTime: '', accountId: '', paymentMethod: '',
      paymentRef: '', productType: '', cpm: '', billingAmount: '', periodToTime: '', vendorRefGen: false, paymentRefGen: false, invoiceNo: '', invoiceNoGen: false, ...(initial || {}),
    };
    // Ad sets saved before campaign cards existed get a card key from their campaign name.
    const lines = (initialLines || []).map(l => ({ expenseId: l.expenseId || null, description: l.description, qty: l.qty, unitPrice: l.unitPrice,
      extra: { ...(l.extra || {}), ...(l.extra?.campaign != null && !l.extra?.cid ? { cid: 'n:' + l.extra.campaign } : {}) } }));
    return { f, lines };
  });
  const [f, setF] = useState(start.f);
  const [lines, setLines] = useState(start.lines);
  const cat = useCategory(initial?.category);
  const [catErr, setCatErr] = useState('');
  const catRef = useRef(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState({ adv: false, time: false }); // the Meta editor's Advanced and Time sections
  const [pane, setPane] = useState('edit'); // narrow screens show one side at a time
  const [split, setSplit] = useState(readSplit); // the form's share of the width
  const [dragging, setDragging] = useState(false);
  const grid = useRef(null);
  const resize = (v, commit) => { setSplit(v); if (commit) storeSplit(v); };
  const { busy, err, run } = useSubmit();
  const pickFields = (x) => Object.fromEntries(['title', 'issuedOn', 'fromName', 'billTo', 'notes', ...LAYOUT_KEYS].map(k => [k, x[k]]));
  const [baseline] = useState(() => JSON.stringify([pickFields(start.f), start.lines, String(initial?.category ?? '')]));
  const isDirty = () => JSON.stringify([pickFields(f), lines, cat.value]) !== baseline;
  const guard = useDiscardGuard({ isOpen: true, isDirty, onClose, busy, ask: { title: 'Discard changes to this statement?', description: 'What you changed here is not saved yet.' } });
  usePageOverlay(true, guard.requestClose);

  const tpl = templateOf(f.template);
  const isReceipt = tpl.layout !== 'standard'; // a vendor layout (receipt, adSpend)
  const isAd = tpl.columns === 'impressions';
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  // An ad line (Meta) is one unit at its amount. Its impressions are
  // 1,000 × amount ÷ CPM (marked est) until someone types the exact figure from
  // the vendor; adSetExtra is the same rule the finance function applies on save.
  const estimate = (l, cpm) => ({ ...l, extra: adSetExtra(l.extra, Number(l.qty ?? 1) * Number(l.unitPrice || 0), cpm) });
  const setAdAmount = (i, unitPrice) => setLines(ls => ls.map((l, j) => (j === i ? estimate({ ...l, qty: 1, unitPrice }, f.cpm) : l)));
  const setAdImpressions = (i, v) => setLines(ls => ls.map((l, j) => (j === i
    ? (v === '' ? estimate({ ...l, extra: { ...l.extra, impressions: '', est: undefined } }, f.cpm) : { ...l, extra: { ...l.extra, impressions: v, est: false } })
    : l)));
  const setCpm = (cpm) => { setF(x => ({ ...x, cpm })); setLines(ls => ls.map(l => estimate(l, cpm))); };
  // vendorRef (Transaction ID) / paymentRef (Reference ID): typing marks the ID
  // as copied from the receipt, Generate as WEPRO's own. Once the statement has
  // been saved as Meta, the finance function has issued them (layout.issuedIds):
  // those are locked, here and on the server.
  const issued = initial?.issuedIds || {};
  const typeRef = (k) => (v) => { if (!issued[k]) setF(x => ({ ...x, [k]: v, [k + 'Gen']: false })); };
  const genRef = (k) => { if (issued[k]) return; const v = NEW_ID[k](); setF(x => ({ ...x, [k]: v, [k + 'Gen']: true })); };
  const setNow = () => { const now = dhakaNow(); setF(x => ({ ...x, paidOn: now.date, paidTime: now.time })); };

  // The template for a category: Meta / Supabase get the vendor layout, the
  // rest WEPRO's own statement.
  const applyTemplate = (id) => {
    if (id === f.template) return;
    const t = templateOf(id), d = t.defaults || {};
    const ad = t.columns === 'impressions', cpm = f.cpm || d.cpm || '';
    const now = dhakaNow(), ids = { vendorRef: NEW_ID.vendorRef(), paymentRef: NEW_ID.paymentRef(), invoiceNo: NEW_ID.invoiceNo() };
    setF(x => {
      const from = x.periodFrom || x.issuedOn;
      // Meta: issued IDs come back, empty ones are generated, an empty payment
      // date / time is now in Bangladesh. Any other template drops issued IDs
      // and IDs still as generated (they are Meta-shaped); IDs from a receipt stay.
      const refs = Object.fromEntries(['vendorRef', 'paymentRef', 'invoiceNo'].flatMap(k => (ad
        ? (issued[k] ? [[k, issued[k]], [k + 'Gen', !!issued[k + 'Gen']]] : x[k] ? [] : [[k, ids[k]], [k + 'Gen', true]])
        : (x[k + 'Gen'] || (issued[k] && x[k] === issued[k]) ? [[k, ''], [k + 'Gen', false]] : []))));
      return {
        ...x, template: t.id, currency: t.currency, accent: t.accent || '#1F6FEB',
        title: DEFAULT_TITLES.has(x.title.trim()) ? d.title || 'Expense statement' : x.title,
        fromName: t.vendor?.name || (VENDOR_NAMES.has(x.fromName) ? '' : x.fromName),
        billTo: x.billTo.trim() ? x.billTo : d.billTo || '',
        paymentMethod: x.paymentMethod || d.paymentMethod || '', productType: x.productType || d.productType || '', cpm: x.cpm || d.cpm || '',
        ...(d.months && !x.periodTo ? { periodFrom: from, periodTo: periodEnd(from, d.months) } : {}),
        ...refs,
        ...(ad ? { paidOn: x.paidOn || now.date, paidTime: x.paidTime || now.time } : {}),
      };
    });
    if (d.lines && !lines.length) setLines(d.lines.map(l => (ad ? estimate({ expenseId: null, ...l, extra: { ...l.extra, cid: newCid() } }, cpm) : { expenseId: null, ...l })));
    // An ad template shows one amount per line, so fold qty × price into it.
    else if (ad) setLines(ls => ls.map(l => estimate({ ...l, unitPrice: Number(l.qty || 0) * Number(l.unitPrice || 0), qty: 1, extra: l.extra || {} }, cpm)));
  };
  // The category is locked once the statement is saved with one (the finance
  // function refuses a change too); a new statement picks it freely.
  const catLocked = !!initial?.id && !!String(initial?.category ?? '').trim();
  const category = { ...cat, set: (patch) => { if (catLocked) return; cat.set(patch); setCatErr(''); applyTemplate(templateForCategory(categoryValue(patch.key ?? cat.key, patch.name ?? cat.name))); } };

  const picked = new Set(lines.map(l => l.expenseId).filter(Boolean));
  const toggle = (e) => setLines(ls => {
    if (picked.has(e.id)) return ls.filter(l => l.expenseId !== e.id);
    const line = { expenseId: e.id, description: `${e.description || categoryOf(e.category).label || 'Expense'} · ${e.spentOn}`, qty: 1, unitPrice: Number(e.amount) };
    return [...ls, isAd ? estimate({ ...line, extra: { cid: newCid(), campaign: '' } }, f.cpm) : line];
  });
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  // The picker starts at the statement's category; "Show all" lists the rest
  // of the budget's expenses. Picked expenses always stay listed. (The server
  // checks only that every linked expense is on this budget.)
  const want = categoryOf(cat.value);
  const inCategory = (e) => {
    if (!want.key) return true;
    const c = categoryOf(e.category);
    return c.key === want.key && (want.key !== OTHERS || !want.name || c.name.toLowerCase() === want.name.toLowerCase());
  };
  const listed = showAll ? expenses : expenses.filter(e => inCategory(e) || picked.has(e.id));
  const more = expenses.length - listed.length;
  const exById = new Map(expenses.map(e => [e.id, e]));
  const stale = new Map(staleLines(lines, expenses, f.currency).map(s => [s.index, s]));
  const layout = Object.fromEntries(LAYOUT_KEYS.map(k => [k, f[k]]));

  // Category is required (the finance function refuses a statement without one).
  const submit = () => {
    if (!cat.value.trim()) { setCatErr('Pick a category for this statement.'); setPane('edit'); catRef.current?.focus(); return; }
    save();
  };
  const save = () => run(async () => {
    await onSave({ title: f.title, issuedOn: f.issuedOn, category: cat.value, fromName: f.fromName, billTo: f.billTo, notes: f.notes, layout, lines });
    onClose();
  });
  const html = useDeferredValue(renderStatement(statementDoc({
    invoice: { title: f.title, number: initial?.number, issuedOn: f.issuedOn, category: cat.value, fromName: f.fromName, billTo: f.billTo, notes: f.notes, createdByName: initial?.createdByName || preparedBy, layout },
    lines, budget, expenses,
  })));
  return (
    <Modal xwide guard={guard} title={initial?.id ? `Edit ${initial.number}` : `New statement · ${budget.title}`} onClose={onClose} actions={<>
      <button type="button" className="btn btn-g btn-sm" onClick={guard.requestClose}>Cancel</button>
      <button type="button" className="btn btn-p btn-sm" onClick={submit} disabled={busy}><Mi>check</Mi>Save draft</button>
    </>}>
      <div ref={grid} className={`fin-split on-${pane}${dragging ? ' dragging' : ''}`} style={{ '--fin-l': `${Math.round(split * 100)}fr`, '--fin-r': `${100 - Math.round(split * 100)}fr` }}>
        <div className="fin-panes" role="tablist" aria-label="Editor view">
          <button type="button" role="tab" aria-selected={pane === 'edit'} className={pane === 'edit' ? 'on' : ''} onClick={() => setPane('edit')}><Mi>edit</Mi>Edit</button>
          <button type="button" role="tab" aria-selected={pane === 'preview'} className={pane === 'preview' ? 'on' : ''} onClick={() => setPane('preview')}><Mi>visibility</Mi>Preview</button>
        </div>
        <div className="fin-split-form">
          <Err msg={err} />
          <div className="fin-form">
            <CategoryField cat={category} required error={catErr} ref={catRef} locked={catLocked} beside={<div className="fg"><label>Currency</label><select className="fsel" value={f.currency} onChange={set('currency')} aria-label="Currency">{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>} />
            {isReceipt && <div className="fg full fin-help fin-tpl-note"><Mi>receipt</Mi>Laid out like a {tpl.name} receipt, headed STATEMENT, with a footer saying WEPRO prepared it from the {tpl.name} receipt. Attach the original receipt to the expense.</div>}
            <div className="fg"><label>Title</label><input className="fi" value={f.title} onChange={set('title')} /></div>
            <div className="fg"><label>{isReceipt ? 'Receipt date' : 'Date'}</label><input className="fi" type="date" value={f.issuedOn} onChange={set('issuedOn')} /></div>
            {isReceipt && !isAd && <>
              <div className="fg"><label>{tpl.refLabel || 'Vendor reference'}</label><input className="fi" value={f.vendorRef} onChange={e => typeRef('vendorRef')(e.target.value)} placeholder="As printed on the vendor receipt" /></div>
              <div className="fg"><label>Payment date</label><input className="fi" type="date" value={f.paidOn} onChange={set('paidOn')} /></div>
            </>}
            {isAd && <>
              <div className="fg"><label>Client name</label><input className="fi" value={f.billTo} onChange={set('billTo')} placeholder="e.g. P2P & WECON" /></div>
              <div className="fg"><label>Account ID</label><input className="fi" value={f.accountId} onChange={set('accountId')} placeholder="Ad account ID" /></div>
              <div className="fg"><label>Billing amount ({f.currency})</label><input className="fi" type="number" min="0" step="0.01" value={f.billingAmount} onChange={set('billingAmount')} placeholder="As on the receipt" /><div className="fin-help">The campaigns below should add up to this.</div></div>
              <div className="fg"><label>Payment method</label>
                <select className="fsel" value={f.paymentMethod} onChange={set('paymentMethod')}>
                  {[...new Set([...(tpl.paymentMethods || []), f.paymentMethod].filter(Boolean))].map(m => <option key={m}>{m}</option>)}
                </select></div>
              <div className="fg"><label>Product type</label><input className="fi" value={f.productType} onChange={set('productType')} /></div>
              <div className="fg"><label>CPM ({f.currency} per 1,000 impressions)</label><input className="fi" type="number" min="0" step="0.01" value={f.cpm} onChange={e => setCpm(e.target.value)} /><div className="fin-help">Impressions = 1,000 × Amount ÷ CPM, filled in for each ad set.</div></div>
              <div className="fg full fin-disc-row">
                <button type="button" className="fin-disc" aria-expanded={open.adv} aria-controls="fin-adv" onClick={() => setOpen(o => ({ ...o, adv: !o.adv }))}>Advanced<Mi className="chev">expand_more</Mi></button>
                <button type="button" className="fin-disc" aria-expanded={open.time} aria-controls="fin-time" onClick={() => setOpen(o => ({ ...o, time: !o.time }))}>
                  Time<span className="v">{f.paidOn ? docDate(f.paidOn) : 'Receipt date'}{f.paidTime ? `, ${time12(f.paidTime)}` : ''}</span><Mi className="chev">expand_more</Mi></button>
              </div>
              {open.adv && <div id="fin-adv" className="fg full fin-disc-panel fin-ids">
                <RefField label="Reference ID" value={f.paymentRef} gen={f.paymentRefGen} locked={!!issued.paymentRef} onType={typeRef('paymentRef')} onGenerate={() => genRef('paymentRef')} />
                <RefField label="Transaction ID" value={f.vendorRef} gen={f.vendorRefGen} locked={!!issued.vendorRef} onType={typeRef('vendorRef')} onGenerate={() => genRef('vendorRef')} />
                <RefField label="Invoice no." value={f.invoiceNo} gen={f.invoiceNoGen} locked={!!issued.invoiceNo} onType={typeRef('invoiceNo')} onGenerate={() => genRef('invoiceNo')} />
                <div className="fin-help full">{issued.vendorRef && issued.paymentRef && issued.invoiceNo
                  ? 'Issued when this statement was first saved. They can’t be edited or regenerated, and are never used again.'
                  : 'Generated IDs (the Invoice no. as WEPRO-INV-…) print as WEPRO internal references, never as Meta’s. Paste the IDs from the Meta receipt to use those instead. All three are checked against every ID issued before and locked when the draft is first saved.'}</div>
              </div>}
              {open.time && <div id="fin-time" className="fg full fin-disc-panel">
                <div className="fg"><label>Payment date</label><input className="fi" type="date" value={f.paidOn} onChange={set('paidOn')} /></div>
                <div className="fg"><div className="fin-pick-hd"><label>Payment time</label><button type="button" className="fin-linkbtn" onClick={setNow}>Now</button></div>
                  <Time12 label="Payment time" value={f.paidTime} onChange={v => setF(x => ({ ...x, paidTime: v }))} /></div>
                <div className="fin-help full">Bangladesh time (Asia/Dhaka). With no payment date the receipt date prints.</div>
              </div>}
            </>}
            <div className="fg full"><label>Duration</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="fi" type="date" value={f.periodFrom} onChange={set('periodFrom')} aria-label="Period from" style={{ flex: '1 1 140px' }} />
                <span className="fin-sub" style={{ display: 'inline' }}>to</span>
                <input className="fi" type="date" value={f.periodTo} min={f.periodFrom || undefined} onChange={set('periodTo')} aria-label="Period to" style={{ flex: '1 1 140px' }} />
                {isAd && <input className="fi" type="time" value={f.periodToTime} onChange={set('periodToTime')} aria-label="Period ends at" title="Campaign end time (23:59 when empty)" style={{ flex: '0 1 120px' }} />}
              </div>
              <div className="fin-kinds" style={{ marginTop: 8 }}>{[[1, '1 month'], [3, '3 months'], [6, '6 months'], [12, '1 year']].map(([m, l]) => (
                <button key={m} type="button" className={f.periodTo && f.periodTo === periodEnd(f.periodFrom, m) ? 'on' : ''}
                  onClick={() => setF(x => { const from = x.periodFrom || x.issuedOn; return { ...x, periodFrom: from, periodTo: periodEnd(from, m) }; })}>{l}</button>))}
              </div>
              <div className="fin-help">The period this charge covers. {isAd ? 'It prints under each campaign, the way the vendor shows it.' : isReceipt ? 'It prints under each line, the way the vendor shows it.' : 'It prints in the statement header.'}</div>
            </div>
            <div className={`fg${isAd ? ' full' : ''}`}><label>{isReceipt ? 'Vendor' : 'From'}</label><textarea className="fi" rows={2} value={f.fromName} onChange={set('fromName')} placeholder={isReceipt ? 'Vendor name' : 'Team or department'} readOnly={isReceipt && !!tpl.vendor} /></div>
            {!isAd && <div className="fg"><label>{isReceipt ? 'Bill to' : 'To'}</label><textarea className="fi" rows={isReceipt ? 4 : 2} value={f.billTo} onChange={set('billTo')} placeholder="Who receives this statement" /></div>}
            <div className="fg full">
              <div className="fin-pick-hd"><label>Expenses on this statement</label>
                {want.key && expenses.length > 0 && (more > 0 || showAll) && <button type="button" className="fin-linkbtn" onClick={() => setShowAll(s => !s)}>{showAll ? `Only ${want.label}` : `Show all (${more} more)`}</button>}
              </div>
              {f.currency !== 'BDT' && expenses.length > 0 && <div className="fin-help">Expenses are recorded in BDT. Check each linked line’s price is in {f.currency}; amounts in another currency aren’t compared with the expense.</div>}
              {expenses.length === 0 ? <div className="fin-help">No expenses recorded on this budget yet. You can still add free lines below.</div>
                : listed.length === 0 ? <div className="fin-help">No {want.label} expenses on this budget. Use “Show all” to pick from the others.</div> : (
                <div className="fin-pick">{listed.map(e => { const off = takenExpenseIds.has(e.id) && !picked.has(e.id); return (
                  <label key={e.id} className={off ? 'off' : ''} title={off ? 'Already on a final statement' : ''}>
                    <input type="checkbox" checked={picked.has(e.id)} disabled={off} onChange={() => toggle(e)} />
                    <span>{e.description || categoryOf(e.category).label || 'Expense'} <span className="fin-sub" style={{ display: 'inline' }}>· {categoryOf(e.category).label} · {e.spentOn} · {EXPENSE_KIND[e.kind]}</span></span>
                    <span className="a">{fmtBDT(e.amount)}</span>
                  </label>); })}</div>
              )}
            </div>
            {isAd ? (
              <div className="fg full"><AdCampaigns lines={lines} setLines={setLines} cpm={f.cpm} currency={f.currency} billing={f.billingAmount} estimate={estimate} setAdAmount={setAdAmount} setAdImpressions={setAdImpressions} /></div>
            ) : (
              <div className="fg full"><label>Lines</label>
                <div className="fin-lines">
                  <div className="fin-line-hd"><span>Description</span><span>Qty</span><span>{isReceipt ? 'Rate' : 'Unit price'}</span><span /></div>
                  {lines.map((l, i) => { const ex = l.expenseId ? exById.get(l.expenseId) : null; const s = stale.get(i); return (
                    <div key={i} className="fin-line-wrap">
                      <div className="fin-line">
                        {isReceipt
                          ? <textarea className="fi" rows={1} value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="A second line shows underneath instead of the duration" style={{ resize: 'vertical', minHeight: 40 }} aria-label={`Line ${i + 1} description`} />
                          : <input className="fi" value={l.description} onChange={e => setLine(i, 'description', e.target.value)} aria-label={`Line ${i + 1} description`} />}
                        <input className="fi" type="number" min="0" step="1" value={l.qty} onChange={e => setLine(i, 'qty', Number(e.target.value))} aria-label={`Line ${i + 1} quantity`} />
                        <input className="fi" type="number" min="0" step="0.01" value={l.unitPrice} onChange={e => setLine(i, 'unitPrice', Number(e.target.value))} aria-label={`Line ${i + 1} unit price`} />
                        <button type="button" className="x" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line"><Mi>close</Mi></button>
                      </div>
                      {ex && (s
                        ? <div className="fin-line-note stale"><Mi>error</Mi><span>Out of date: the linked expense is {docMoney(ex.amount)}, this line is {docMoney(s.amount)}.</span>
                            <button type="button" className="fin-linkbtn" onClick={() => setLines(ls => ls.map((x, j) => (j === i ? { ...x, qty: 1, unitPrice: Number(ex.amount) } : x)))}>Use expense amount</button>
                            <button type="button" className="fin-linkbtn" onClick={() => setLine(i, 'expenseId', null)}>Unlink as custom line</button></div>
                        : <div className="fin-line-note"><Mi>link</Mi><span>Linked to an expense · {EXPENSE_KIND[ex.kind]}</span></div>)}
                    </div>); })}
                  <div><button type="button" className="btn btn-g btn-sm" onClick={() => setLines(ls => [...ls, { expenseId: null, description: '', qty: 1, unitPrice: 0 }])}><Mi>add</Mi>Add a line</button></div>
                  <div className="fin-sumline"><span>Total</span><span>{fmtMoney(statementTotal(lines), f.currency)}</span></div>
                  {!isReceipt && <label className="fin-inline-check"><input type="checkbox" checked={f.showQty} onChange={set('showQty')} />Show quantity and unit price</label>}
                </div>
              </div>
            )}
            <div className="fg"><label>Accent colour</label><input className="fi" type="color" value={f.accent} onChange={set('accent')} /></div>
            <div className="fg"><label>Footer</label><input className="fi" value={f.footer} onChange={set('footer')} placeholder="e.g. Internal use only" /></div>
            <div className="fg full"><label>{isReceipt ? 'Memo' : 'Notes'}</label><textarea className="fi" rows={2} value={f.notes} onChange={set('notes')} /></div>
          </div>
        </div>
        <SplitDivider grid={grid} value={split} onChange={resize} onDragging={setDragging} />
        <div className="fin-split-preview" aria-label="Live preview"><DocPreview fit="canvas" html={html} title="Statement preview" /></div>
      </div>
    </Modal>
  );
}
