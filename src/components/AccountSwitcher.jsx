import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import Avatar from './Avatar.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getDB } from '../lib/db.js';
import { rlabel } from '../lib/helpers.js';
import { ROLES } from '../lib/constants.js';

// Admin account switcher — lets an admin "become" any account in their company
// (Master: any account) without an email/password. Session stays the real admin,
// so a reload returns to them. Sits in the top chrome bar.
export default function AccountSwitcher() {
  const { user, impersonator, impersonate, stopImpersonate } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!user) return null;
  const admin = impersonator || user; // the real admin behind the wheel
  const isAdmin = admin.role === ROLES.MGMT || admin.role === ROLES.MASTER;
  if (!isAdmin) return null;

  const db = getDB();
  const accounts = db.users
    // Master can switch into anyone; a company admin can only switch within their
    // own company and never into the super-admin (Master) account.
    .filter(u => admin.role === ROLES.MASTER
      ? true
      : (u.companyId === admin.companyId && u.role !== ROLES.MASTER))
    .filter(u => u.id !== user.id);

  // Group by team: the Team Lead is the header, their Meeting/Initial agents nest
  // under it. Admins and team-less accounts get their own groups.
  const field = accounts.filter(u => [ROLES.TL, ROLES.MA, ROLES.IA].includes(u.role));
  const memOrder = { [ROLES.MA]: 0, [ROLES.IA]: 1 };
  const teamIds = [...new Set(field.map(u => u.teamId).filter(Boolean))];
  const teams = teamIds.map(tid => {
    const tl = field.find(u => u.role === ROLES.TL && u.teamId === tid);
    const members = field.filter(u => u.teamId === tid && u.role !== ROLES.TL)
      .sort((a, b) => (memOrder[a.role] - memOrder[b.role]) || (a.name || '').localeCompare(b.name || ''));
    const name = tl ? tl.name : ((db.teams || []).find(t => t.id === tid)?.name || 'Team');
    return { tid, tl, members, name };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const orphans = field.filter(u => !u.teamId).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const admins = accounts.filter(u => u.role === ROLES.MGMT || u.role === ROLES.MASTER)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const Item = (u) => (
    <button key={u.id} className="acsw-item" onClick={() => { impersonate(u); setOpen(false); }}>
      <Avatar name={u.name} avatar={u.avatar} className="acsw-av" />
      <span className="acsw-itx">
        <span className="acsw-in">{u.name}</span>
        <span className="acsw-ir">{rlabel(u.role)}</span>
      </span>
    </button>
  );

  return (
    <div className="acsw" ref={ref}>
      <button className={`acsw-pill${impersonator ? ' imp' : ''}`} onClick={() => setOpen(o => !o)} title="Switch account">
        <Avatar name={user.name} avatar={user.avatar} className="acsw-av" />
        <span className="acsw-nm">{user.name}</span>
        {impersonator && <span className="acsw-tag">viewing</span>}
        <Mi>expand_more</Mi>
      </button>

      {open && (
        <div className="acsw-menu">
          {impersonator && (
            <button className="acsw-item acsw-return" onClick={() => { stopImpersonate(); setOpen(false); }}>
              <Mi>undo</Mi>Back to {impersonator.name}
            </button>
          )}
          <div className="acsw-hd">Switch account</div>

          {teams.map(t => (
            <div key={t.tid} className="acsw-team">
              {t.tl
                ? <button className="acsw-item acsw-team-hd" onClick={() => { impersonate(t.tl); setOpen(false); }}>
                    <Avatar name={t.tl.name} avatar={t.tl.avatar} className="acsw-av" />
                    <span className="acsw-itx">
                      <span className="acsw-in">{t.tl.name}</span>
                      <span className="acsw-ir">Team Lead · {t.members.length} member{t.members.length === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                : <div className="acsw-grp-hd">{t.name}</div>}
              {t.members.length > 0 && (
                <div className="acsw-list acsw-team-mem">{t.members.map(Item)}</div>
              )}
            </div>
          ))}

          {orphans.length > 0 && (
            <div className="acsw-team">
              <div className="acsw-grp-hd">No team</div>
              <div className="acsw-list">{orphans.map(Item)}</div>
            </div>
          )}

          {admins.length > 0 && (
            <div className="acsw-team">
              <div className="acsw-grp-hd">Admins</div>
              <div className="acsw-list">{admins.map(Item)}</div>
            </div>
          )}

          {!accounts.length && <div className="acsw-empty">No other accounts</div>}
        </div>
      )}
    </div>
  );
}
