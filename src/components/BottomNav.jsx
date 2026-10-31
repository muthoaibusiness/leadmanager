import { useState, useRef, useEffect } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getHoldRequests } from '../lib/db.js';
import { canSee, ROLES } from '../lib/constants.js';
import { NAV_META } from '../lib/navMeta.js';

// Phones only (CSS shows it below 768px), along the bottom of the screen: a
// floating pill of round icon buttons — up to three page tabs and More, which
// opens the sidebar drawer (it still lists every page) — and, beside the pill,
// a round "+" that opens a quick-actions menu. It replaces the header's
// show-sidebar button there.

// Candidate tabs in priority order; the first three the user may see are shown.
const PRIORITY = ['dashboard', 'companies', 'leads', 'properties', 'reports', 'conversations',
  'calendar', 'pipeline', 'agentperf', 'team', 'requests', 'inventory', 'accounts'];

// `inert`: set while the drawer is open, so Tab stays in the drawer.
export default function BottomNav({ inert }) {
  const { user, view, nav, sidebarOpen, setSidebarOpen, chatOk, waUnread, openModal, setCreateUserRoles } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef(null);

  useEffect(() => {
    if (!addOpen) return;
    const h = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [addOpen]);

  if (!user) return null;

  // Same gates as the sidebar: chat by the allow-list, the rest by canSee.
  const visible = (k) => (k === 'conversations' ? chatOk : canSee(user, k));
  const tabs = PRIORITY.filter(visible).slice(0, 3);

  const pendingHolds = user.role === 'MANAGEMENT' ? getHoldRequests().filter(r => r.status === 'pending').length : 0;
  const badgeOf = (k) => (k === 'requests' ? pendingHolds : k === 'conversations' ? waUnread : 0);
  // More is the current tab for any page without a tab of its own, and carries
  // a dot when a page behind it has a count.
  const moreOn = sidebarOpen || !tabs.includes(view);
  const moreDot = ['requests', 'conversations'].some(k => !tabs.includes(k) && visible(k) && badgeOf(k) > 0);

  // Quick actions, each under the same gate as the button it mirrors elsewhere
  // (the page hero's Add Customer / Import / Add Agent, the chat and profile pages).
  const actions = [
    canSee(user, 'add_customer') && { key: 'add-lead', ico: 'person_add', lbl: 'Add Customer', run: () => openModal('add-lead') },
    canSee(user, 'add_customer') && { key: 'import', ico: 'upload', lbl: 'Import', run: () => openModal('import') },
    user.role === ROLES.TL && { key: 'add-agent', ico: 'group_add', lbl: 'Add Agent', run: () => { setCreateUserRoles([ROLES.AGENT, ROLES.MA, ROLES.EXEC]); openModal('create-user'); } },
    chatOk && { key: 'chat', ico: 'forum', lbl: 'New Chat', run: () => nav('conversations') },
    canSee(user, 'profile') && { key: 'profile', ico: 'settings', lbl: 'Settings', run: () => nav('profile') },
  ].filter(Boolean);

  // Escape with focus in the menu shuts just this menu and returns focus to
  // "+"; stopping it keeps App's Escape order (modal → lead panel → drawer) out.
  const onEsc = (e) => {
    if (e.key !== 'Escape' || !addOpen || e.nativeEvent.isComposing) return;
    e.stopPropagation();
    setAddOpen(false);
    addRef.current?.querySelector('.bnav-add')?.focus();
  };

  const tab = (k) => {
    const on = !sidebarOpen && view === k;
    const badge = badgeOf(k);
    return (
      <button key={k} type="button" className={`bnav-it${on ? ' on' : ''}`} onClick={() => nav(k)}
        aria-current={on ? 'page' : undefined} aria-label={NAV_META[k].lbl} title={NAV_META[k].lbl}>
        <Mi aria-hidden="true">{NAV_META[k].ico}</Mi>
        {badge > 0 && <span className="bnav-badge">{badge > 99 ? '99+' : badge}</span>}
      </button>
    );
  };

  return (
    <nav className="bnav" aria-label="Quick navigation" inert={inert}>
      <div className="bnav-pill">
        {tabs.map(tab)}
        <button type="button" className={`bnav-it bnav-more${moreOn ? ' on' : ''}`} onClick={() => setSidebarOpen(true)}
          aria-label="More" title="More" aria-controls="app-sidebar" aria-expanded={sidebarOpen}>
          <Mi aria-hidden="true">menu</Mi>
          {moreDot && <span className="bnav-dot" aria-hidden="true" />}
        </button>
      </div>
      {actions.length > 0 && (
        <div className="bnav-addwrap" ref={addRef} onKeyDown={onEsc}>
          <button type="button" className={`bnav-add${addOpen ? ' open' : ''}`} onClick={() => setAddOpen(o => !o)}
            aria-label="Quick actions" title="Quick actions" aria-haspopup="menu" aria-expanded={addOpen}>
            <Mi aria-hidden="true">add</Mi>
          </button>
          {addOpen && (
            <div className="umenu bnav-menu" role="menu">
              {actions.map(a => (
                <button key={a.key} type="button" role="menuitem" className="umenu-item" onClick={() => { setAddOpen(false); a.run(); }}>
                  <Mi aria-hidden="true">{a.ico}</Mi><span>{a.lbl}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
