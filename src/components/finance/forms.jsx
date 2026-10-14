import { useState, useRef } from 'react';
import Mi from '../Mi.jsx';
import { getDB, getProperties } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import { CATEGORIES, PAY_METHODS, EXPENSE_KIND, readAsBase64, statementTotal } from '../../lib/finance.js';
import { TEMPLATE_LIST, CURRENCIES, templateOf, fmtMoney, periodEnd, impressionsFor } from '../../../Invoice-templates/index.js';

// The finance forms, each a modal on the app's .mov/.modal shell. Every save
// goes to the Edge Function through `onSave`, which resolves on success and
// throws the server's message on failure; the form shows that message inline.

export function Modal({ title, wide, onClose, children, footer }) {
  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal fin-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-hd"><div className="m-ttl">{title}</div><button type="button" className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button></div>
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
// Shown above a list while rows are selected.
export function BulkBar({ sel, noun, onDelete, busy }) {
  if (!sel.selected.length) return null;
  const n = sel.selected.length;
  return (
    <div className="fin-bulk" role="region" aria-label="Selection">
      <span><b>{n}</b> {noun}{n === 1 ? '' : 's'} selected</span>
      <span className="sp" />
      <button type="button" className="btn btn-g btn-sm fin-ibtn" onClick={sel.clear} title="Clear selection" aria-label="Clear selection"><Mi>delete_sweep</Mi></button>
      <button type="button" className="btn btn-g btn-sm ui-del fin-ibtn" onClick={onDelete} disabled={busy} title={`Delete ${n} ${noun}${n === 1 ? '' : 's'}`} aria-label={`Delete ${n} ${noun}${n === 1 ? '' : 's'}`}><Mi>delete</Mi></button>
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

// ── budget ──
export function BudgetForm({ initial, onSave, onClose }) {
  const projects = getProperties();
  const teams = getDB().teams || [];
  const [f, setF] = useState(() => ({ title: '', purpose: '', notes: '', teamId: '', draftAmount: '', ...(initial || {}) }));
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
        <div className="fg"><label>Amount (BDT)</label><input className="fi" type="number" min="0" step="1" value={f.draftAmount} onChange={set('draftAmount')} placeholder="0" /><div className="fin-help">What this budget can spend. Expenses count against it straight away.</div></div>
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
  const leads = (db.leads || []).slice(0, 400);
  const [f, setF] = useState(() => ({ amount: '', spentOn: today(), category: CATEGORIES[0], description: '', paymentMethod: PAY_METHODS[1], kind: 'PAID', spentBy: '', leadName: '', propertyId: budget.propertyId || '', ...(initial || {}) }));
  const [files, setFiles] = useState(initial?.attachments || []);
  const { busy, err, run } = useSubmit();
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const submit = () => run(async () => {
    const m = members.find(u => u.id === f.spentBy), p = projects.find(x => x.id === f.propertyId);
    const lead = leads.find(l => (l.name || '') === f.leadName || l.id === f.leadId);
    await onSave({ ...f, amount: Number(f.amount || 0), spentByName: m?.name || '', propertyName: p?.name || '', leadId: lead?.id || null, leadName: lead?.name || f.leadName || '', attachments: files });
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
        <div className="fg"><label>Category</label><select className="fsel" value={f.category} onChange={set('category')}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="fg"><label>Payment method</label><select className="fsel" value={f.paymentMethod} onChange={set('paymentMethod')}>{PAY_METHODS.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="fg full"><label>Description</label><input className="fi" value={f.description} onChange={set('description')} placeholder="What was bought" /></div>
        <div className="fg"><label>Responsible team member</label><select className="fsel" value={f.spentBy} onChange={set('spentBy')}><option value="">—</option>{members.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="fg"><label>Project</label><select className="fsel" value={f.propertyId || ''} onChange={set('propertyId')}><option value="">—</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="fg full"><label>Lead / customer (optional)</label><input className="fi" list="fin-leads" value={f.leadName} onChange={set('leadName')} placeholder="Type a name" /><datalist id="fin-leads">{leads.map(l => <option key={l.id} value={l.name || ''} />)}</datalist></div>
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
  const rename = (cid, campaign) => setLines(ls => ls.map(l => (l.extra?.cid === cid ? { ...l, extra: { ...l.extra, campaign } } : l)));
  const addSet = (cid, campaign) => setLines(ls => { const at = ls.map(l => l.extra?.cid).lastIndexOf(cid); const out = [...ls]; out.splice(at + 1, 0, blank(cid, campaign)); return out; });
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
        <div key={g.cid} className="fin-camp">
          <div className="fin-camp-hd">
            <input className="fi" value={g.name} placeholder="Campaign name" aria-label="Campaign name" onChange={e => rename(g.cid, e.target.value)} />
            <button type="button" className="x" onClick={() => setLines(ls => ls.filter(l => (l.extra?.cid || '') !== g.cid))} aria-label="Remove campaign"><Mi>close</Mi></button>
          </div>
          <div className="fin-line-hd ad"><span>Ad set</span><span>Impressions</span><span>Amount ({currency})</span><span /></div>
          {g.rows.map(i => { const l = lines[i]; return (
            <div key={i} className="fin-line ad">
              <input className="fi" value={l.description} aria-label="Ad set" placeholder="Ad set name" onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <input className="fi" type="number" min="0" step="1" value={l.extra?.impressions ?? ''} aria-label="Impressions" title={l.extra?.est ? 'Estimated from the CPM. Type the exact number from Meta to replace it.' : 'Exact, from Meta'} style={l.extra?.est ? { fontStyle: 'italic' } : undefined} onChange={e => setAdImpressions(i, e.target.value)} />
              <input className="fi" type="number" min="0" step="0.01" value={l.unitPrice} aria-label="Amount" onChange={e => setAdAmount(i, Number(e.target.value))} />
              <button type="button" className="x" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove ad set"><Mi>close</Mi></button>
            </div>); })}
          <button type="button" className="fin-addset" onClick={() => addSet(g.cid, g.name)}><Mi>add</Mi>Add Ad Set</button>
        </div>
      ))}
      <div className="fin-help">Impressions fill in from Amount ÷ CPM × 1,000 (italic here, marked * as estimated on the statement). Type the exact number from Meta to replace one; clear it to go back to the estimate.</div>
      <div className="fin-sumline"><span>Total</span><span>{fmtMoney(total, currency)}</span></div>
      {Number(billing) > 0 && <div className={`fin-sumline${unallocated ? ' fin-unalloc' : ''}`}><span>Unallocated amount</span><span>{fmtMoney(unallocated, currency)}</span></div>}
    </div>
  );
}

// ── statement (invoice) editor ──
// The template (Invoice-templates/) decides the layout; picking one fills the
// vendor, bill-to, currency and starter lines, which stay editable.
export function StatementForm({ budget, expenses, initial, initialLines, onSave, onClose, takenExpenseIds }) {
  const [f, setF] = useState(() => ({ title: 'Expense statement', issuedOn: today(), fromName: '', billTo: '', notes: '', accent: '#1F6FEB', showQty: true, footer: '', template: 'default', currency: 'BDT', vendorRef: '', paidOn: '', periodFrom: '', periodTo: '', paidTime: '', accountId: '', paymentMethod: '', paymentRef: '', productType: '', cpm: '', billingAmount: '', periodToTime: '', ...(initial || {}) }));
  // Ad sets saved before campaign cards existed get a card key from their campaign name.
  const [lines, setLines] = useState(() => (initialLines && initialLines.length ? initialLines.map(l => ({ expenseId: l.expenseId || null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, extra: { ...(l.extra || {}), ...(l.extra?.campaign != null && !l.extra?.cid ? { cid: 'n:' + l.extra.campaign } : {}) } })) : []));
  const { busy, err, run } = useSubmit();
  const tpl = templateOf(f.template);
  const isReceipt = tpl.layout !== 'standard'; // a vendor layout (receipt, adSpend)
  const isAd = tpl.columns === 'impressions';
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const pickTemplate = (id) => {
    const t = templateOf(id), d = t.defaults || {};
    setF(x => ({
      ...x, template: t.id, currency: t.currency, accent: t.accent || '#1F6FEB',
      title: d.title || (t.id === 'default' ? 'Expense statement' : x.title),
      fromName: t.vendor?.name || (t.id === 'default' ? '' : x.fromName),
      billTo: d.billTo ?? x.billTo,
      paymentMethod: d.paymentMethod ?? x.paymentMethod, productType: d.productType ?? x.productType,
      cpm: x.cpm || d.cpm || '',
      ...(d.months && !x.periodTo ? { periodFrom: x.periodFrom || x.issuedOn, periodTo: periodEnd(x.periodFrom || x.issuedOn, d.months) } : {}),
    }));
    if (d.lines && !lines.length) setLines(d.lines.map(l => ({ expenseId: null, ...l, ...(t.columns === 'impressions' ? { extra: { ...l.extra, cid: newCid() } } : {}) })));
    // An ad template shows one amount per line, so fold qty × price into it.
    else if (t.columns === 'impressions') setLines(ls => ls.map(l => ({ ...l, unitPrice: Number(l.qty || 0) * Number(l.unitPrice || 0), qty: 1, extra: l.extra || {} })));
  };
  const picked = new Set(lines.map(l => l.expenseId).filter(Boolean));
  const toggle = (e) => setLines(ls => {
    if (picked.has(e.id)) return ls.filter(l => l.expenseId !== e.id);
    const line = { expenseId: e.id, description: `${e.description || e.category || 'Expense'} · ${e.spentOn}`, qty: 1, unitPrice: Number(e.amount) };
    return [...ls, isAd ? estimate({ ...line, extra: { cid: newCid(), campaign: '' } }, f.cpm) : line];
  });
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  // An ad line is one unit at its amount. Impressions fill in from the statement
  // CPM (marked est) until someone types the exact figure from the vendor.
  const estimate = (l, cpm) => (l.extra?.est === false || !(Number(cpm) > 0) ? l
    : { ...l, extra: { ...l.extra, cpm: Number(cpm), impressions: impressionsFor(l.unitPrice, cpm), est: true } });
  const setAdAmount = (i, unitPrice) => setLines(ls => ls.map((l, j) => (j === i ? estimate({ ...l, qty: 1, unitPrice }, f.cpm) : l)));
  const setAdImpressions = (i, v) => setLines(ls => ls.map((l, j) => (j === i
    ? (v === '' ? estimate({ ...l, extra: { ...l.extra, est: undefined } }, f.cpm) : { ...l, extra: { ...l.extra, impressions: v, est: false } })
    : l)));
  const setCpm = (cpm) => { setF(x => ({ ...x, cpm })); setLines(ls => ls.map(l => estimate(l, cpm))); };
  const submit = () => run(async () => {
    await onSave({ title: f.title, issuedOn: f.issuedOn, fromName: f.fromName, billTo: f.billTo, notes: f.notes, lines,
      layout: { template: f.template, currency: f.currency, accent: f.accent, showQty: f.showQty, footer: f.footer, vendorRef: f.vendorRef, paidOn: f.paidOn, periodFrom: f.periodFrom, periodTo: f.periodTo,
        paidTime: f.paidTime, accountId: f.accountId, paymentMethod: f.paymentMethod, paymentRef: f.paymentRef, productType: f.productType, cpm: f.cpm,
        billingAmount: f.billingAmount, periodToTime: f.periodToTime } });
    onClose();
  });
  return (
    <Modal wide title={initial?.id ? `Edit ${initial.number}` : `New statement · ${budget.title}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-p" onClick={submit} disabled={busy}><Mi>check</Mi>Save draft</button>
    </>}>
      <Err msg={err} />
      <div className="fin-form">
        <div className="fg full"><label>Template</label>
          <select className="fsel" value={f.template} onChange={e => pickTemplate(e.target.value)}>{TEMPLATE_LIST.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          {isReceipt && <div className="fin-help">Laid out like a {tpl.name} receipt, headed STATEMENT, with a footer saying WEPRO prepared it from the {tpl.name} receipt. Attach the original receipt to the expense.</div>}
        </div>
        <div className="fg"><label>Title</label><input className="fi" value={f.title} onChange={set('title')} /></div>
        <div className="fg"><label>{isReceipt ? 'Receipt date' : 'Date'}</label><input className="fi" type="date" value={f.issuedOn} onChange={set('issuedOn')} /></div>
        {isReceipt && <>
          <div className="fg"><label>{tpl.refLabel || 'Vendor reference'}</label><input className="fi" value={f.vendorRef} onChange={set('vendorRef')} placeholder="As printed on the vendor receipt" /></div>
          <div className="fg"><label>Payment date</label><input className="fi" type="date" value={f.paidOn} onChange={set('paidOn')} /></div>
        </>}
        {isAd && <>
          <div className="fg"><label>Payment time</label><input className="fi" type="time" value={f.paidTime} onChange={set('paidTime')} /></div>
          <div className="fg"><label>Client name</label><input className="fi" value={f.billTo} onChange={set('billTo')} placeholder="e.g. P2P & WECON" /></div>
          <div className="fg"><label>Account ID</label><input className="fi" value={f.accountId} onChange={set('accountId')} placeholder="Ad account ID" /></div>
          <div className="fg"><label>Billing amount ({f.currency})</label><input className="fi" type="number" min="0" step="0.01" value={f.billingAmount} onChange={set('billingAmount')} placeholder="As on the receipt" /><div className="fin-help">The campaigns below should add up to this.</div></div>
          <div className="fg"><label>Payment method</label>
            <select className="fsel" value={f.paymentMethod} onChange={set('paymentMethod')}>
              {[...new Set([...(tpl.paymentMethods || []), f.paymentMethod].filter(Boolean))].map(m => <option key={m}>{m}</option>)}
            </select></div>
          <div className="fg"><label>Reference number</label><input className="fi" value={f.paymentRef} onChange={set('paymentRef')} placeholder="From the receipt (optional)" /></div>
          <div className="fg"><label>Product type</label><input className="fi" value={f.productType} onChange={set('productType')} /></div>
          <div className="fg"><label>CPM ({f.currency} per 1,000 impressions)</label><input className="fi" type="number" min="0" step="0.01" value={f.cpm} onChange={e => setCpm(e.target.value)} /><div className="fin-help">Impressions fill in from each ad set's amount at this CPM.</div></div>
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
        <div className="fg"><label>{isReceipt ? 'Vendor' : 'From'}</label><textarea className="fi" rows={2} value={f.fromName} onChange={set('fromName')} placeholder={isReceipt ? 'Vendor name' : 'Team or department'} readOnly={isReceipt && !!tpl.vendor} /></div>
        {!isAd && <div className="fg"><label>{isReceipt ? 'Bill to' : 'To'}</label><textarea className="fi" rows={isReceipt ? 4 : 2} value={f.billTo} onChange={set('billTo')} placeholder="Who receives this statement" /></div>}
        <div className="fg"><label>Currency</label><select className="fsel" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="fg full"><label>Expenses on this statement</label>
          {f.currency !== 'BDT' && expenses.length > 0 && <div className="fin-help">Expenses are recorded in BDT. Check each line’s price is in {f.currency}.</div>}
          {expenses.length === 0 ? <div className="fin-help">No expenses recorded on this budget yet. You can still add free lines below.</div> : (
            <div className="fin-pick">{expenses.map(e => { const off = takenExpenseIds.has(e.id) && !picked.has(e.id); return (
              <label key={e.id} className={off ? 'off' : ''} title={off ? 'Already on a final statement' : ''}>
                <input type="checkbox" checked={picked.has(e.id)} disabled={off} onChange={() => toggle(e)} />
                <span>{e.description || e.category || 'Expense'} <span className="fin-sub" style={{ display: 'inline' }}>· {e.spentOn} · {EXPENSE_KIND[e.kind]}</span></span>
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
            {lines.map((l, i) => (
              <div key={i} className="fin-line">
                <textarea className="fi" rows={1} value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="A second line shows underneath instead of the duration" style={{ resize: 'vertical', minHeight: 40 }} />
                <input className="fi" type="number" min="0" step="1" value={l.qty} onChange={e => setLine(i, 'qty', Number(e.target.value))} />
                <input className="fi" type="number" min="0" step="0.01" value={l.unitPrice} onChange={e => setLine(i, 'unitPrice', Number(e.target.value))} />
                <button type="button" className="x" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Remove line"><Mi>close</Mi></button>
              </div>
            ))}
            <div><button type="button" className="btn btn-g btn-sm" onClick={() => setLines(ls => [...ls, { expenseId: null, description: '', qty: 1, unitPrice: 0 }])}><Mi>add</Mi>Add a line</button></div>
            <div className="fin-sumline"><span>Total</span><span>{fmtMoney(statementTotal(lines), f.currency)}</span></div>
          </div>
        </div>
        )}
        <div className="fg"><label>Accent colour</label><input className="fi" type="color" value={f.accent} onChange={set('accent')} style={{ height: 40, padding: 4 }} /></div>
        {!isReceipt && <div className="fg"><label>Columns</label><label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 500 }}><input type="checkbox" checked={f.showQty} onChange={set('showQty')} />Show quantity and unit price</label></div>}
        <div className="fg full"><label>{isReceipt ? 'Memo' : 'Notes'}</label><textarea className="fi" rows={2} value={f.notes} onChange={set('notes')} /></div>
        <div className="fg full"><label>Footer</label><input className="fi" value={f.footer} onChange={set('footer')} placeholder="e.g. Internal use only" /></div>
      </div>
    </Modal>
  );
}
