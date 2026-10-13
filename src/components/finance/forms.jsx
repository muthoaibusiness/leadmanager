import { useState, useRef } from 'react';
import Mi from '../Mi.jsx';
import { getDB, getProperties } from '../../lib/db.js';
import { fmtBDT } from '../../lib/helpers.js';
import { CATEGORIES, PAY_METHODS, EXPENSE_KIND, readAsBase64, statementTotal } from '../../lib/finance.js';
import { TEMPLATE_LIST, CURRENCIES, templateOf, fmtMoney, periodEnd } from '../../../Invoice-templates/index.js';

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
  const [f, setF] = useState(() => ({ title: '', purpose: '', notes: '', propertyId: '', teamId: '', draftAmount: '', ...(initial || {}) }));
  const { busy, err, run } = useSubmit();
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const submit = () => run(async () => {
    const p = projects.find(x => x.id === f.propertyId), t = teams.find(x => x.id === f.teamId);
    await onSave({ ...f, draftAmount: Number(f.draftAmount || 0), propertyName: p?.name || '', teamName: t?.name || '' });
    onClose();
  });
  return (
    <Modal title={initial?.id ? 'Edit budget' : 'New budget'} onClose={onClose} footer={<>
      <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-p" onClick={submit} disabled={busy}><Mi>check</Mi>{initial?.id ? 'Save' : 'Create draft'}</button>
    </>}>
      <Err msg={err} />
      <div className="fin-form">
        <div className="fg full"><label>Title</label><input className="fi" value={f.title} onChange={set('title')} placeholder="e.g. Q4 marketing" autoFocus /></div>
        <div className="fg"><label>Amount (BDT)</label><input className="fi" type="number" min="0" step="1" value={f.draftAmount} onChange={set('draftAmount')} placeholder="0" /><div className="fin-help">The amount you will request. It becomes the request on submit; only an approval sets the approved amount.</div></div>
        <div className="fg"><label>Purpose</label><input className="fi" value={f.purpose} onChange={set('purpose')} placeholder="What it pays for" /></div>
        <div className="fg"><label>Project</label><select className="fsel" value={f.propertyId} onChange={set('propertyId')}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="fg"><label>Responsible team</label><select className="fsel" value={f.teamId} onChange={set('teamId')}><option value="">No team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="fg full"><label>Notes</label><textarea className="fi" rows={3} value={f.notes} onChange={set('notes')} /></div>
      </div>
    </Modal>
  );
}

// ── submit for approval ──
export function SubmitForm({ budget, onSubmit, onClose }) {
  const [note, setNote] = useState('');
  const { busy, err, run } = useSubmit();
  return (
    <Modal title="Submit for approval" onClose={onClose} footer={<>
      <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-p" onClick={() => run(async () => { await onSubmit(note); onClose(); })} disabled={busy}><Mi>send</Mi>Submit request</button>
    </>}>
      <Err msg={err} />
      <div className="fin-mini"><div><span>Budget</span><b>{budget.title}</b></div><div><span>Requesting</span><b>{fmtBDT(budget.draftAmount)}</b></div><div><span>Project</span><b>{budget.propertyName || '—'}</b></div></div>
      <div className="fg"><label>Note to the approver (optional)</label><textarea className="fi" rows={3} value={note} onChange={e => setNote(e.target.value)} /></div>
      <div className="fin-help">Once submitted the budget is locked until a decision is made. Approvers are notified.</div>
    </Modal>
  );
}

// ── decide ──
export function DecideForm({ budget, figures, request, onDecide, onClose, preset }) {
  const [decision, setDecision] = useState(preset || 'APPROVED');
  const [amount, setAmount] = useState(String(figures?.requested ?? budget.draftAmount ?? ''));
  const [note, setNote] = useState('');
  const { busy, err, run } = useSubmit();
  const opts = [['APPROVED', 'Approve', 'good', 'check_circle'], ['REVISION', 'Request revision', 'warn', 'undo'], ['REJECTED', 'Reject', 'bad', 'cancel']];
  return (
    <Modal title={`Decide · ${budget.title}`} onClose={onClose} footer={<>
      <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-p" onClick={() => run(async () => { await onDecide({ decision, approvedAmount: Number(amount || 0), note }); onClose(); })} disabled={busy}><Mi>check</Mi>Confirm</button>
    </>}>
      <Err msg={err} />
      <div className="fin-mini">
        <div><span>Requested (v{request?.version ?? figures?.version ?? 1})</span><b>{fmtBDT(figures?.requested ?? 0)}</b></div>
        <div><span>Submitted by</span><b>{request?.submittedByName || budget.createdByName || '—'}</b></div>
        <div><span>Project</span><b>{budget.propertyName || '—'}</b></div>
      </div>
      {request?.note && <div className="fin-note" style={{ marginBottom: 12 }}>“{request.note}”</div>}
      <div className="fin-decide" style={{ marginBottom: 12 }}>
        {opts.map(([k, l, tone, ic]) => <button key={k} type="button" className={`${decision === k ? 'on ' + tone : ''}`} onClick={() => setDecision(k)}><Mi>{ic}</Mi> {l}</button>)}
      </div>
      {decision === 'APPROVED' && (
        <div className="fg"><label>Approved amount (BDT)</label><input className="fi" type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} /><div className="fin-help">May differ from the requested amount. This figure, not the request, becomes the budget.</div></div>
      )}
      <div className="fg"><label>Note {decision === 'REVISION' ? '(what to change)' : '(optional)'}</label><textarea className="fi" rows={3} value={note} onChange={e => setNote(e.target.value)} /></div>
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

// ── statement (invoice) editor ──
// The template (Invoice-templates/) decides the layout; picking one fills the
// vendor, bill-to, currency and starter lines, which stay editable.
export function StatementForm({ budget, expenses, initial, initialLines, onSave, onClose, takenExpenseIds }) {
  const [f, setF] = useState(() => ({ title: 'Expense statement', issuedOn: today(), fromName: '', billTo: '', notes: '', accent: '#1F6FEB', showQty: true, footer: '', template: 'default', currency: 'BDT', vendorRef: '', paidOn: '', periodFrom: '', periodTo: '', ...(initial || {}) }));
  const [lines, setLines] = useState(() => (initialLines && initialLines.length ? initialLines.map(l => ({ expenseId: l.expenseId || null, description: l.description, qty: l.qty, unitPrice: l.unitPrice })) : []));
  const { busy, err, run } = useSubmit();
  const tpl = templateOf(f.template);
  const isReceipt = tpl.layout === 'receipt';
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const pickTemplate = (id) => {
    const t = templateOf(id), d = t.defaults || {};
    setF(x => ({
      ...x, template: t.id, currency: t.currency, accent: t.accent || '#1F6FEB',
      title: d.title || (t.id === 'default' ? 'Expense statement' : x.title),
      fromName: t.vendor?.name || (t.id === 'default' ? '' : x.fromName),
      billTo: d.billTo ?? x.billTo,
      ...(d.months && !x.periodTo ? { periodFrom: x.periodFrom || x.issuedOn, periodTo: periodEnd(x.periodFrom || x.issuedOn, d.months) } : {}),
    }));
    if (d.lines && !lines.length) setLines(d.lines.map(l => ({ expenseId: null, ...l })));
  };
  const picked = new Set(lines.map(l => l.expenseId).filter(Boolean));
  const toggle = (e) => setLines(ls => picked.has(e.id) ? ls.filter(l => l.expenseId !== e.id) : [...ls, { expenseId: e.id, description: `${e.description || e.category || 'Expense'} · ${e.spentOn}`, qty: 1, unitPrice: Number(e.amount) }]);
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const submit = () => run(async () => {
    await onSave({ title: f.title, issuedOn: f.issuedOn, fromName: f.fromName, billTo: f.billTo, notes: f.notes, lines,
      layout: { template: f.template, currency: f.currency, accent: f.accent, showQty: f.showQty, footer: f.footer, vendorRef: f.vendorRef, paidOn: f.paidOn, periodFrom: f.periodFrom, periodTo: f.periodTo } });
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
        <div className="fg full"><label>Duration</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="fi" type="date" value={f.periodFrom} onChange={set('periodFrom')} aria-label="Period from" style={{ flex: '1 1 140px' }} />
            <span className="fin-sub" style={{ display: 'inline' }}>to</span>
            <input className="fi" type="date" value={f.periodTo} min={f.periodFrom || undefined} onChange={set('periodTo')} aria-label="Period to" style={{ flex: '1 1 140px' }} />
          </div>
          <div className="fin-kinds" style={{ marginTop: 8 }}>{[[1, '1 month'], [3, '3 months'], [6, '6 months'], [12, '1 year']].map(([m, l]) => (
            <button key={m} type="button" className={f.periodTo && f.periodTo === periodEnd(f.periodFrom, m) ? 'on' : ''}
              onClick={() => setF(x => { const from = x.periodFrom || x.issuedOn; return { ...x, periodFrom: from, periodTo: periodEnd(from, m) }; })}>{l}</button>))}
          </div>
          <div className="fin-help">The period this charge covers. {isReceipt ? 'It prints under each line, the way the vendor shows it.' : 'It prints in the statement header.'}</div>
        </div>
        <div className="fg"><label>{isReceipt ? 'Vendor' : 'From'}</label><textarea className="fi" rows={2} value={f.fromName} onChange={set('fromName')} placeholder={isReceipt ? 'Vendor name' : 'Team or department'} readOnly={isReceipt && !!tpl.vendor} /></div>
        <div className="fg"><label>{isReceipt ? 'Bill to' : 'To'}</label><textarea className="fi" rows={isReceipt ? 4 : 2} value={f.billTo} onChange={set('billTo')} placeholder="Who receives this statement" /></div>
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
        <div className="fg"><label>Accent colour</label><input className="fi" type="color" value={f.accent} onChange={set('accent')} style={{ height: 40, padding: 4 }} /></div>
        {!isReceipt && <div className="fg"><label>Columns</label><label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontWeight: 500 }}><input type="checkbox" checked={f.showQty} onChange={set('showQty')} />Show quantity and unit price</label></div>}
        <div className="fg full"><label>{isReceipt ? 'Memo' : 'Notes'}</label><textarea className="fi" rows={2} value={f.notes} onChange={set('notes')} /></div>
        <div className="fg full"><label>Footer</label><input className="fi" value={f.footer} onChange={set('footer')} placeholder="e.g. Internal use only" /></div>
      </div>
    </Modal>
  );
}
