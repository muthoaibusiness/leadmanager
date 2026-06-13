import { useState, useEffect } from 'react';
import Mi from './Mi.jsx';
import Pagination from './Pagination.jsx';
import { fmtD, fmtBDT } from '../lib/helpers.js';
import { SRC_LABELS, STATUS_LABELS, ROLES } from '../lib/constants.js';
import { useApp } from '../context/AppContext.jsx';
import { bulkDeleteLeads } from '../lib/db.js';

const PAGE_SIZE = 15;

function sclass(s) { return 's-' + (s || '').toLowerCase(); }
function srcclass(s) { return 'src-' + (s || '').toLowerCase(); }
function leadCode(l) { return l.externalId || ('#' + String(l.id || '').slice(-6).toUpperCase()); }

export default function LeadTable({ leads }) {
  const { setPanLead, user, refreshDB, showToast, sortBy } = useApp();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  // multi-select bulk delete available to every role that manages leads
  const canSelect = !!user && user.role !== ROLES.MASTER;

  const CMP = {
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    updated: (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  };
  const sorted = [...leads].sort(CMP[sortBy] || CMP.newest);

  useEffect(() => { setPage(0); setSelected(new Set()); }, [leads.length, leads.map(l => l.id).join()]);

  const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // select-all applies to the CURRENT page only
  const allSelected = slice.length > 0 && slice.every(l => selected.has(l.id));
  function toggleAll() {
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) slice.forEach(l => n.delete(l.id));
      else slice.forEach(l => n.add(l.id));
      return n;
    });
  }

  function toggleOne(id, e) {
    e.stopPropagation();
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleBulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} customer${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    bulkDeleteLeads(ids, user);
    setSelected(new Set());
    refreshDB();
    showToast(`${ids.length} customer${ids.length > 1 ? "s" : ""} deleted`, 'ok');
  }

  if (!leads.length) {
    return (
      <div className={`lt${canSelect ? ' lt-with-cb' : ''}`}>
        <div className="lt-hdr">
          {canSelect && <div className="lt-cb-col" />}
          <div>Lead ID</div><div>Customer Name</div><div>Source</div><div>Property</div><div>Status</div><div>Create date</div>
        </div>
        <div className="empty"><Mi>inbox</Mi><p>No customers here</p></div>
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
      <div className={`lt${canSelect ? ' lt-with-cb' : ''}`}>
        <div className="lt-hdr">
          {canSelect && (
            <div className="lt-cb-col" onClick={toggleAll} title={allSelected ? 'Clear all' : 'Select all'}>
              <input type="checkbox" checked={allSelected} onChange={() => {}} onClick={(e) => { e.stopPropagation(); toggleAll(); }} />
            </div>
          )}
          <div>Lead ID</div><div>Customer Name</div><div>Source</div><div>Property</div><div>Status</div><div>Create date</div>
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
              <span className="lt-id">{leadCode(l)}</span>
            </div>
            <div className="lt-cell">
              <div style={{ minWidth: 0 }}>
                <div className="lt-n">{l.name}</div>
                <div className="lt-sub">{l.phone}</div>
              </div>
            </div>
            <div className="lt-cell">
              <span className="lt-src">{SRC_LABELS[l.source] || l.source || '—'}</span>
            </div>
            <div className="lt-cell">
              <div style={{ minWidth: 0 }}>
                <div className="lt-prop">{l.propertyInterest || '—'}</div>
                <div className="lt-sub">{l.budget ? fmtBDT(l.budget) : ''}</div>
              </div>
            </div>
            <div className="lt-cell">
              <span className={`bdg ${sclass(l.status)}`}>{STATUS_LABELS[l.status] || l.status}</span>
            </div>
            <div className="lt-cell">
              <span className="lt-date">{fmtD(l.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={leads.length} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
}
