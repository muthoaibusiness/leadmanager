import { useMemo, useState } from 'react';
import Mi from '../Mi.jsx';
import { avc, ini } from '../../lib/helpers.js';
import { WA_ACCOUNTS, WA_ACCOUNT_LABEL } from '../../lib/wa.js';

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 7 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

// Conversation rail. Ordering is driven purely by last_message_at, so a realtime
// insert naturally lifts its thread to the top without extra bookkeeping.
export default function ChatList({ conversations, activeId, onSelect, connState, loading }) {
  const [q, setQ] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [account, setAccount] = useState('all');

  // Which WhatsApp numbers the viewer has threads on; the picker only shows
  // when there is more than one to choose between.
  const accountCounts = useMemo(() => {
    const m = {};
    for (const c of conversations) m[c.account] = (m[c.account] || 0) + 1;
    return m;
  }, [conversations]);
  const accounts = WA_ACCOUNTS.filter(a => accountCounts[a]);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return conversations
      .filter(c => account === 'all' || c.account === account)
      .filter(c => !onlyUnread || c.unreadCount > 0)
      .filter(c => !ql
        || (c.name || '').toLowerCase().includes(ql)
        || (c.phone || '').includes(ql)
        || (c.lastMessagePreview || '').toLowerCase().includes(ql))
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
  }, [conversations, q, onlyUnread, account]);

  const scoped = account === 'all' ? conversations : conversations.filter(c => c.account === account);
  const totalUnread = scoped.reduce((s, c) => s + (c.unreadCount || 0), 0);

  return (
    <aside className="wa-list">
      <div className="wa-list-head">
        <div className="wa-list-title">
          <Mi>forum</Mi>
          <span>Chats</span>
          {totalUnread > 0 && <span className="wa-badge">{totalUnread}</span>}
          <span className={`wa-conn wa-conn-${connState}`} title={`Realtime: ${connState}`} />
        </div>
        <div className="wa-search">
          <Mi>search</Mi>
          <input placeholder="Search name, number or message" value={q} onChange={e => setQ(e.target.value)} />
          {q && <button className="wa-search-x" onClick={() => setQ('')}><Mi>close</Mi></button>}
        </div>
        <div className="wa-filters">
          <button className={`ftab${!onlyUnread ? ' on' : ''}`} onClick={() => setOnlyUnread(false)}>All</button>
          <button className={`ftab${onlyUnread ? ' on' : ''}`} onClick={() => setOnlyUnread(true)}>
            Unread{totalUnread > 0 ? ` (${totalUnread})` : ''}
          </button>
        </div>
        {accounts.length > 1 && (
          <div className="wa-filters" role="group" aria-label="WhatsApp number">
            <button className={`ftab${account === 'all' ? ' on' : ''}`} onClick={() => setAccount('all')}>Both ({conversations.length})</button>
            {accounts.map(a => (
              <button key={a} className={`ftab${account === a ? ' on' : ''}`} onClick={() => setAccount(a)}>
                {(WA_ACCOUNT_LABEL[a] || a).replace(' WhatsApp', '')} ({accountCounts[a]})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="wa-list-body">
        {loading && (
          <div className="wa-skel-wrap">
            {[0, 1, 2, 3, 4].map(i => (
              <div className="wa-skel" key={i}>
                <div className="wa-skel-av" />
                <div className="wa-skel-tx"><span /><span /></div>
              </div>
            ))}
          </div>
        )}

        {!loading && !rows.length && (
          <div className="wa-empty-sm">
            <Mi>chat_bubble_outline</Mi>
            <p>{q || onlyUnread ? 'No conversation matches.' : 'No conversations yet.'}</p>
            {!q && !onlyUnread && <span>Incoming WhatsApp messages will appear here.</span>}
          </div>
        )}

        {!loading && rows.map(c => (
          <button
            key={c.id}
            className={`wa-ci${c.id === activeId ? ' on' : ''}${c.unreadCount > 0 ? ' unread' : ''}`}
            onClick={() => onSelect(c)}
          >
            {c.avatarUrl
              ? <img className="wa-ci-av wa-ci-img" src={c.avatarUrl} alt="" />
              : <div className="wa-ci-av" style={{ background: avc(c.name || c.phone) }}>{ini(c.name || c.phone)}</div>}

            <div className="wa-ci-mid">
              <div className="wa-ci-top">
                <span className="wa-ci-name">{c.name || c.phone}</span>
                <span className="wa-ci-when">{fmtWhen(c.lastMessageAt)}</span>
              </div>
              <div className="wa-ci-bot">
                <span className="wa-ci-prev">
                  {c.lastMessageDir === 'OUT' && <Mi className="wa-ci-out">reply</Mi>}
                  {c.lastMessagePreview || '—'}
                </span>
                {c.unreadCount > 0 && <span className="wa-ci-badge">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}
              </div>
              {c.source === 'AD' && (
                <span className="wa-src-chip"><Mi>campaign</Mi>{c.adMeta?.title ? c.adMeta.title.slice(0, 28) : 'Ad click'}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
