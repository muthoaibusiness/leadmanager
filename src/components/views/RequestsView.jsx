import { useApp } from '../../context/AppContext.jsx';
import { canCustomers, canPrices, canUnitStatus } from '../../lib/constants.js';
import useNavState from '../../hooks/useNavState.js';
import { useState } from 'react';
import { getHoldRequests, decideHoldRequest } from '../../lib/db.js';
import { setUnitStatus, reservedTag, getProjectById, findUnit, listProjects, maskRequest } from '../../lib/projects.js';
import { fmtBDT, fmtAgo } from '../../lib/helpers.js';
import Mi from '../Mi.jsx';
import BkSelect from '../booking/BkSelect.jsx';
import RequestsInsights from './RequestsInsights.jsx';
import RequestUnitModal from './RequestUnitModal.jsx';
import RequestsHeld from './RequestsHeld.jsx';
import { seedNextPage } from '../../hooks/useNavHistory.js';
import '../booking/ShopBooking.css';

// Management approval queue for agent hold requests. Same look as the Booking
// page (see the .bk tokens in booking/ShopBooking.css): a search box, status
// chips, project / agent filters, a sort and a paged table. The whole list is
// in the local store, so filtering, sorting and paging happen here.

const STATUSES = [
  ['pending', 'Pending'],
  ['approved', 'On hold'],
  ['sold', 'Sold'],
  ['released', 'Released'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];
const STATE_LABEL = { pending: 'Pending', approved: 'On hold', sold: 'Sold', released: 'Released', rejected: 'Rejected' };
const SORTS = [
  ['new', 'Newest first'],
  ['old', 'Oldest first'],
  ['value', 'Highest value'],
  ['client', 'Client A–Z'],
];
const SIZES = [10, 25, 50];
const stamp = () => Date.now();

// Where an approved request stands now, read from its unit: still held, sold, or released
// (unheld from Booking or here, or expired). The stored status stays 'approved'; the
// Insights figures count approvals from it.
function stateOf(r) {
  if (r.status !== 'approved') return r.status;
  const st = findUnit(getProjectById(r.propertyId), r.unitId)?.unit.status;
  return st === 'hold' ? 'approved' : st === 'sold' ? 'sold' : 'released';
}
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export default function RequestsView() {
  const { user, refreshDB, showToast, dbVersion, setPropSel, openModal, nav, setBookProj } = useApp();
  void dbVersion;
  const [tab, setTab] = useNavState('requests.tab', 'queue');
  const [openId, setOpenId] = useState(null); // the request shown in the pop-up
  const [openHeld, setOpenHeld] = useState(null); // a held unit shown in the same pop-up
  const [status, setStatus] = useNavState('requests.status', 'pending');
  const [q, setQ] = useNavState('requests.q', '');
  const [project, setProject] = useNavState('requests.project', '');
  const [agent, setAgent] = useNavState('requests.agent', '');
  const [sort, setSort] = useNavState('requests.sort', 'new');
  const [size, setSize] = useNavState('requests.size', 25);
  const [page, setPage] = useNavState('requests.page', 0);

  const access = { customers: canCustomers(user), prices: canPrices(user) };
  const mayStatus = canUnitStatus(user); // unhold here changes a unit's status directly
  const all = getHoldRequests().map(r => ({ ...maskRequest(r, access), state: stateOf(r) }));
  const [now] = useState(stamp);
  const heldCount = listProjects().reduce((n, p) => n + (p.variants || []).reduce((m, v) => m + (v.units || []).filter(u => u.status === 'hold').length, 0), 0);
  const count = (k) => (k === 'all' ? all.length : all.filter(r => r.state === k).length);
  const projects = [...new Set(all.map(r => r.propertyName).filter(Boolean))].sort();
  const agents = [...new Set(all.map(r => r.agentName).filter(Boolean))].sort();

  const needle = q.trim().toLowerCase();
  const rows = all
    .filter(r => status === 'all' || r.state === status)
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

  const decide = (shown, ok) => {
    // the stored request, not the masked row: approving copies its client onto the unit
    const r = getHoldRequests().find(x => x.id === shown.id) || shown;
    const updated = decideHoldRequest(r.id, ok, user);
    const proj = getProjectById(r.propertyId);
    // Keep the lead id the hold was placed with, so the unit still links to its prospect.
    const clientId = findUnit(proj, r.unitId)?.unit.clientId || null;
    if (ok && updated) setUnitStatus(r.propertyId, r.variantId, r.unitId, 'hold', { user, client: { id: clientId, name: r.clientName }, holdUntil: updated.holdUntil, note: 'Booked by management', tag: reservedTag(proj) });
    else setUnitStatus(r.propertyId, r.variantId, r.unitId, 'available', { user });
    refreshDB();
    showToast(ok ? `Hold approved · Unit ${r.unitId}` : `Request rejected · Unit ${r.unitId}`, 'ok');
  };
  // A request opens as a pop-up over this page: the floor plan with its unit pointed out, and the
  // request beside it. From there it can still go to the Booking page or the project console.
  const open = (r) => setOpenId(r.id);
  const opened = openId ? all.find(x => x.id === openId) : openHeld;
  // a held unit opens in the request pop-up, shaped like a request (no decision buttons)
  const openHeldUnit = (h) => setOpenHeld({ ...(h.req || {}), id: h.key, propertyId: h.projectId, propertyName: h.project, variantId: h.variantId, unitId: h.unitId,
    clientName: h.client, clientPhone: h.phone, agentName: h.by, createdAt: h.req?.createdAt || h.start, holdUntil: h.left == null ? null : new Date(now + h.left).toISOString(), status: 'held' });
  const closePop = () => { setOpenId(null); setOpenHeld(null); };
  const unholdUnit = (h) => {
    setUnitStatus(h.propertyId, h.variantId, h.unitId, 'available', { user });
    all.filter(x => x.propertyId === h.propertyId && x.unitId === h.unitId && x.status === 'pending').forEach(x => decideHoldRequest(x.id, false, user));
    closePop();
    refreshDB();
    showToast(`Unit ${h.unitId} is available again`, 'ok');
  };
  const toBooking = (r) => {
    const proj = getProjectById(r.propertyId);
    const plan = (proj?.floorPlans || []).find(p => (p.boxes || []).some(b => b.unitId === r.unitId));
    if (!proj || !plan) return;
    seedNextPage({ 'booking.floor': plan.id, 'booking.shop': r.unitId, 'booking.ptab': 'booking' });
    setOpenId(null);
    nav('booking');
    setBookProj(proj.id);
  };

  return (
    <div className="bk rqx">
      <div className="rqx-wrap">
        <div className="rqx-tabs" role="tablist" aria-label="Requests">
          <button type="button" role="tab" className="bk-chip" aria-selected={tab === 'queue'} aria-pressed={tab === 'queue'} onClick={() => setTab('queue')}><Mi>inbox</Mi>Queue<i>{count('pending')}</i></button>
          <button type="button" role="tab" className="bk-chip" aria-selected={tab === 'held'} aria-pressed={tab === 'held'} onClick={() => setTab('held')}><Mi>lock_clock</Mi>Held units<i>{heldCount}</i></button>
          <button type="button" role="tab" className="bk-chip" aria-selected={tab === 'insights'} aria-pressed={tab === 'insights'} onClick={() => setTab('insights')}><Mi>insights</Mi>Insights</button>
        </div>
        {tab === 'held' ? <RequestsHeld all={all} user={user} access={access} mayStatus={mayStatus} refreshDB={refreshDB} showToast={showToast} onOpen={openHeldUnit} /> : tab === 'insights' ? <RequestsInsights all={all} onQueue={(k) => { setStatus(k); setPage(0); setTab('queue'); }} /> : (<>
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
                    <tr key={r.id} className={`rqx-${r.state}`} onClick={() => open(r)}>
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
                        {r.holdUntil && r.state === 'approved' && <span className="rqx-sub">hold until {day(r.holdUntil)}</span>}
                      </td>
                      <td><span className={`bk-pill rqx-st-${r.state}`}><i className="bk-dot" />{STATE_LABEL[r.state] || r.state}</span></td>
                      <td className="rqx-acts" onClick={e => e.stopPropagation()}>
                        {r.state === 'approved' && mayStatus && (
                          <button type="button" className="bk-btn rqx-b" onClick={() => unholdUnit(r)}><Mi>lock_open</Mi>Unhold</button>
                        )}
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
        </>)}
      </div>
      {opened && (
        <RequestUnitModal r={opened} onClose={closePop} onUnhold={mayStatus ? unholdUnit : null}
          onDecide={(r, ok) => { decide(r, ok); closePop(); }}
          onOpenBooking={() => toBooking(opened)}
          onOpenConsole={() => { closePop(); setPropSel(opened.propertyId); openModal('project-console'); }} />
      )}
    </div>
  );
}
