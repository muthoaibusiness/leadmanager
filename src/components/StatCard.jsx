import Mi from './Mi.jsx';

export default function StatCard({ val, label, ico, bg, sub }) {
  return (
    <div className="mc">
      <div className="mc-top">
        <div className="mc-ico" style={{ background: bg }}>
          <Mi>{ico}</Mi>
        </div>
      </div>
      <div className="mc-v">{val}</div>
      <div className="mc-l">{label}</div>
      {sub && <div className="mc-sub">{sub}</div>}
    </div>
  );
}
