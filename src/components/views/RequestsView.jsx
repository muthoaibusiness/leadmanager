import { useApp } from '../../context/AppContext.jsx';
import useNavState from '../../hooks/useNavState.js';
import { getHoldRequests, decideHoldRequest } from '../../lib/db.js';
import { setUnitStatus, reservedTag, getProjectById, findUnit } from '../../lib/projects.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import Mi from '../Mi.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import '../booking/ShopBooking.css';

// Management approval queue for agent hold requests. Same look as the Booking
// page (see the .bk tokens in booking/ShopBooking.css): a search box, status
// chips, project / agent filters, a sort and a paged table. The whole list is
// in the local store, so filtering, sorting and paging happen here.

const STATUSES = [
  ['pending', 'Pending'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];
const SORTS = [
  ['new', 'Newest first'],
  ['old', 'Oldest first'],
  ['value', 'Highest value'],
  ['client', 'Client A–Z'],
];
const SIZES = [10, 25, 50];
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export default function RequestsView() {
  const { user, refreshDB, showToast, dbVersion, setPropSel, openModal } = useApp();
  void dbVersion;
  const [status, setStatus] = useNavState('requests.status', 'pending');
  const [q, setQ] = useNavState('requests.q', '');
  const [project, setProject] = useNavState('requests.project', '');
  const [agent, setAgent] = useNavState('requests.agent', '');
  const [sort, setSort] = useNavState('requests.sort', 'new');
  const [size, setSize] = useNavState('requests.size', 25);
  const [page, setPage] = useNavState('requests.page', 0);

  const all = getHoldRequests();
  const count = (k) => (k === 'all' ? all.length : all.filter(r => r.status === k).length);
  const projects = [...new Set(all.map(r => r.propertyName).filter(Boolean))].sort();
  const agents = [...new Set(all.map(r => r.agentName).filter(Boolean))].sort();

  const needle = q.trim().toLowerCase();
  const rows = all
    .filter(r => status === 'all' || r.status === status)
    .filter(r => !project || r.propertyName === project)
    .filter(r => !agent || r.agentName === agent)
    .filter(r => !needle || [r.clientName, r.clientPhone, r.propertyName, r.unitId, r.variantName, r.agentName]
      .some(v => String(v ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => {
      if (sort === 'old') return String(a.createdAt).localeCompare(String(b.createdAt));
      if (sort === 'value') return (b.dealTotal || 0) - (a.dealTotal || 0);
      if (sort === 'client') return String(a.clientName || '').localeCompare(String(b.clientName || ''));
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * size, cur * size + size);
  const from = rows.length ? cur * size + 1 : 0;
  const filtered = !!(needle || project || agent);

  // Changing any filter returns to page 1 (done in the handlers, never on mount,
  // so a page restored by Back or a reload survives).
  const setF = (fn) => (v) => { fn(v); setPage(0); };
  const clear = () => { setQ(''); setProject(''); setAgent(''); setPage(0); };

  const decide = (r, ok) => {
    const updated = decideHoldRequest(r.id, ok, user);
    const proj = getProjectById(r.propertyId);
    // Keep the lead id the hold was placed with, so the unit still links to its prospect.
    const clientId = findUnit(proj, r.unitId)?.unit.clientId || null;
    if (ok && updated) setUnitStatus(r.propertyId, r.variantId, r.unitId, 'hold', { user, client: { id: clientId, name: r.clientName }, holdUntil: updated.holdUntil, note: 'Booked by management', tag: reservedTag(proj) });
    else setUnitStatus(r.propertyId, r.variantId, r.unitId, 'available', { user });
    refreshDB();
    showToast(ok ? `Hold approved · Unit ${r.unitId}` : `Request rejected · Unit ${r.unitId}`, 'ok');
  };
  const open = (r) => { setPropSel(r.propertyId); openModal('project-console'); };

  return (
    <div className="bk rqx">
      <div className="rqx-wrap">
        <div className="rqx-bar">
          <label className="bk-search rqx-search">
            <Mi>search</Mi>
            <input value={q} onChange={e => setF(setQ)(e.target.value)} placeholder="Search client, phone, project, unit or agent" aria-label="Search requests" />
            {q && <button type="button" className="bk-close" aria-label="Clear search" onClick={() => setF(setQ)('')}><Mi>close</Mi></button>}
          </label>
          <div className="rqx-chips" role="group" aria-label="Status">
            {STATUSES.map(([k, label]) => (
              <button key={k} type="button" className="bk-chip" aria-pressed={status === k} onClick={() => setF(setStatus)(k)}>
                {label}<i>{count(k)}</i>
              </button>
            ))}
          </div>
          <div className="rqx-sels">
            <BkSelect label="Project" value={project} onChange={setF(setProject)} options={[{ value: '', label: 'All projects' }, ...projects.map(p => ({ value: p, label: p }))]} />
            <BkSelect label="Agent" value={agent} onChange={setF(setAgent)} options={[{ value: '', label: 'All agents' }, ...agents.map(a => ({ value: a, label: a }))]} />
            <BkSelect label="Sort by" value={sort} onChange={setF(setSort)} align="right" options={SORTS.map(([k, l]) => ({ value: k, label: l }))} />
          </div>
        </div>

        <section className="rqx-card" aria-label="Hold requests">
          {rows.length === 0 ? (
            <div className="bk-empty bk-empty-lg">
              <Mi>{filtered || status !== 'pending' ? 'search_off' : 'check_circle'}</Mi>
              <b>{filtered ? 'No request matches' : status === 'pending' ? 'No pending requests' : 'Nothing here yet'}</b>
              <span>{filtered ? 'Try a different word or clear the filters.' : 'New hold requests from agents show up here.'}</span>
              {filtered && <button type="button" className="bk-btn" onClick={clear}>Clear filters</button>}
            </div>
          ) : (
            <div className="rqx-scroll">
              <table className="rqx-table">
                <thead>
                  <tr><th>Client</th><th>Unit</th><th>Agent</th><th className="r">Value</th><th>Requested</th><th>Status</th><th aria-label="Actions" /></tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.id} className={`rqx-${r.status}`} onClick={() => open(r)}>
                      <td>
                        <b className="rqx-client">{r.clientName || '—'}</b>
                        {r.clientPhone && <span className="rqx-sub">{r.clientPhone}</span>}
                      </td>
                      <td>
                        <b className="rqx-mono">{r.unitId}</b>
                        <span className="rqx-sub">{r.propertyName}{r.variantName ? ` · ${r.variantName}` : ''}</span>
                      </td>
                      <td>{r.agentName || '—'}</td>
                      <td className="r rqx-mono">{r.dealTotal ? fmtBDT(r.dealTotal) : '—'}</td>
                      <td>
                        {fmtAgo(r.createdAt)}
                        {r.holdUntil && <span className="rqx-sub">hold until {day(r.holdUntil)}</span>}
                      </td>
                      <td><span className={`bk-pill rqx-st-${r.status}`}><i className="bk-dot" />{r.status}</span></td>
                      <td className="rqx-acts" onClick={e => e.stopPropagation()}>
                        {r.status === 'pending' && (
                          <>
                            <button type="button" className="bk-btn rqx-b" onClick={() => decide(r, false)}><Mi>close</Mi>Reject</button>
                            <button type="button" className="bk-btn primary rqx-b" onClick={() => decide(r, true)}><Mi>check</Mi>Approve</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rqx-foot">
            <span className="bk-cap">{rows.length ? `${from}–${from + shown.length - 1} of ${rows.length}` : '0 requests'}</span>
            <label className="rqx-size bk-cap">Rows
              <BkSelect label="Rows per page" value={size} onChange={v => { setSize(Number(v)); setPage(0); }} options={SIZES.map(n => ({ value: n, label: String(n) }))} />
            </label>
            <div className="rqx-pager" role="group" aria-label="Pages">
              <button type="button" className="bk-zbtn" aria-label="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)}><Mi>chevron_left</Mi></button>
              <span className="bk-zbtn wide rqx-pg">{cur + 1} / {pages}</span>
              <button type="button" className="bk-zbtn" aria-label="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><Mi>chevron_right</Mi></button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
