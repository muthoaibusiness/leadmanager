import { useEffect, useState } from 'react';
import Mi from '../Mi.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { loadProjectDocLog, DOCS } from '../../lib/shopDocs.js';

// Booking › a project › Documents: every document sent for this project, and to whom.
// Rows come from the send log the unit card's Documents tab writes (shop_doc_log).

const NAME = Object.fromEntries(DOCS.map(d => [d.k, d.n]));
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const docName = (d) => (typeof d === 'string' ? NAME[d] || d : d?.n || NAME[d?.k] || d?.name || '');

export default function ProjectDocs({ project }) {
  const { user } = useApp();
  const [state, setState] = useState({ loading: true, log: [], missing: false });
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    loadProjectDocLog(user?.companyId, project.id).then(r => { if (live) setState({ loading: false, ...r }); }).catch(() => { if (live) setState({ loading: false, log: [], missing: false }); });
    return () => { live = false; };
  }, [user?.companyId, project.id]);

  const needle = q.trim().toLowerCase();
  const rows = state.log.filter(r => !needle || [r.client, r.unitId, r.by, ...r.docs.map(docName)].some(v => String(v || '').toLowerCase().includes(needle)));
  const clients = new Set(state.log.map(r => r.client).filter(Boolean)).size;

  return (
    <div className="pov">
      <div className="pov-bar">
        <label className="bk-search pov-search"><Mi>search</Mi>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, unit or document" aria-label="Search sent documents" /></label>
        <span className="pov-mu">{state.log.length} send{state.log.length === 1 ? '' : 's'} · {clients} client{clients === 1 ? '' : 's'}</span>
      </div>
      {state.loading ? <p className="pov-none">Loading…</p>
        : state.missing ? <p className="pov-none">Document sending is not set up in the database yet.</p>
        : rows.length === 0 ? <p className="pov-none">{state.log.length ? 'No send matches.' : 'No documents sent for this project yet. Send them from a unit’s Documents tab.'}</p>
        : (
          <section className="pov-sec">
            <div className="pov-scroll"><table className="pov-t">
              <thead><tr><th>Client</th><th>Unit</th><th>Documents</th><th>By</th><th>Via</th><th>When</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.client || '—'}{r.contact && <div className="mono pov-mu pov-sm">{r.contact}</div>}</td>
                    <td><span className="pov-u">{r.unitId}</span></td>
                    <td className="pov-docs">{r.docs.map((d, i) => <span key={i} className="pov-dc">{docName(d)}</span>)}</td>
                    <td>{r.by || '—'}</td>
                    <td className="pov-mu">{r.channel || '—'}</td>
                    <td className="mono pov-mu">{when(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )}
    </div>
  );
}
