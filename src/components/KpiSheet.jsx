import { useEffect, useState } from 'react';
import Mi from './Mi.jsx';
import { LoadingBlock, LoadingBar } from './Spinner.jsx';
import Pagination from './Pagination.jsx';
import { queryLeads } from '../lib/db.js';
import { leadDisplayStatus, fmtDT } from '../lib/helpers.js';
import useChanged from '../hooks/useChanged.js';

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
  const [doneKey, setDoneKey] = useState(null);

  const query = detail?.query || null;
  const qKey = query ? JSON.stringify({ ...query, user: query.user?.id }) : null;
  // Local-mode (leads/rows already in hand) has no query to key off of — key
  // off the card instead, so switching cards also resets to page 1.
  const resetKey = qKey || (detail ? detail.title + ':' + (detail.leads?.length ?? detail.rows?.length ?? 0) : null);

  // A new card resets to page 1; the sheet is reused across cards.
  if (useChanged(resetKey)) { setPage(0); setFetched(null); }

  // Loading means the page on screen is not the one last fetched.
  const fetchKey = query ? `${qKey}|${page}|${detail.sort || 'newest'}` : null;
  const loading = !!fetchKey && doneKey !== fetchKey;

  useEffect(() => {
    if (!query) return;
    let alive = true;
    queryLeads(query, { page, size: PAGE_SIZE, sort: detail.sort || 'newest' }).then(res => {
      if (!alive) return;
      if (res) setFetched(res);
      setDoneKey(fetchKey);
    });
    return () => { alive = false; };
    // qKey stands in for `query`: a fresh object each render would refetch forever.
  }, [qKey, page, detail?.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) return null;
  const { title } = detail;

  const source = query ? (fetched?.rows || []) : (detail.leads || []);
  // `hasOffer` marks a list whose every row carries an offer (the Team Lead
  // closing pipeline), for the badge overlay — see leadDisplayStatus.
  const rows = detail.rows || source.map(l => {
    const ds = leadDisplayStatus(l, detail.hasOffer ? { hasOffer: true } : {});
    return { leadId: l.id, title: l.name || 'Unnamed', sub: l.phone || '', badge: ds };
  });
  // Server mode knows the real total even before the rows arrive; local mode's
  // total is simply how many it was handed.
  const total = query ? (fetched?.total ?? detail.total ?? 0) : rows.length;
  const paged = total > PAGE_SIZE;
  // Server mode already fetches one page at a time; local mode has the whole
  // array in hand, so slice it client-side instead of rendering it all at once.
  const pageRows = query ? rows : rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="kpi-ov" onClick={(e) => { if (e.target.classList.contains('kpi-ov')) onClose(); }}>
      <div className="kpi-sheet">
        <div className="kpi-sheet-hd">
          <span>{title} <b>{total}</b></span>
          <button className="kpi-x" onClick={onClose}><Mi>close</Mi></button>
        </div>
        <div className={`kpi-list${loading ? ' kpi-busy' : ''}`}>
          {loading && pageRows.length > 0 && <LoadingBar />}
          {pageRows.length ? pageRows.map((it, i) => (
            <button key={it.leadId || i} className="kpi-row" onClick={() => it.leadId && onLead && onLead(it.leadId)}>
              {it.icon && <span className="kpi-ic"><Mi>{it.icon}</Mi></span>}
              <span className="kpi-rtx">
                <b>{it.title}</b>
                {it.sub && <small>{it.ts ? fmtDT(it.ts) : it.sub}</small>}
              </span>
              {it.badge ? <span className={`bdg ${it.badge.cls}`}>{it.badge.label}</span>
                : it.right ? <span className="kpi-rt">{it.right}</span> : null}
            </button>
          )) : loading ? <LoadingBlock /> : <div className="kpi-empty">Nothing here yet.</div>}
        </div>
        {paged && <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </div>
    </div>
  );
}
