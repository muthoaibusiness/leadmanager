import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { AvatarGroup, AvatarGroupTooltip } from './ui/avatar-group.jsx';
import { useApp } from '../context/AppContext.jsx';
import { clearSession, getDB } from '../lib/db.js';
import { avc, ini, rlabel } from '../lib/helpers.js';
import { canSee, ROLES } from '../lib/constants.js';
import useMediaQuery from '../hooks/useMediaQuery.js';

// Faces shown before the "+N" face, which opens the menu — its search covers
// every account.
const MAX_FACES = 4;

// Initials for a face without a photo: "Ada Lovelace" → "AL".
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

// Small initials/photo avatar used inside the menu.
function UAvatar({ u, cls = '' }) {
  return u.avatar
    ? <img src={u.avatar} alt="" className={`sb-av sb-av-img ${cls}`} />
    : <div className={`sb-av ${cls}`} style={{ background: avc(u.name) }}>{ini(u.name)}</div>;
}

// Header identity control (top right, before the date filter). An AvatarGroup
// of real accounts: the signed-in user first, then — for admins — every account
// they can switch to (Management: own company; Master: all). Clicking yourself
// opens the menu (switch-account search, Profile, Sign out); clicking anyone
// else switches to that account, as the menu's list does. Agents and Team Leads
// see only themselves.
export default function UserMenu() {
  const { user, setUser, impersonator, impersonate, stopImpersonate, nav, setSidebarOpen } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const phone = useMediaQuery('(max-width: 767px)');

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Your own avatar — the menu's trigger.
  const focusMe = () => ref.current?.querySelector('.ag-av')?.focus();

  // Escape with focus in the menu (its trigger, search or items) shuts just this
  // menu, forgets the search and hands focus back to the trigger. Stopping it
  // here ends the native event at React's root, so LeadPanel's and App's Escape
  // handlers (modal → lead panel → drawer) do not also act on it. Focus
  // anywhere else, or the menu already shut, leaves Escape to that order.
  const onEsc = (e) => {
    if (e.key !== 'Escape' || !open || e.nativeEvent.isComposing) return;
    e.stopPropagation();
    setOpen(false);
    setQ('');
    focusMe();
  };

  const admin = impersonator || user;
  const isAdmin = admin.role === ROLES.MGMT || admin.role === ROLES.MASTER;
  const db = getDB();
  const accounts = isAdmin
    ? db.users
        .filter(u => (admin.role === ROLES.MASTER ? true : (u.companyId === admin.companyId && u.role !== ROLES.MASTER)))
        .filter(u => u.id !== user.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];
  const ql = q.trim().toLowerCase();
  const filtered = ql ? accounts.filter(u => (u.name || '').toLowerCase().includes(ql) || String(rlabel(u.role) || '').toLowerCase().includes(ql)) : accounts;

  // The group: you, then the accounts you can switch to; the rest behind "+N".
  const people = [user, ...accounts];
  const shown = people.slice(0, phone ? 1 : MAX_FACES);
  const more = people.length - shown.length;

  const switchTo = (u) => {
    // Picking the real admin while viewing as someone else is "go back".
    if (impersonator && u.id === impersonator.id) stopImpersonate();
    else impersonate(u);
    setOpen(false);
    setQ('');
  };
  // A face's tooltip is portalled to <body>, but React still bubbles its events
  // through the face — only a press on the face itself counts.
  const onFace = (fn) => (e) => { if (e.currentTarget.contains(e.target)) fn(); };
  const name = (u) => u.name || u.email || 'User';

  const faces = shown.map((u, i) => (
    <button key={u.id} type="button" className="ag-av" aria-label={i === 0 ? `${name(u)} — account menu` : `Switch to ${name(u)}`}
      aria-expanded={i === 0 ? open : undefined}
      onClick={onFace(i === 0 ? () => setOpen(o => !o) : () => switchTo(u))}>
      {u.avatar ? <img src={u.avatar} alt="" draggable={false} className="ag-img" /> : <span aria-hidden="true">{initials(name(u))}</span>}
      <AvatarGroupTooltip>{i === 0 ? (impersonator ? `${name(u)} · viewing` : `${name(u)} (you)`) : name(u)}</AvatarGroupTooltip>
    </button>
  ));
  if (more > 0) {
    faces.push(
      <button key="more" type="button" className="ag-av ag-more" aria-label={`${more} more accounts`}
        onClick={onFace(() => setOpen(true))}>
        +{more}
        <AvatarGroupTooltip>{`${more} more — search all`}</AvatarGroupTooltip>
      </button>,
    );
  }

  const logout = () => { clearSession(); setSidebarOpen(false); setUser(null); };

  return (
    <div className={`hd-um${open ? ' open' : ''}${impersonator ? ' imp' : ''}`} ref={ref} onKeyDown={onEsc}>
      {/* Your face sits on top of the overlap; tooltips open below, the header
          being the top edge of the screen. */}
      <AvatarGroup invertOverlap tooltipProps={{ side: 'bottom', sideOffset: 10 }}>
        {faces}
      </AvatarGroup>
      {open && (
        <div className="umenu">
          <div className="um-me">
            <UAvatar u={user} cls="umenu-av" />
            <span className="umenu-itx">
              <span className="umenu-in">{user.name}</span>
              <span className="umenu-ir">{impersonator ? 'Viewing · ' + rlabel(user.role) : rlabel(user.role)}</span>
            </span>
          </div>
          <div className="umenu-div" />
          {impersonator && (
            <button className="umenu-item umenu-return" onClick={() => { stopImpersonate(); setOpen(false); }}>
              <Mi aria-hidden="true">undo</Mi><span>Back to {impersonator.name}</span>
            </button>
          )}
          {isAdmin && (
            <>
              <div className="umenu-sec">Switch account</div>
              <div className="umenu-search">
                <Mi aria-hidden="true">search</Mi>
                <input autoFocus placeholder="Search account" value={q} onChange={e => setQ(e.target.value)} />
              </div>
              <div className="umenu-list">
                {filtered.map(u => (
                  <button key={u.id} className="umenu-item" onClick={() => switchTo(u)}>
                    <UAvatar u={u} cls="umenu-av" />
                    <span className="umenu-itx"><span className="umenu-in">{u.name}</span><span className="umenu-ir">{rlabel(u.role)}</span></span>
                  </button>
                ))}
                {!filtered.length && <div className="umenu-empty">No match</div>}
              </div>
              <div className="umenu-div" />
            </>
          )}
          {canSee(user, 'profile') && (
            <button className="umenu-item" onClick={() => { nav('profile'); setOpen(false); }}>
              <Mi aria-hidden="true">person</Mi><span>Profile</span>
            </button>
          )}
          <button className="umenu-item umenu-danger" onClick={logout}>
            <Mi aria-hidden="true">logout</Mi><span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
