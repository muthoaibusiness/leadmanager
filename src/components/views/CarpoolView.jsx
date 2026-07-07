import { useApp } from '../../context/AppContext.jsx';
import { getCarpoolRequests, decideCarpoolRequest } from '../../lib/db.js';
import { fmtDateTimeAP } from '../../lib/helpers.js';
import Mi from '../Mi.jsx';

const STATUS = {
  pending: { cls: 's-meeting_set', label: 'Pending' },
  approved: { cls: 's-deal_closed_won', label: 'Approved' },
  rejected: { cls: 's-not_interested', label: 'Rejected' },
};

export default function CarpoolView() {
  const { user, setPanLead, refreshDB, showToast, dbVersion } = useApp();
  void dbVersion;
  const reqs = getCarpoolRequests();
  const pending = reqs.filter(r => r.status === 'pending').length;

  const decide = (id, ok) => {
    decideCarpoolRequest(id, ok, user);
    refreshDB();
    showToast(ok ? 'Carpool approved' : 'Carpool rejected', ok ? 'ok' : 'warn');
  };

  if (!reqs.length) {
    return <div className="empty"><Mi>directions_car</Mi><p>No carpool requests yet</p></div>;
  }

  return (
    <div className="cpool">
      <div className="cpool-sum">{pending} pending · {reqs.length} total</div>
      <div className="cpool-tbl">
        <div className="cpool-hd">
          <div>Agent</div><div>Client</div><div>Visit</div><div>Projects</div><div>Status</div><div className="cpool-act-h">Action</div>
        </div>
        {reqs.map(r => {
          const st = STATUS[r.status] || STATUS.pending;
          return (
            <div key={r.id} className="cpool-row">
              <div data-l="Agent">{r.agentName}</div>
              <div data-l="Client">
                {r.leadId
                  ? <button className="cpool-link" onClick={() => setPanLead(r.leadId)}>{r.clientName || '—'}</button>
                  : (r.clientName || '—')}
              </div>
              <div data-l="Visit">{r.visitDate ? fmtDateTimeAP(r.visitDate) : '—'}</div>
              <div data-l="Projects">{(r.projects || []).map(p => p.name).join(', ') || '—'}</div>
              <div data-l="Status"><span className={`bdg ${st.cls}`}>{st.label}</span></div>
              <div data-l="Action" className="cpool-act">
                {r.status === 'pending' ? (
                  <>
                    <button className="btn btn-success btn-sm" onClick={() => decide(r.id, true)}><Mi>check</Mi>Accept</button>
                    <button className="btn btn-sm" style={{ background: 'var(--red-l)', color: 'var(--red)' }} onClick={() => decide(r.id, false)}><Mi>close</Mi>Reject</button>
                  </>
                ) : (
                  <span className="cpool-decided">{r.decidedBy ? 'by ' + r.decidedBy : '—'}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
