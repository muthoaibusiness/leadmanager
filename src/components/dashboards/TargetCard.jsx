import Mi from '../Mi.jsx';
import { getTarget, achievement } from '../../lib/db.js';
import { progColor, daysLeftInMonth } from '../../lib/helpers.js';
import { ROLES } from '../../lib/constants.js';
import { Ring } from '../charts/Charts.jsx';

export default function TargetCard({ user }) {
  const tgt = getTarget(user.id);
  const ach = achievement(user.id, user.role);
  const tar = tgt ? tgt.value : 0;
  const pct = tar > 0 ? Math.min(100, Math.round(ach / tar * 100)) : 0;
  const col = progColor(pct);
  const left = daysLeftInMonth();
  const needed = Math.max(0, tar - ach);
  const daily = left > 0 ? (needed / left).toFixed(1) : '-';
  const kpiName = user.role === ROLES.IA ? 'Meetings Set' : 'Site Visits Done';

  return (
    <div className="tc">
      <div className="tc-hd">
        <div className="tc-label">
          <div className="tc-dot" style={{ background: col }} />
          <div className="tc-name">{kpiName} — Monthly Target</div>
        </div>
        {!tgt && <span style={{ fontSize: '11px', color: 'var(--orange)', fontWeight: 600 }}>No target set</span>}
      </div>
      <div className="tc-split">
        <div className="tc-left">
          <div className="tc-nums">
            <div className="tc-cur" style={{ color: col }}>{ach}</div>
            <div className="tc-div">/</div>
            <div className="tc-tar">{tar || '—'}</div>
            <div className="tc-unit">{kpiName.toLowerCase()}</div>
          </div>
          <div className="prog-track">
            <div className="prog-fill" style={{ width: pct + '%', background: col }} />
          </div>
          <div className="tc-meta">
            {needed > 0
              ? <div className="tc-mi"><Mi>flag</Mi>{needed} more needed</div>
              : <div className="tc-mi" style={{ color: 'var(--green)' }}><Mi>check_circle</Mi>Target reached!</div>
            }
            <div className="tc-mi"><Mi>schedule</Mi>{left} days left in month</div>
            {tar > 0 && left > 0 && <div className="tc-mi"><Mi>trending_up</Mi>{daily}/day needed</div>}
          </div>
        </div>
        <Ring pct={pct} color={col} size={108} thickness={11} label="achieved" />
      </div>
    </div>
  );
}
