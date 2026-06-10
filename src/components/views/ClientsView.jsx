import { useState } from 'react';
import Mi from '../Mi.jsx';
import LogCall from '../LogCall.jsx';
import ActivityTimeline from '../ActivityTimeline.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getLeads, getBookings, getActs, bookingPaid } from '../../lib/db.js';
import { fmtBDT, fmtD, fmtAgo, ini, avc } from '../../lib/helpers.js';

export default function ClientsView() {
  const { user, setPanLead, openModal, dbVersion } = useApp();
  void dbVersion;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);

  const leads = getLeads(user);
  const bkByLead = {};
  getBookings().forEach(b => { if (!bkByLead[b.leadId]) bkByLead[b.leadId] = b; });

  const clients = leads
    .filter(l => bkByLead[l.id] || l.status === 'DEAL_CLOSED_WON')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const filtered = clients.filter(c => (c.name + ' ' + c.phone + ' ' + (c.email || '')).toLowerCase().includes(q.toLowerCase().trim()));
  const active = filtered.find(c => c.id === sel) || filtered[0] || null;

  if (clients.length === 0) {
    return <div className="empty"><Mi>diversity_3</Mi><p>No clients yet — they appear here once a lead books a unit or a deal is won.</p></div>;
  }

  const bk = active ? bkByLead[active.id] : null;
  const total = bk?.total || active?.dealValue || 0;
  const paid = bk ? bookingPaid(bk) : 0;
  const payPct = total ? Math.round((paid / total) * 100) : 0;
  const propName = bk?.propertyName || active?.cart?.propertyName || active?.propertyInterest || '—';
  const acts = active ? getActs(active.id) : [];

  // Channel interaction counts (mockup top bar).
  const cnt = (t) => acts.filter(a => a.type === t).length;
  const channels = [
    { v: cnt('CALL'), l: 'Calls' },
    { v: cnt('SMS'), l: 'SMS' },
    { v: cnt('WHATSAPP'), l: 'WhatsApp' },
    { v: cnt('VISIT'), l: 'Visit' },
  ];

  // Engagement funnel (mockup checklist) — counts derived from real activity.
  const talk5 = acts.filter(a => a.type === 'CALL' && (a.durationSeconds || 0) >= 300).length;
  const shared = acts.filter(a => a.type === 'CART' || a.type === 'OFFER').length;
  const office = acts.filter(a => a.type === 'STATUS_CHANGE' && /office|meeting/i.test(a.description || '')).length;
  const dealCnt = acts.filter(a => a.type === 'DEAL' && /WON/.test(a.description || '')).length;
  const funnel = [
    { label: 'Talk over call over 5 minutes', count: talk5, done: talk5 > 0 },
    { label: 'Shared property data', count: shared, done: shared > 0 },
    { label: 'Site visit', count: cnt('VISIT'), done: cnt('VISIT') > 0 },
    { label: 'Office visit', count: office, done: office > 0 },
    { label: 'Deal confirm', count: dealCnt, done: active?.status === 'DEAL_CLOSED_WON' },
  ];
  const badge = (n) => (n >= 5 ? '5+' : String(n));

  const schedule = () => { setPanLead(active.id); openModal('sched'); };
  const addNote = () => { setPanLead(active.id); openModal('note'); };

  return (
    <div className="cl-wrap">
      {/* list pane */}
      <div className="cl-list">
        <div className="cl-search">
          <Mi>search</Mi>
          <input placeholder="Search clients..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="cl-items">
          {filtered.map(c => {
            const cbk = bkByLead[c.id];
            return (
              <button key={c.id} className={`cl-item${active && c.id === active.id ? ' on' : ''}`} onClick={() => setSel(c.id)}>
                <span className="cl-av" style={{ background: avc(c.name) }}>{ini(c.name)}</span>
                <div className="cl-it-bd">
                  <div className="cl-it-n">{c.name}</div>
                  <div className="cl-it-s">{cbk?.propertyName || c.propertyInterest || c.phone}</div>
                </div>
                {cbk && <span className="cl-it-v">{fmtBDT(cbk.total)}</span>}
              </button>
            );
          })}
          {filtered.length === 0 && <div className="cl-none">No match</div>}
        </div>
      </div>

      {/* profile pane */}
      {active && (
        <div className="cl-detail">
          <div className="cl-hero">
            <span className="cl-hero-av" style={{ background: avc(active.name) }}>{ini(active.name)}</span>
            <div className="cl-hero-bd">
              <div className="cl-hero-n">{active.name}</div>
              <div className="cl-hero-row">
                {active.phone && <span><Mi>call</Mi>{active.phone}</span>}
                {active.email && <span><Mi>mail</Mi>{active.email}</span>}
                <span><Mi>apartment</Mi>{propName}</span>
              </div>
              <div className="cl-hero-meta">
                Client since {fmtD(active.createdAt)} · Managed by {active.assignedToName || '—'}
                {total ? ` · Deal ${fmtBDT(total)} · ${payPct}% paid` : ''}
              </div>
            </div>
            <button className="btn btn-g cl-msg" onClick={() => setPanLead(active.id)}><Mi>open_in_full</Mi>Open</button>
          </div>

          {/* channel interaction counters */}
          <div className="cl-channels">
            {channels.map(c => (
              <div key={c.l} className="cl-chan">
                <div className="cl-chan-v">{c.v}</div>
                <div className="cl-chan-l">{c.l}</div>
              </div>
            ))}
          </div>

          {/* quick actions */}
          <div className="cl-actions">
            <button className="cl-act" onClick={schedule}><Mi>event</Mi>Schedule site visit</button>
            <LogCall leadId={active.id} triggerClassName="cl-act primary" triggerLabel="Log call" />
            <button className="cl-act primary" onClick={addNote}><Mi>sticky_note_2</Mi>Add note</button>
          </div>

          {/* engagement funnel */}
          <div className="cl-funnel">
            {funnel.map(f => (
              <div key={f.label} className={`cl-fn-row${f.done ? ' done' : ''}`}>
                <span className="cl-fn-badge">{badge(f.count)}</span>
                <span className="cl-fn-chev"><Mi>chevron_right</Mi></span>
                <span className="cl-fn-lbl">{f.label}</span>
                {f.done && <span className="cl-fn-ok"><Mi>check_circle</Mi></span>}
              </div>
            ))}
          </div>

          <div className="cl-tl-hd">Activity timeline</div>
          <ActivityTimeline items={acts.map(a => ({ id: a.id, type: a.type, description: a.description, actor: a.userName, time: fmtAgo(a.timestamp) }))} />

        </div>
      )}
    </div>
  );
}
