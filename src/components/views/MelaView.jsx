import { useMemo, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import useMelaData from '../../hooks/useMelaData.js';
import useNavState from '../../hooks/useNavState.js';
import { useApp } from '../../context/AppContext.jsx';
import { getDB } from '../../lib/db.js';
import { buildMela, sortAgents, fmtMins, bn } from '../../lib/melaStats.js';
import '../mela/mela.css';

// Avenue Mela: the Citizen Avenue sales-festival campaign for the business manager.
// Totals, the two customer countries, and a plain leaderboard of agents. Numbers come
// from lib/melaStats.js; the invitation itself is sent by the mela-invite function.

const SORTS = [
  { key: 'invited', label: 'Melay invited' },
  { key: 'response', label: 'Response Time' },
  { key: 'score', label: 'Mela Score' },
];

function Region({ title, d }) {
  return (
    <div className="mela-card">
      <div className="mela-lbl">{title}</div>
      <div className="mela-big">{bn(d.leads)}</div>
      <div className="mela-pills">
        <span>Contacted <b className="mela-pill out">{bn(d.contacted)}</b></span>
        <span>Invited <b className="mela-pill solid">{bn(d.invited)}</b></span>
      </div>
    </div>
  );
}

export default function MelaView() {
  const { dbVersion } = useApp();
  const { leads, acts, loading, error, reload } = useMelaData();
  const [sort, setSort] = useNavState('mela.sort', 'invited');
  const [pdfBusy, setPdfBusy] = useState(false);
  const root = useRef(null);
  const db = getDB();

  const data = useMemo(
    () => buildMela({ leads, acts, users: db.users || [] }),
    [leads, acts, dbVersion] // eslint-disable-line react-hooks/exhaustive-deps -- db mutates in place; dbVersion is the change signal
  );
  const { kpi } = data;
  const agents = useMemo(() => sortAgents(data.agents, sort), [data.agents, sort]);
  const times = data.agents.map((a) => a.minutes).filter((m) => m != null);
  const fast = times.length ? Math.min(...times) : null;
  const slow = times.length > 1 ? Math.max(...times) : null;

  const big = (a) => (sort === 'response' ? fmtMins(a.minutes) : sort === 'score' ? bn(a.score) : bn(a.invited));

  const downloadPdf = async () => {
    if (!root.current || pdfBusy) return;
    setPdfBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);
      // Always the light theme and solid colours, whatever the screen is showing.
      const canvas = await html2canvas(root.current, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true,
        onclone: (doc) => { doc.documentElement.dataset.theme = 'light'; doc.querySelector('.mela')?.classList.add('mela-pdf'); },
      });
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const w = pdf.internal.pageSize.getWidth() - 40;
      const h = (canvas.height * w) / canvas.width;
      const pageH = pdf.internal.pageSize.getHeight() - 40;
      let y = 0;
      // A tall dashboard continues on the next page instead of being squeezed.
      while (y < h) {
        if (y) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 20, 20 - y, w, h);
        y += pageH;
      }
      pdf.save(`mela-campaign-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="mela" ref={root}>
      <header className="mela-top">
        <div>
          <h2 className="mela-title">মেলা ক্যাম্পেইন</h2>
          <span className="mela-live"><i />লাইভ</span>
        </div>
        <button className="mela-btn" onClick={downloadPdf} disabled={pdfBusy} data-html2canvas-ignore="true">
          <Mi>download</Mi>{pdfBusy ? 'Preparing…' : 'PDF'}
        </button>
      </header>

      {error && <div className="mela-err"><Mi>error_outline</Mi>{error}<button onClick={reload}>Retry</button></div>}
      {loading && !leads.length && <div className="mela-empty">Loading…</div>}

      <section className="mela-row4">
        <div className="mela-card"><div className="mela-lbl">Total Leads</div><div className="mela-big">{bn(kpi.total)}</div></div>
        <div className="mela-card"><div className="mela-lbl">Contacted</div><div className="mela-big">{bn(kpi.contacted)}</div><div className="mela-sub">{bn(kpi.contactedPct)}% of leads</div></div>
        <div className="mela-card mela-hl"><div className="mela-lbl">Melay invited</div><div className="mela-big">{bn(kpi.invited)}</div><div className="mela-sub">{bn(kpi.invitedPct)}% of leads</div></div>
        <div className="mela-card"><div className="mela-lbl">গড় Response Time</div><div className="mela-big">{fmtMins(kpi.avgResponse)}</div></div>
      </section>

      <section className="mela-row2">
        <Region title="Dubai · +971" d={data.dubai} />
        <Region title="Bangladesh · +880" d={data.bd} />
      </section>

      <section className="mela-card mela-board">
        <div className="mela-sorts" data-html2canvas-ignore="true">
          {SORTS.map((s) => <button key={s.key} className={sort === s.key ? 'on' : ''} onClick={() => setSort(s.key)}>{s.label}</button>)}
        </div>
        {agents.length === 0 && <div className="mela-empty">No agent holds a Citizen Avenue lead yet.</div>}
        <ol className="mela-list">
          {agents.map((a, i) => (
            <li key={a.id}>
              <span className={`mela-rank${i === 0 ? ' top' : ''}`}>{bn(i + 1)}</span>
              <span className="mela-name">{a.name}</span>
              <span className={`mela-time${a.minutes != null && a.minutes === fast ? ' fast' : ''}${a.minutes != null && slow != null && a.minutes === slow && slow !== fast ? ' slow' : ''}`}>{fmtMins(a.minutes)}</span>
              <b className="mela-num">{big(a)}</b>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
