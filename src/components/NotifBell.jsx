import { useState } from 'react';
import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getNotifs, getUnreadCount, markAllRead, markOneRead } from '../lib/db.js';
import { fmtAgo } from '../lib/helpers.js';
import { NOTIF_ICO, NOTIF_CLR } from '../lib/constants.js';
import { pushPermission, enablePush } from '../lib/webPush.js';
import { isIOS, isStandalone } from '../lib/pwa.js';

// Push for the installed app (lib/webPush.js). Shown only while there is
// something to do: allow notifications (a tap is required on iOS), install the
// app first (an iPhone only pushes to a Home Screen app), or unblock them.
// Once notifications are on, and in a desktop browser tab, it renders nothing.
function PushRow() {
  const [perm, setPerm] = useState(pushPermission);
  const [busy, setBusy] = useState(false);
  const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd)', fontSize: 12.5, color: 'var(--t3)', flexShrink: 0 };

  if (perm === 'unsupported') {
    if (!isIOS() || isStandalone()) return null;
    return <div style={row}><Mi>add_circle</Mi><span>To get notifications on this iPhone: Share, then Add to Home Screen.</span></div>;
  }
  if (perm === 'granted') return null;
  if (perm === 'denied') {
    return <div style={row}><Mi>warning</Mi><span>Notifications are blocked for this app. Allow them in the phone&apos;s settings.</span></div>;
  }
  const turnOn = async () => {
    setBusy(true);
    const res = await enablePush();
    setBusy(false);
    // 'failed' = allowed, but the phone could not be registered (no signal):
    // keep the button so it can be tried again.
    setPerm(res === 'on' ? 'granted' : res === 'failed' ? 'default' : res);
  };
  return (
    <div style={row}>
      <span style={{ flex: 1 }}>Get notifications on this phone, even with the app closed.</span>
      <button type="button" className="btn btn-p btn-sm" onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
    </div>
  );
}

export default function NotifBell() {
  const { user, notifOpen, setNotifOpen, setPanLead, refreshDB } = useApp();

  if (!user) return null;

  const count = getUnreadCount(user.id);
  const notifs = getNotifs(user.id).slice(0, 50);
  const unreadCount = notifs.filter(n => !n.read).length;

  const handleMarkAllRead = () => {
    markAllRead(user.id);
    refreshDB();
  };

  const handleNotifClick = (n) => {
    markOneRead(n.id, user.id);
    setNotifOpen(false);
    refreshDB();
    if (n.leadId) setPanLead(n.leadId);
  };

  return (
    <>
      <button type="button" className="hd-ic notif-btn" onClick={() => setNotifOpen(o => !o)}
        title="Notifications" aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}>
        <Mi>notifications</Mi>
        {count > 0 && (
          <span className="notif-ct">{count > 99 ? '99+' : String(count)}</span>
        )}
      </button>

      {notifOpen && (
        <div id="notif-ov" className="on" onClick={() => setNotifOpen(false)} />
      )}

      <div className={`notif-panel${notifOpen ? ' on' : ''}`}>
        <div className="np-hd">
          <div>
            <div className="np-ttl">Notifications</div>
            <div className="np-sub">{unreadCount > 0 ? unreadCount + ' unread' : 'All caught up'}</div>
          </div>
          <button className="btn btn-g btn-sm" onClick={handleMarkAllRead}>Mark all read</button>
        </div>
        <PushRow />
        <div className="np-body">
          {!notifs.length ? (
            <div className="np-empty"><Mi>notifications_none</Mi><p>No notifications yet</p></div>
          ) : (
            notifs.map(n => {
              const clr = NOTIF_CLR[n.type] || '#9CA3AF';
              const ico = NOTIF_ICO[n.type] || 'circle';
              return (
                <div key={n.id} className={`ni${n.read ? '' : ' unread'}`} onClick={() => handleNotifClick(n)}>
                  <div className="ni-ico" style={{ background: clr }}><Mi>{ico}</Mi></div>
                  <div className="ni-bd">
                    <div className="ni-msg">{n.message}</div>
                    <div className="ni-sub">{fmtAgo(n.timestamp)}</div>
                  </div>
                  {!n.read && <div className="ni-dot" />}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
