import { useState, useEffect } from 'react';
import Mi from './Mi.jsx';
import Pagination from './Pagination.jsx';
import { avc, ini, fmtAgo, fmtBDT } from '../lib/helpers.js';
import { SRC_LABELS, STATUS_LABELS, ROLES } from '../lib/constants.js';
import { useApp } from '../context/AppContext.jsx';
import { bulkDeleteLeads } from '../lib/db.js';

const PAGE_SIZE = 15;

function sclass(s) { return 's-' + (s || '').toLowerCase(); }
function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }

export default function LeadTable({ leads }) {
  const { setPanLead, user, refreshDB, showToast } = useApp();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const canSelect = user?.role === ROLES.IA;

  const sorted = [...leads].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  useEffect(() => { setPage(0); setSelected(new Set()); }, [leads.length, leads.map(l => l.id).join()]);

  const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleOne(id, e) {
    e.stopPropagation();
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} lead${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    bulkDeleteLeads(ids, user);
    setSelected(new Set());
    refreshDB();
    showToast(`${ids.length} lead${ids.length > 1 ? 's' : ''} deleted`, 'ok');
  }

  if (!leads.length) {
    return (
      <div className="lt">
        <div className="lt-hdr">
          {canSelect && <div className="lt-cb-col" />}
          <div>Lead</div><div>Property / Budget</div><div>Source</div><div>Status</div><div>Updated</div><div></div>
        </div>
        <div className="empty"><Mi>inbox</Mi><p>No leads here</p></div>
      </div>
    );
  }

  return (
    <div>
      {canSelect && selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-ct">{selected.size} selected</span>
          <button className="btn btn-sm" style={{ background: 'var(--red-l)', color: 'var(--red)' }} onClick={handleBulkDelete}>
            <Mi>delete</Mi>Delete Selected
          </button>
          <button className="btn btn-g btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <div className="lt">
        <div className="lt-hdr">
          {canSelect && <div className="lt-cb-col" />}
          <div>Lead</div><div>Property / Budget</div><div>Source</div><div>Status</div><div>Updated</div><div></div>
        </div>
        {slice.map(l => (
          <div key={l.id} className={`lt-row${selected.has(l.id) ? ' lt-sel' : ''}`}
            onClick={() => selected.size > 0 && canSelect ? toggleOne(l.id, { stopPropagation: () => {} }) : setPanLead(l.id)}>
            {canSelect && (
              <div className="lt-cb-col" onClick={e => toggleOne(l.id, e)}>
                <input type="checkbox" checked={selected.has(l.id)} onChange={() => {}} onClick={e => toggleOne(l.id, e)} />
              </div>
            )}
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
