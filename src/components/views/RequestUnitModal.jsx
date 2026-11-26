import { useEffect } from 'react';
import Mi from '../Mi.jsx';
import FloorCanvas from '../booking/FloorCanvas.jsx';
import { StackTable } from '../booking/StackGrid.jsx';
import { getProjectById, maskProject } from '../../lib/projects.js';
import { useApp } from '../../context/AppContext.jsx';
import { canCustomers, canPrices } from '../../lib/constants.js';
import { textFloor, landmarks, shopLabel, stackOf } from '../../lib/floorText.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import '../booking/ShopBooking.css';
import '../project/AddPropertyWizard.css';
import './AccountsView.css';
import './RequestUnitModal.css';

// A hold request, opened as a pop-up over the Requests page: the floor plan with the requested unit
// pointed out, and the request beside it (who asked, for whom, how much, what it is now), with the
// decision buttons while it is pending. No navigation: the queue stays where it was.

const day = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export default function RequestUnitModal({ r, onClose, onDecide, onOpenBooking, onOpenConsole, onUnhold }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { user } = useApp();
  const seeCust = canCustomers(user), seePrice = canPrices(user);
  const proj = maskProject(getProjectById(r.propertyId), { customers: seeCust, prices: seePrice });
  const plan = (proj?.floorPlans || []).find(p => (p.boxes || []).some(b => b.unitId === r.unitId)) || null;
  const floor = proj && plan ? textFloor(proj, plan) : null;
  const lm = plan ? landmarks(plan) : null;
  const shop = floor?.shops.find(s => s.code === r.unitId) || null;
  // a tower (Shafiq Sapphire) is shown as its building grid, like the Booking page
  const stack = plan?.grid ? stackOf(proj, [...proj.floorPlans].sort((a, b) => (b.order ?? 0) - (a.order ?? 0))) : null;

  return (
    <div className="pw-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bk acx-modal rqm" role="dialog" aria-modal="true" aria-labelledby="rqm-t">
        <header className="pw-head">
          <div className="acx-mt">
            <span className="bk-eyebrow">{r.propertyName}{plan ? ` · ${plan.name}` : ''}</span>
            <h3 id="rqm-t">{shopLabel(r.unitId)}</h3>
          </div>
          <span className={`bk-pill rqx-st-${r.state || r.status}`}><i className="bk-dot" />{({ held: 'On hold', approved: 'On hold', sold: 'Sold', released: 'Released' })[r.state || r.status] || r.status}</span>
          <button type="button" className="bk-close" aria-label="Close" onClick={onClose}><Mi>close</Mi></button>
        </header>

        <div className="rqm-body">
          <div className="rqm-map">
            {stack ? (
              <>
                <div className="rqm-stage rqm-stack"><StackTable rows={stack.rows} cols={stack.cols} focus={r.unitId} shopCode={r.unitId} /></div>
                <span className="bk-cap">{plan.name} · the requested unit is outlined</span>
              </>
            ) : floor && lm ? (
              <>
                <div className="rqm-stage"><FloorCanvas floor={floor} lm={lm} focus={r.unitId} shopCode={r.unitId} /></div>
                <span className="bk-cap">{plan.name} · the requested unit is outlined</span>
              </>
            ) : (
              <div className="bk-empty bk-empty-lg"><Mi>map</Mi><b>Not on a floor plan</b><span>This unit has no place on a drawn floor yet.</span></div>
            )}
          </div>

          <div className="rqm-side">
            <div className="acx-dgrid">
              <div className="acx-df"><span className="bk-cap"><Mi>person</Mi>Client</span>{r.clientName || '—'}</div>
              <div className="acx-df"><span className="bk-cap"><Mi>call</Mi>Phone</span>{r.clientPhone ? <a href={`tel:${r.clientPhone}`}>{r.clientPhone}</a> : '—'}</div>
              <div className="acx-df"><span className="bk-cap"><Mi>support_agent</Mi>Requested by</span>{r.agentName || '—'}</div>
              <div className="acx-df"><span className="bk-cap"><Mi>payments</Mi>Deal value</span>{r.dealTotal ? fmtBDT(r.dealTotal) : '—'}</div>
              <div className="acx-df"><span className="bk-cap"><Mi>schedule</Mi>Requested</span>{fmtAgo(r.createdAt)}<i className="rqm-sub">{day(r.createdAt)}</i></div>
              <div className="acx-df"><span className="bk-cap"><Mi>lock_clock</Mi>{r.status === 'pending' ? 'Hold until' : 'Held until'}</span>{r.holdUntil ? day(r.holdUntil) : r.status === 'pending' ? 'Set when approved (2 days)' : '—'}</div>
              {r.status !== 'pending' && <div className="acx-df"><span className="bk-cap"><Mi>gavel</Mi>Decided by</span>{r.decidedBy || '—'}<i className="rqm-sub">{day(r.decidedAt)}</i></div>}
              {shop && <div className="acx-df"><span className="bk-cap"><Mi>home_work</Mi>The unit now</span>
                <span className={`bk-pill s-${shop.status}`} style={shop.look.color ? { '--bk-c': shop.look.color } : undefined}><i className="bk-dot" />{shop.look.label}</span></div>}
            </div>

            {shop && (
              <div className="rqm-facts">
                {shop.size ? <span><b>{shop.size.toLocaleString('en-IN')}</b> sq ft</span> : null}
                {shop.beds ? <span><b>{shop.beds}</b> bed{shop.beds > 1 ? 's' : ''}</span> : null}
                {shop.type ? <span>{shop.type}</span> : null}
                {shop.clientName ? <span>held for <b>{shop.clientName}</b></span> : null}
              </div>
            )}
          </div>
        </div>

        <footer className="pw-foot">
          <div className="pw-acts">
            <button type="button" className="bk-btn" onClick={onOpenBooking} disabled={!plan}><Mi>event_seat</Mi>Open in Booking</button>
            <button type="button" className="bk-btn" onClick={onOpenConsole}><Mi>folder_open</Mi>Project</button>
          </div>
          <div className="pw-acts">
            {r.status === 'pending' ? (
              <>
                <button type="button" className="bk-btn" onClick={() => onDecide(r, false)}><Mi>close</Mi>Reject</button>
                <button type="button" className="bk-btn primary" onClick={() => onDecide(r, true)}><Mi>check</Mi>Approve</button>
              </>
            ) : (r.status === 'held' || shop?.status === 'hold') && onUnhold ? (
              <>
                <button type="button" className="bk-btn" onClick={onClose}>Keep on hold</button>
                <button type="button" className="bk-btn primary" onClick={() => onUnhold(r)}><Mi>lock_open</Mi>Unhold</button>
              </>
            ) : <button type="button" className="bk-btn primary" onClick={onClose}>Done</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
