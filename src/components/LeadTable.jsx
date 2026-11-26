import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Mi from './Mi.jsx';
import Avatar from './Avatar.jsx';
import './booking/ShopBooking.css';
import { fmtDateTimeAP, fmtRel, leadDisplayStatus, rlabel, ini, avc } from '../lib/helpers.js';
import { SRC_LABELS, ROLES } from '../lib/constants.js';
import { useApp } from '../context/AppContext.jsx';
import { bulkDeleteLeads, lastFollowupFor, getDB } from '../lib/db.js';
import TransferLeadModal from './modals/TransferLeadModal.jsx';
import useChanged from '../hooks/useChanged.js';
import useFitRows from '../hooks/useFitRows.js';
import './LeadTable.css';

export const PAGE_SIZE = 10; // a page fills the screen with no scrolling (useFitRows), on computers and phones


// One list for the three header copies (loading, empty, rows), so they cannot drift.
const COLS = ['Person', 'Source', 'Property', 'Status', 'Agent', 'Last Activity', 'Next Follow-up', 'Created Date'];

// Last Activity: how long ago the lead was last touched ("3h ago"; exact time on hover) (the newest logged follow-up or note, else its last
// change), with what was logged on line 2. Until the server has answered for this page (still
// loading, or the request failed), a lead with nothing known shows "…" rather than "—", so the cell
// never claims "no activity" without an answer.
function LastActivityCell({ lead, fromServer, pending }) {
  const { fu, note } = lastFollowupFor(lead.id, fromServer);
  const wait = pending && !fromServer;
  const stamps = [fu?.timestamp, note?.timestamp, lead.updatedAt].filter(Boolean).map(t => new Date(t).getTime()).filter(Number.isFinite);
  const at = stamps.length ? new Date(Math.max(...stamps)).toISOString() : '';
  const what = note?.description || fu?.description || '';
  return (
    <div className="lt-two">
      <div style={{ minWidth: 0 }}>
        <div className={`lt-date${at ? ' lt-fu-on' : ''}`} title={at ? fmtDateTimeAP(at) : undefined}>{at ? fmtRel(at) : (wait ? '…' : '—')}</div>
        <div className={`lt-sub${what ? ' lt-fu-on' : ''}`} title={what || undefined}>{what || (wait ? '' : '—')}</div>
      </div>
    </div>
  );
}

const isPast = (t) => t < Date.now();

// Next Follow-up: how long until the scheduled time ("in 3h"), red once it has
// passed ("2d ago" · overdue). The exact date and time is the tooltip.
function NextFollowCell({ lead }) {
  const t = lead.nextFollowup ? new Date(lead.nextFollowup).getTime() : NaN;
  const has = Number.isFinite(t);
  const late = has && isPast(t);
  return (
    <div className="lt-two">
      <div style={{ minWidth: 0 }}>
        <div className={`lt-date${has ? (late ? ' lt-late' : ' lt-fu-on') : ''}`} title={has ? fmtDateTimeAP(lead.nextFollowup) : undefined}>{has ? fmtRel(lead.nextFollowup) : '—'}</div>
        {late && <div className="lt-sub lt-late">overdue</div>}
      </div>
    </div>
  );
}

// Agent: the name, and on hover a card with who they are (role, team, contact, status).
function AgentCell({ lead }) {
  const [at, setAt] = useState(null);
  const ref = useRef(null);
  const id = lead.assignedTo;
  const db = getDB();
  const u = id ? (db.users || []).find(x => x.id === id) : null;
  const name = u?.name || lead.assignedToName || '';
  if (!name) return <span className="lt-sub">Unassigned</span>;
  const team = u ? ((db.teams || []).find(t => t.id === u.teamId) || (db.teams || []).find(t => t.leadId === u.id)) : null;
  const show = () => {
    const r = ref.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 230;
    setAt({ left: Math.min(r.left, window.innerWidth - 300), top: below ? r.bottom + 6 : null, bottom: below ? null : window.innerHeight - r.top + 6 });
  };
  return (
    <div className="lt-agent" title={name} ref={ref} onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)} tabIndex={0}>
      <Avatar name={name} avatar={u?.avatar} className="lt-av lt-av-ag" />
      <span className="lt-agent-n">{name}</span>
      {at && createPortal(
        <div className="lt-agent-card" role="tooltip" style={{ left: at.left, top: at.top ?? undefined, bottom: at.bottom ?? undefined }}>
          <div className="lt-agent-hd">
            <Avatar name={name} avatar={u?.avatar} className="lt-av lg" />
            <div><b>{name}</b><span>{u ? rlabel(u.role) : 'Agent'}</span></div>
          </div>
          <dl>
            {team && <><dt>Team</dt><dd>{team.name}</dd></>}
            {u?.phone && <><dt>Phone</dt><dd>{u.phone}</dd></>}
            {u?.email && <><dt>Email</dt><dd>{u.email}</dd></>}
            <dt>Status</dt><dd>{u && u.isActive === false ? 'Inactive' : 'Active'}</dd>
          </dl>
        </div>, document.body)}
    </div>
  );
}

// Two modes, one table.
//
//   client  (default)  `leads` is the complete result set; sort and slice here.
//                      Used by the drill-downs that already hold their rows.
//   server  (`total` given)  `leads` is ONE PAGE the server already sorted and
//                      sliced, and `total` is how many match overall. Sorting
//                      and slicing here would reorder 15 rows out of thousands
//                      and produce a wrong page, so both are skipped and the
//                      pager reports up to the caller.
export default function LeadTable({ leads, total = null, page: pageProp, onPage, pageSize = PAGE_SIZE, loading = false, lastFu = {}, fuPending = false }) {
  const { setPanLead, setChatTarget, chatOk, user, refreshDB, showToast, sortBy } = useApp();
  const server = total != null;
  const [ownPage, setOwnPage] = useState(0);
  const page = server ? (pageProp || 0) : ownPage;
  const setPage = server ? (onPage || (() => {})) : setOwnPage;
  const [selected, setSelected] = useState(new Set());
  // Bulk transfer reuses the panel's transfer modal, so the selection stays here
  // and the modal only reports back when a transfer actually landed — cancelling
  // must not wipe the checkboxes the admin just ticked.
  const [xferOpen, setXferOpen] = useState(false);
  // Multi-select bulk delete/transfer is Management / Master (admin) only. Real
  // agents — Agent, Team Lead — cannot select leads.
  const canSelect = user?.role === ROLES.MGMT || user?.role === ROLES.MASTER;

  const CMP = {
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    updated: (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  };
  const sorted = server ? leads : [...leads].sort(CMP[sortBy] || CMP.newest);

  // Server mode owns its own page state (the query changes it), so only the
  // selection is cleared here. Resetting the page from inside would fight the
  // caller and bounce the user back to page 1 on every fetch.
  if (useChanged(`${server}|${leads.length}|${leads.map(l => l.id).join()}`)) {
    if (!server) setOwnPage(0);
    setSelected(new Set());
  }

  const slice = server ? sorted : sorted.slice(page * pageSize, (page + 1) * pageSize);
  const cardRef = useRef(null);
  useFitRows(cardRef, pageSize, [slice.length, loading]);

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

  const heads = (
    <tr>
      {canSelect && (
        <th className="lt-c-chk">
          <button type="button" className={`lt-chk${allSelected ? ' on' : ''}`} onClick={toggleAll} role="checkbox" aria-checked={allSelected} aria-label="Select all on this page" disabled={!slice.length}>
            <Mi>{allSelected ? 'check_box' : 'check_box_outline_blank'}</Mi>
          </button>
        </th>
      )}
      {COLS.map((c, i) => <th key={c} className={`lt-h${i}`}>{c}</th>)}
    </tr>
  );
  const first = leads.length ? page * pageSize + 1 : 0;
  const count = server ? total : leads.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const curPage = Math.min(page, pages - 1);
  const last = Math.min(first + slice.length - 1, count);

  return (
    <div className="bk lvx-t">
      {canSelect && selected.size > 0 && (
        <div className="lt-bulk">
          <span>{selected.size} selected</span>
          <button type="button" className="bk-btn" onClick={() => setXferOpen(true)}><Mi>swap_horiz</Mi>Transfer</button>
          <button type="button" className="bk-btn lt-danger" onClick={handleBulkDelete}><Mi>delete</Mi>Delete</button>
          <button type="button" className="bk-btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {canSelect && (
        <TransferLeadModal
          leadIds={[...selected]}
          open={xferOpen}
          onClose={() => setXferOpen(false)}
          onDone={() => setSelected(new Set())}
        />
      )}
      <section ref={cardRef} className={`rqx-card lt-card${loading ? ' lt-busy' : ''}`} aria-label="Leads" aria-busy={loading}>
        {loading && <span className="lt-bar" aria-hidden="true" />}
        {!leads.length ? (
          <>
            <div className="rqx-scroll"><table className="rqx-table lt-table"><thead>{heads}</thead></table></div>
            <div className="bk-empty bk-empty-lg">
              <Mi>{loading ? 'hourglass_top' : 'inbox'}</Mi>
              <b>{loading ? 'Loading leads…' : 'No leads here'}</b>
              <span>{loading ? 'Fetching the list.' : 'Nothing matches. Try another word, status or project.'}</span>
            </div>
          </>
        ) : (
          <div className="rqx-scroll">
            <table className="rqx-table lt-table">
              <thead>{heads}</thead>
              <tbody>
                {slice.map(l => (
                  <tr key={l.id} className={selected.has(l.id) ? 'sel' : ''}
                    onClick={() => (selected.size > 0 && canSelect ? toggleOne(l.id, { stopPropagation: () => {} }) : setPanLead(l.id))}>
                    {canSelect && (
                      <td className="lt-c-chk" onClick={e => toggleOne(l.id, e)}>
                        <button type="button" className={`lt-chk${selected.has(l.id) ? ' on' : ''}`} role="checkbox" aria-checked={selected.has(l.id)} aria-label={`Select ${l.name}`} onClick={e => toggleOne(l.id, e)}>
                          <Mi>{selected.has(l.id) ? 'check_box' : 'check_box_outline_blank'}</Mi>
                        </button>
                      </td>
                    )}
                    <td className="lt-c-person">
                      <span className="lt-person">
                        <span className="lt-av" style={{ background: avc(l.name) }}>{ini(l.name)}</span>
                        <span className="lt-pn"><b>{l.name}</b><span className="rqx-mono">{l.phone}</span></span>
                        {l.phone && chatOk && (
                          <button type="button" className="lt-wa" title={`Chat on WhatsApp with ${l.name || 'this person'}`} aria-label={`Chat with ${l.name}`}
                            onClick={(e) => { e.stopPropagation(); setChatTarget(l); }}><Mi>chat</Mi></button>
                        )}
                      </span>
                    </td>
                    <td className="lt-c-src"><span className="lt-src">{SRC_LABELS[l.source] || l.source || '—'}</span></td>
                    <td className="lt-c-prop" title={l.propertyInterest || undefined}>{l.propertyInterest || '—'}</td>
                    <td className="lt-c-status">{(() => { const ds = leadDisplayStatus(l); return <span className={`bdg lt-st ${ds.cls}`}><i className="bk-dot" />{ds.label}</span>; })()}</td>
                    <td className="lt-c-agent"><AgentCell lead={l} /></td>
                    <td className="lt-c-act"><LastActivityCell lead={l} fromServer={lastFu[l.id]} pending={fuPending} /></td>
                    <td className="lt-c-next"><NextFollowCell lead={l} /></td>
                    <td className="lt-created">{fmtDateTimeAP(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="rqx-foot">
          <span className="bk-cap">{count ? `${first}–${last} of ${count}` : '0 leads'}</span>
          <div className="rqx-pager" role="group" aria-label="Pages">
            <button type="button" className="bk-zbtn" aria-label="Previous page" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}><Mi>chevron_left</Mi></button>
            <span className="bk-zbtn wide rqx-pg">{curPage + 1} / {pages}</span>
            <button type="button" className="bk-zbtn" aria-label="Next page" disabled={curPage >= pages - 1} onClick={() => setPage(curPage + 1)}><Mi>chevron_right</Mi></button>
          </div>
        </div>
      </section>
    </div>
  );
}
