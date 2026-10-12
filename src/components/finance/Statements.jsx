import { useState } from 'react';
import Mi from '../Mi.jsx';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import { useProjectToast } from '../project/projectToast.js';
import { byId, linesOf, statementTotal, expensesOf, shareLinks } from '../../lib/finance.js';
import { StatementForm, Modal } from './forms.jsx';
import { Discussion, History } from './Discussion.jsx';

// Expense statements (internal invoices): the list, and one statement as a
// document with print / finalize / share. The sheet reuses the offer document
// classes (.inv-*) so the existing print stylesheet produces the PDF.
export default function Statements({ api, user, invoiceId, setInvoiceId, onOpenBudget }) {
  const { fin } = api;
  const inv = invoiceId ? byId(fin.invoices, invoiceId) : null;
  if (invoiceId && !inv) setInvoiceId(null);
  return (
    <>
      <StatementList api={api} onOpen={setInvoiceId} onOpenBudget={onOpenBudget} />
      {inv && <StatementDoc api={api} user={user} inv={inv} onClose={() => setInvoiceId(null)} />}
    </>
  );
}

function StatementList({ api, onOpen, onOpenBudget }) {
  const { fin } = api;
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const rows = fin.invoices.filter(i => !term || [i.number, i.title, byId(fin.budgets, i.budgetId)?.title].some(s => (s || '').toLowerCase().includes(term)));
  return (
    <>
      <div className="fin-tools">
        <div className="acc-search fin-search"><Mi>search</Mi><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search statements" aria-label="Search statements" /></div>
        <span className="sp" />
        <span className="fin-help">New statements are created from an approved budget.</span>
      </div>
      <div className="fin-card">
        {rows.length === 0 ? <div className="fin-empty">{fin.invoices.length ? 'No statements match.' : 'No statements yet. Open an approved budget and choose “New statement”.'}</div> : (
          <div className="fin-scroll"><table className="fin-tbl">
            <thead><tr><th>Number</th><th>Title</th><th>Budget</th><th>Date</th><th>Status</th><th className="r">Total</th><th>By</th></tr></thead>
            <tbody>{rows.map(i => { const b = byId(fin.budgets, i.budgetId); return (
              <tr key={i.id} className="click" onClick={() => onOpen(i.id)}>
                <td className="w"><span className="fin-ttl">{i.number}</span></td><td>{i.title}</td>
                <td className="m"><button type="button" className="fin-back" onClick={e => { e.stopPropagation(); b && onOpenBudget(b.id); }}>{b?.title || '—'}</button></td>
                <td className="m w">{i.issuedOn || '—'}</td>
                <td><span className={`fin-pill ${i.status === 'FINAL' ? 't-good' : 't-muted'}`}>{i.status === 'FINAL' ? 'Final' : 'Draft'}</span></td>
                <td className="r">{fmtBDT(statementTotal(linesOf(fin, i.id)))}</td>
                <td className="m">{i.createdByName || '—'}<span className="fin-sub">{fmtAgo(i.createdAt)}</span></td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function StatementDoc({ api, user, inv, onClose }) {
  const { fin, act } = api;
  const lines = linesOf(fin, inv.id);
  const budget = byId(fin.budgets, inv.budgetId);
  const total = statementTotal(lines);
  const layout = inv.layout || {};
  const accent = /^#[0-9a-f]{3,8}$/i.test(layout.accent || '') ? layout.accent : '#1F6FEB';
  const showQty = layout.showQty !== false;
  const [panel, setPanel] = useState(null); // 'edit' | 'share' | 'discussion' | 'history'
  const [shareUrl, setShareUrl] = useState('');
  const toast = useProjectToast({ always: true });
  const finalIds = new Set(fin.lines.filter(l => l.isFinal && l.expenseId && l.invoiceId !== inv.id).map(l => l.expenseId));

  const finalize = () => toast.confirm({
    title: `Finalize ${inv.number}?`, description: 'A final statement can’t be edited or deleted, and its expenses can’t change. A share link is issued.', confirmLabel: 'Finalize',
    onConfirm: () => act('invoice.finalize', { invoiceId: inv.id }).then(() => toast.success('Statement finalized')).catch(e => toast.error('Not finalized', e.message)),
  });
  const del = () => toast.confirm({ title: `Delete draft ${inv.number}?`, description: 'The draft is removed.', confirmLabel: 'Delete',
    onConfirm: () => act('invoice.delete', { invoiceId: inv.id }).then(() => { toast.success('Draft deleted'); onClose(); }).catch(e => toast.error('Not deleted', e.message)) });
  const share = async (rotate = false) => {
    try { const r = await act('invoice.share', { invoiceId: inv.id, rotate }); setShareUrl(r.url); setPanel('share'); if (rotate) toast.success('New link issued', 'The old link no longer works.'); }
    catch (e) { toast.error('Could not share', e.message); }
  };
  const copy = () => { navigator.clipboard?.writeText(shareUrl); toast.success('Link copied'); };
  const links = shareLinks(shareUrl, `${inv.number} · ${inv.title}`);

  const sheet = (
    <div className="inv-sheet" style={{ position: 'relative' }}>
      {inv.status !== 'FINAL' && <div className="fin-doc-draft">DRAFT</div>}
      <div className="inv-top"><h1 className="inv-title">{inv.title}</h1><div className="inv-logo" style={{ color: accent }}>WEPRO</div></div>
      <div className="inv-keys">
        <div><span>Number</span><b>{inv.number}</b></div>
        <div><span>Date</span><b>{inv.issuedOn || '—'}</b></div>
        <div><span>Budget</span><b>{budget?.title || '—'}</b></div>
      </div>
      <div className="inv-cols">
        <div className="inv-col"><div className="inv-strong">From</div>{(inv.fromName || '—').split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className="inv-col"><div className="inv-strong">To</div>{(inv.billTo || '—').split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
      </div>
      <div className="inv-big">{fmtBDT(total)}</div>
      <div className="inv-lede">Internal expense statement, not a tax invoice. Figures are recorded against the budget above.</div>
      <table className="inv-tbl">
        <thead><tr><th>Description</th>{showQty && <><th className="inv-c">Qty</th><th className="inv-r">Unit price</th></>}<th className="inv-r">Amount</th></tr></thead>
        <tbody>{lines.map(l => (
          <tr key={l.id}><td><div className="inv-d1">{l.description || '—'}</div></td>{showQty && <><td className="inv-c">{l.qty}</td><td className="inv-r">{fmtBDT(l.unitPrice)}</td></>}<td className="inv-r">{fmtBDT(Number(l.qty) * Number(l.unitPrice))}</td></tr>
        ))}</tbody>
      </table>
      <div className="inv-sums"><div className="inv-sum inv-sum-tot"><span>Total</span><span style={{ color: accent }}>{fmtBDT(total)}</span></div></div>
      {inv.notes && <div className="inv-lede" style={{ marginTop: 18, whiteSpace: 'pre-line' }}>{inv.notes}</div>}
      <div className="inv-foot">{layout.footer ? `${layout.footer} · ` : ''}Prepared by {inv.createdByName || '—'} · WEPRO CRM</div>
    </div>
  );

  return (
    <>
      <div className="inv-ov" onClick={onClose}>
        <div className="inv-doc" onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 96vw)' }}>
          <div className="inv-bar fin-docbar">
            <span className="inv-bar-t"><Mi>receipt_long</Mi>{inv.number}<span className={`fin-pill ${inv.status === 'FINAL' ? 't-good' : 't-muted'}`}>{inv.status === 'FINAL' ? 'Final' : 'Draft'}</span></span>
            <div className="inv-bar-a">
              <button type="button" className="btn btn-g btn-sm" onClick={() => window.print()} title="Print or save as PDF"><Mi>print</Mi>Print / PDF</button>
              {inv.status === 'DRAFT' && <button type="button" className="btn btn-g btn-sm" onClick={() => setPanel('edit')}><Mi>edit</Mi>Edit</button>}
              {inv.status === 'DRAFT' && <button type="button" className="btn btn-p btn-sm" onClick={finalize}><Mi>check_circle</Mi>Finalize</button>}
              <button type="button" className="btn btn-g btn-sm" onClick={() => (shareUrl ? setPanel('share') : share(false))}><Mi>link</Mi>Share</button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => setPanel(panel === 'discussion' ? null : 'discussion')} title="Discussion"><Mi>forum</Mi></button>
              <button type="button" className="btn btn-g btn-sm" onClick={() => setPanel(panel === 'history' ? null : 'history')} title="History"><Mi>history</Mi></button>
              {inv.status === 'DRAFT' && <button type="button" className="btn btn-g btn-sm ui-del" onClick={del} title="Delete draft"><Mi>delete</Mi></button>}
              <button type="button" className="m-x" onClick={onClose} aria-label="Close"><Mi>close</Mi></button>
            </div>
          </div>
          <div style={{ overflowY: 'auto' }}>
            {sheet}
            {panel === 'discussion' && <div className="fin-card" style={{ margin: 16 }}><div className="fin-card-hd"><span><Mi>forum</Mi>Discussion</span></div><Discussion api={api} user={user} type="invoice" id={inv.id} /></div>}
            {panel === 'history' && <div className="fin-card" style={{ margin: 16 }}><div className="fin-card-hd"><span><Mi>history</Mi>History</span></div><History api={api} type="invoice" id={inv.id} /></div>}
          </div>
        </div>
      </div>
      {panel === 'edit' && <StatementForm budget={budget} expenses={expensesOf(fin, inv.budgetId)} takenExpenseIds={finalIds} initial={{ ...inv, accent, showQty, footer: layout.footer || '' }} initialLines={lines} onClose={() => setPanel(null)}
        onSave={(i) => act('invoice.save', { invoice: { ...i, id: inv.id, budgetId: inv.budgetId } }).then(() => toast.success('Draft saved'))} />}
      {panel === 'share' && (
        <Modal title={`Share ${inv.number}`} onClose={() => setPanel(null)}>
          <div className="fin-share">
            <div className="fin-help">Anyone with this link can view and print the statement. It is unguessable and can be replaced at any time.{inv.status !== 'FINAL' ? ' The page shows a DRAFT watermark until the statement is finalized.' : ''}</div>
            <div className="fin-share-url"><input className="fi" readOnly value={shareUrl} onFocus={e => e.target.select()} /><button type="button" className="btn btn-g btn-sm" onClick={copy}><Mi>content_copy</Mi>Copy</button></div>
            <div className="fin-share-row">
              <a className="btn btn-g btn-sm" href={links.mailto}><Mi>mail</Mi>Email</a>
              <a className="btn btn-g btn-sm" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><Mi>chat</Mi>WhatsApp</a>
              <a className="btn btn-g btn-sm" href={shareUrl} target="_blank" rel="noopener noreferrer"><Mi>visibility</Mi>Open</a>
              <span className="sp" style={{ flex: 1 }} />
              <button type="button" className="btn btn-g btn-sm" onClick={() => share(true)}><Mi>sync</Mi>Replace link</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
