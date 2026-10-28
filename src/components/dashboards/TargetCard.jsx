import Mi from '../Mi.jsx';
import { getTarget, achievement } from '../../lib/db.js';
import { daysLeftInMonth } from '../../lib/helpers.js';
import { Ring, Meter } from './MobileBits.jsx';

// `variant="soft"` (the phone Home): the same target numbers as a ring and a
// bar, for the bottom of the Today card.
export default function TargetCard({ user, variant }) {
  const tgt = getTarget(user.id);
  const ach = achievement(user.id, user.role);
  const tar = tgt ? tgt.value : 0;
  const pct = tar > 0 ? Math.min(100, Math.round(ach / tar * 100)) : 0;
  const col = 'var(--accent)'; // always brand accent (adapts to light/dark)
  const left = daysLeftInMonth();
  const needed = Math.max(0, tar - ach);
  const daily = left > 0 ? (needed / left).toFixed(1) : '-';
  const kpiName = 'Site Visits Done';

  if (variant === 'soft') {
    return (
      <div className="mh-hero-foot">
        <Ring pct={pct} label={`Monthly target ${pct} percent`} />
        <div className="mh-meters">
          <Meter label="Site visits · monthly target" value={tgt ? `${ach} of ${tar}` : 'No target'} pct={pct} />
          <p className="mh-note">
            {tgt ? (needed > 0 ? `${needed} to go` : 'Reached') : `${ach} done`} · {left} days left{tar > 0 && left > 0 && needed > 0 ? ` · ${daily}/day` : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tc">
      <div className="tc-hd">
        <div className="tc-label">
          <div className="tc-dot" style={{ background: col }} />
          <div className="tc-name">{kpiName} — Monthly Target</div>
        </div>
        {!tgt && <span className="tc-noset">No target</span>}
      </div>

      <div className="tc-info">
        <div className="tc-nums">
          <span className="tc-cur" style={{ color: col }}>{ach}</span>
          <span className="tc-div">/</span>
          <span className="tc-tar">{tar || '—'}</span>
          <span className="tc-unit">{kpiName.toLowerCase()}</span>
          <span className="tc-pct" style={{ color: col, marginLeft: 'auto' }}>{pct}%</span>
        </div>
        <div className="prog-track">
          <div className="prog-fill" style={{ width: pct + '%', background: col }} />
        </div>
      </div>

      <div className="tc-meta">
        {needed > 0
          ? <div className="tc-mi"><Mi>flag</Mi>{needed} to go</div>
          : <div className="tc-mi" style={{ color: 'var(--green)' }}><Mi>check_circle</Mi>Reached!</div>
        }
        <div className="tc-mi"><Mi>schedule</Mi>{left} days left</div>
        {tar > 0 && left > 0 && <div className="tc-mi"><Mi>trending_up</Mi>{daily}/day</div>}
      </div>
    </div>
  );
}
