import Mi from './Mi.jsx';
import { leadDisplayStatus, fmtDT } from '../lib/helpers.js';

// Shared drill-down sheet for clickable KPI cards. Pass either:
//   { title, leads: [...] }                    → list leads (name · phone · status), click → open lead
//   { title, rows: [{ leadId, title, sub, right, icon }] }  → custom rows (e.g. calls)
export default function KpiSheet({ detail, onClose, onLead }) {
  if (!detail) return null;
  const { title } = detail;
  const rows = detail.rows || (detail.leads || []).map(l => {
    const ds = leadDisplayStatus(l);
    return { leadId: l.id, title: l.name || 'Unnamed', sub: l.phone || '', badge: ds };
  });

  return (
    <div className="kpi-ov" onClick={(e) => { if (e.target.classList.contains('kpi-ov')) onClose(); }}>
      <div className="kpi-sheet">
        <div className="kpi-sheet-hd">
          <span>{title} <b>{rows.length}</b></span>
          <button className="kpi-x" onClick={onClose}><Mi>close</Mi></button>
        </div>
        <div className="kpi-list">
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
          )) : <div className="kpi-empty">Nothing here yet.</div>}
        </div>
      </div>
    </div>
  );
}
