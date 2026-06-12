import Mi from '../Mi.jsx';

// Pure-CSS product preview shown in the hero — a faux WEPRO dashboard so the
// landing page shows the product, not just text. No images/assets required.
const KPIS = [
  { l: 'Active deals', v: '128', t: '+12%' },
  { l: 'Units booked', v: '64', t: '+8%' },
  { l: 'Collections', v: '৳4.2cr', t: '+19%' },
];
const BARS = [42, 68, 55, 80, 62, 95, 74];
const PIPE = [
  { s: 'New lead', n: 'Tareq H.', sc: 88 },
  { s: 'Meeting set', n: 'Nadia R.', sc: 73 },
  { s: 'Offer sent', n: 'Imran K.', sc: 91 },
];

export default function DashMock() {
  return (
    <div className="lp-mock" aria-hidden="true">
      <div className="lp-mock-bar">
        <span className="lp-mock-dots"><i /><i /><i /></span>
        <span className="lp-mock-title">WEPRO CRM · Management</span>
      </div>
      <div className="lp-mock-body">
        <div className="lp-mock-side">
          <span className="lp-mock-logo">W</span>
          {['dashboard', 'view_kanban', 'apartment', 'monitoring', 'groups'].map((i, k) => (
            <span key={i} className={`lp-mock-nav${k === 0 ? ' on' : ''}`}><Mi>{i}</Mi></span>
          ))}
        </div>
        <div className="lp-mock-main">
          <div className="lp-mock-kpis">
            {KPIS.map(k => (
              <div className="lp-mock-kpi" key={k.l}>
                <div className="lp-mock-kpi-l">{k.l}</div>
                <div className="lp-mock-kpi-v">{k.v}</div>
                <div className="lp-mock-kpi-t">{k.t}</div>
              </div>
            ))}
          </div>
          <div className="lp-mock-cols">
            <div className="lp-mock-chart">
              <div className="lp-mock-chart-h">Sales this week</div>
              <div className="lp-mock-bars">
                {BARS.map((b, i) => <span key={i} style={{ height: `${b}%` }} />)}
              </div>
            </div>
            <div className="lp-mock-pipe">
              <div className="lp-mock-chart-h">Pipeline</div>
              {PIPE.map(p => (
                <div className="lp-mock-deal" key={p.n}>
                  <div>
                    <div className="lp-mock-deal-n">{p.n}</div>
                    <div className="lp-mock-deal-s">{p.s}</div>
                  </div>
                  <span className="lp-mock-score">{p.sc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
