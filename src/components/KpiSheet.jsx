import { useEffect, useState } from 'react';
import Mi from './Mi.jsx';
import Pagination from './Pagination.jsx';
import { queryLeads } from '../lib/db.js';
import { leadDisplayStatus, fmtDT } from '../lib/helpers.js';

const PAGE_SIZE = 15;

// Shared drill-down sheet for clickable KPI cards. Three shapes:
//   { title, query: {...} }   → FETCH the matching leads, 15 at a time. The KPI
//                               card shows a server-side count, so the rows
//                               behind it are downloaded only once someone asks
//                               to see them — which is the whole point of the
//                               card being a link rather than a list.
//   { title, leads: [...] }   → list leads already in hand (name · phone · status)
//   { title, rows: [...] }    → custom rows, e.g. calls
//
// `query` is a leadQuery opts object; `total` may be passed alongside it to show
// the count the card already knows while the first page is still in flight.
export default function KpiSheet({ detail, onClose, onLead }) {
  const [page, setPage] = useState(0);
  const [fetched, setFetched] = useState(null);
  const [loading, setLoading] = useState(false);

  const query = detail?.query || null;
  const qKey = query ? JSON.stringify({ ...query, user: query.user?.id }) : null;

  // A new card resets to page 1; the sheet is reused across cards.
  useEffect(() => { setPage(0); setFetched(null); }, [qKey]);

  useEffect(() => {
    if (!query) return;
    let alive = true;
    setLoading(true);
    queryLeads(query, { page, size: PAGE_SIZE, sort: detail.sort || 'newest' }).then(res => {
      if (!alive) return;
      if (res) setFetched(res);
      setLoading(false);
    });
    return () => { alive = false; };
    // qKey stands in for `query`: a fresh object each render would refetch forever.
  }, [qKey, page, detail?.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) return null;
  const { title } = detail;

  const source = query ? (fetched?.rows || []) : (detail.leads || []);
  const rows = detail.rows || source.map(l => {
    const ds = leadDisplayStatus(l);
    return { leadId: l.id, title: l.name || 'Unnamed', sub: l.phone || '', badge: ds };
  });
  // Server mode knows the real total even before the rows arrive; local mode's
  // total is simply how many it was handed.
  const total = query ? (fetched?.total ?? detail.total ?? 0) : rows.length;
  const paged = query && total > PAGE_SIZE;

  return (
    <div className="kpi-ov" onClick={(e) => { if (e.target.classList.contains('kpi-ov')) onClose(); }}>
      <div className="kpi-sheet">
        <div className="kpi-sheet-hd">
          <span>{title} <b>{total}</b></span>
          <button className="kpi-x" onClick={onClose}><Mi>close</Mi></button>
        </div>
        <div className={`kpi-list${loading ? ' kpi-busy' : ''}`}>
          {rows.length ? rows.map((it, i) => (
            <button key={it.leadId || i} className="kpi-row" onClick={() => it.leadId && onLead && onLead(it.leadId)}>
              {it.icon && <span className="kpi-ic"><Mi>{it.icon}</Mi></span>}
              <span className="kpi-rtx">
                <b>{it.title}</b>
                {it.sub && <small>{it.ts ? fmtDT(it.ts) : it.sub}</small>}
              </span>
              {it.badge ? <span className={`bdg ${it.badge.cls}`}>{it.badge.label}</span>
                : it.right ? <span className="kpi-rt">{it.right}</span> : null}
            </button>
          )) : <div className="kpi-empty">{loading ? 'Loading…' : 'Nothing here yet.'}</div>}
        </div>
        {paged && <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </div>
    </div>
  );
}
