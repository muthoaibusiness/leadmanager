import { useState, useEffect } from 'react';
import Mi from './Mi.jsx';
import Pagination from './Pagination.jsx';
import { avc, ini, fmtAgo, fmtBDT } from '../lib/helpers.js';
import { SRC_LABELS, STATUS_LABELS } from '../lib/constants.js';
import { useApp } from '../context/AppContext.jsx';

const PAGE_SIZE = 15;

function sclass(s) { return 's-' + (s || '').toLowerCase(); }
function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }

export default function LeadTable({ leads }) {
  const { setPanLead } = useApp();
  const [page, setPage] = useState(0);

  // sort newest first
  const sorted = [...leads].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // reset to page 0 when leads list changes (tab/search/filter)
  useEffect(() => { setPage(0); }, [leads.length, leads.map(l => l.id).join()]);

  const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!leads.length) {
    return (
      <div className="lt">
        <div className="lt-hdr">
          <div>Lead</div><div>Property / Budget</div><div>Source</div><div>Status</div><div>Updated</div><div></div>
        </div>
        <div className="empty"><Mi>inbox</Mi><p>No leads here</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="lt">
        <div className="lt-hdr">
          <div>Lead</div><div>Property / Budget</div><div>Source</div><div>Status</div><div>Updated</div><div></div>
        </div>
        {slice.map(l => (
          <div key={l.id} className="lt-row" onClick={() => setPanLead(l.id)}>
            <div className="lt-cell">
              <div className="lt-av" style={{ background: avc(l.name), borderRadius: '8px' }}>{ini(l.name)}</div>
              <div>
                <div className="lt-n">{l.name}</div>
                <div className="lt-sub">{l.phone}</div>
              </div>
            </div>
            <div className="lt-cell">
              <div>
                <div className="lt-n" style={{ fontSize: '12px' }}>{l.propertyInterest || '—'}</div>
                <div className="lt-sub">{l.budget ? fmtBDT(l.budget) : ''}</div>
              </div>
            </div>
            <div className="lt-cell">
              <span className={`bdg ${srcclass(l.source)}`}>{SRC_LABELS[l.source] || l.source}</span>
            </div>
            <div className="lt-cell">
              <span className={`bdg ${sclass(l.status)}`}>{STATUS_LABELS[l.status] || l.status}</span>
            </div>
            <div className="lt-cell">
              <span className="lt-date">{fmtAgo(l.updatedAt)}</span>
            </div>
            <div className="lt-cell">
              <div className="lt-arr"><Mi>chevron_right</Mi></div>
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={leads.length} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}
