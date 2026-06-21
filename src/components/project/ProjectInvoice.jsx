import Mi from '../Mi.jsx';
import { fmtBDT } from '../../lib/helpers.js';

// WECON offer document (Stripe-receipt style). `inline` renders just the sheet
// for an embedded A4 preview; otherwise it's a full overlay with a print bar.
// Preview only for now (TODO: persist/issue with a real number via backend).
export default function ProjectInvoice({ project, variant, deal, calc, agent, onClose, inline }) {
  const date = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const no = 'WCN-' + (project.id || '').slice(-4).toUpperCase() + '-' + String(deal.unitId || '').replace(/\W/g, '');
  const discountAmt = calc.offerValue - calc.discountedOffer;
  const addonItems = (project.addons || []).filter(a => deal.addons?.[a.id]);
  const validUntil = new Date(Date.now() + (project.fastCloseDays || 7) * 86400000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  const sheet = (
    <div className="inv-sheet">
      <div className="inv-top">
        <h1 className="inv-title">Offer</h1>
        <div className="inv-logo">WECON</div>
      </div>

      <div className="inv-keys">
        <div><span>Offer number</span><b>{no}</b></div>
        <div><span>Date</span><b>{date}</b></div>
        <div><span>Status</span><b>Draft offer</b></div>
      </div>

      <div className="inv-cols">
        <div className="inv-col">
          <div className="inv-strong">WECON Properties</div>
          <div>{project.name}</div>
          <div>{project.address || [project.area, project.district].filter(Boolean).join(', ')}</div>
          <div>sales@wecon.com</div>
        </div>
        <div className="inv-col">
          <div className="inv-strong">Bill to</div>
          <div>{deal.client.name || '—'}</div>
          {deal.client.phone && <div>{deal.client.phone}</div>}
          <div>Bangladesh</div>
        </div>
      </div>

      <div className="inv-big">{fmtBDT(calc.dealTotal)} offer</div>
      <div className="inv-lede">This is a price offer, not a tax invoice. Figures exclude registration &amp; statutory charges unless stated. Valid until {validUntil}.</div>

      <table className="inv-tbl">
        <thead><tr><th>Description</th><th className="inv-c">Qty</th><th className="inv-r">Unit price</th><th className="inv-r">Amount</th></tr></thead>
        <tbody>
          <tr>
            <td><div className="inv-d1">Unit {deal.unitId} · {variant.name}</div><div className="inv-d2">{variant.size} sqft @ {fmtBDT(calc.offerRate)}/sqft</div></td>
            <td className="inv-c">1</td>
            <td className="inv-r">{fmtBDT(calc.offerValue)}</td>
            <td className="inv-r">{fmtBDT(calc.offerValue)}</td>
          </tr>
          {discountAmt > 0 && (
            <tr><td><div className="inv-d1">Fast-close incentive</div><div className="inv-d2">−{calc.discountPct}% if signed within {project.fastCloseDays} days</div></td><td className="inv-c">1</td><td className="inv-r">—</td><td className="inv-r">−{fmtBDT(discountAmt)}</td></tr>
          )}
          {addonItems.map(a => (
            <tr key={a.id}><td><div className="inv-d1">{a.name}</div></td><td className="inv-c">1</td><td className="inv-r">{fmtBDT(a.amount)}</td><td className="inv-r">{fmtBDT(a.amount)}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="inv-sums">
        <div className="inv-sum"><span>Subtotal</span><span>{fmtBDT(calc.offerValue)}</span></div>
        {discountAmt > 0 && <div className="inv-sum"><span>Fast-close discount</span><span>−{fmtBDT(discountAmt)}</span></div>}
        {calc.addOnsTotal > 0 && <div className="inv-sum"><span>Add-ons</span><span>+{fmtBDT(calc.addOnsTotal)}</span></div>}
        <div className="inv-sum inv-sum-tot"><span>Deal total</span><span>{fmtBDT(calc.dealTotal)}</span></div>
      </div>

      {calc.belowFloor && <div className="inv-flag">Below floor price — subject to manager approval.</div>}

      <div className="inv-foot">Prepared by {agent?.name || '—'} · WECON Properties</div>
    </div>
  );

  if (inline) return <div className="inv-inline">{sheet}</div>;

  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-doc" onClick={e => e.stopPropagation()}>
        <div className="inv-bar">
          <span className="inv-bar-t"><Mi>receipt_long</Mi>Offer preview</span>
          <div className="inv-bar-a">
            <button className="btn btn-g btn-sm" onClick={() => window.print()}><Mi>print</Mi>Print</button>
            <button className="m-x" onClick={onClose}><Mi>close</Mi></button>
          </div>
        </div>
        {sheet}
      </div>
    </div>
  );
}
