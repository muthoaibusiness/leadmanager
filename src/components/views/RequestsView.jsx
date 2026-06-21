import { useApp } from '../../context/AppContext.jsx';
import { getHoldRequests, decideHoldRequest } from '../../lib/db.js';
import { setUnitStatus } from '../../lib/projects.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import Mi from '../Mi.jsx';

// Management approval queue for agent hold requests.
export default function RequestsView() {
  const { user, refreshDB, showToast, dbVersion, setPropSel, openModal } = useApp();
  void dbVersion;
  const reqs = getHoldRequests();
  const pending = reqs.filter(r => r.status === 'pending');
  const decided = reqs.filter(r => r.status !== 'pending').slice(0, 25);

  const decide = (r, ok) => {
    const updated = decideHoldRequest(r.id, ok, user);
    if (ok && updated) setUnitStatus(r.propertyId, r.variantId, r.unitId, 'hold', { user, client: { name: r.clientName }, holdUntil: updated.holdUntil, note: 'Booked by management' });
    else setUnitStatus(r.propertyId, r.variantId, r.unitId, 'available', { user });
    refreshDB();
    showToast(ok ? `Hold approved · Unit ${r.unitId}` : `Request rejected · Unit ${r.unitId}`, 'ok');
  };

  const open = (r) => { setPropSel(r.propertyId); openModal('project-console'); };

  const Card = (r, actions) => (
    <div key={r.id} className={`rq-card rq-${r.status}`}>
      <div className="rq-main" onClick={() => open(r)}>
        <div className="rq-top">
          <span className="rq-client">{r.clientName || '—'}</span>
          <span className={`rq-tag rq-tag-${r.status}`}>{r.status}</span>
        </div>
        <div className="rq-meta">{r.propertyName} · Unit <b>{r.unitId}</b> · {r.variantName}</div>
        <div className="rq-meta2">
          <span><Mi>person</Mi>{r.agentName}</span>
          <span><Mi>payments</Mi>{fmtBDT(r.dealTotal)}</span>
          <span><Mi>schedule</Mi>{fmtAgo(r.createdAt)}</span>
          {r.holdUntil && <span><Mi>event_available</Mi>until {new Date(r.holdUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>}
        </div>
      </div>
      {actions && (
        <div className="rq-acts">
          <button className="btn btn-g btn-sm" onClick={() => decide(r, false)}><Mi>close</Mi>Reject</button>
          <button className="btn btn-p btn-sm" onClick={() => decide(r, true)}><Mi>check</Mi>Approve hold</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="rq">
      <div className="rq-sec-hd"><Mi>inbox</Mi>Pending hold requests <span className="rq-ct">{pending.length}</span></div>
      {pending.length === 0
        ? <div className="empty"><Mi>check_circle</Mi><p>No pending requests</p></div>
        : <div className="rq-list">{pending.map(r => Card(r, true))}</div>}

      {decided.length > 0 && (
        <>
          <div className="rq-sec-hd rq-sec-hd2"><Mi>history</Mi>Recent decisions</div>
          <div className="rq-list">{decided.map(r => Card(r, false))}</div>
        </>
      )}
    </div>
  );
}
