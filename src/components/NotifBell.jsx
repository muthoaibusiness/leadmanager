import Mi from './Mi.jsx';
import { useApp } from '../context/AppContext.jsx';
import { getNotifs, getUnreadCount, markAllRead, markOneRead } from '../lib/db.js';
import { fmtAgo } from '../lib/helpers.js';
import { NOTIF_ICO, NOTIF_CLR } from '../lib/constants.js';

export default function NotifBell() {
  const { user, notifOpen, setNotifOpen, setPanLead, refreshDB, dbVersion } = useApp();

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
      <button className="notif-btn" onClick={() => setNotifOpen(o => !o)}>
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
        <div className="np-body">
          {!notifs.length ? (
            <div className="np-empty"><Mi>notifications_none</Mi><p>No notifications yet</p></div>
          ) : (
            notifs.map(n => {
              const clr = NOTIF_CLR[n.type] || '#64748B';
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
