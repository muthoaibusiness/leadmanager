import { useEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import ChatThread from './ChatThread.jsx';
import ChatComposer from './ChatComposer.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  waFindOrCreateConversation, waLoadMessages, waMarkRead, waSendMessage, waRetry,
  waSubscribe, mergeStatus, waCanChatLead, WA_ACCOUNT_LABEL, waLoadSettings,
} from '../../lib/wa.js';

// One customer's WhatsApp thread, opened from the lead panel. Deliberately not
// the inbox: no rail, no other threads — only this lead's conversation, on the
// number their team uses (Dubai team → Dubai session, everyone else → Eyad).
export default function LeadChatModal() {
  const { user, waSettings, setWaSettings, chatTarget, setChatTarget, showToast } = useApp();
  const isOpen = !!chatTarget;

  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [connState, setConnState] = useState('connecting');
  const convIdRef = useRef(null);
  useEffect(() => { convIdRef.current = conv?.id || null; }, [conv?.id]);

  const close = () => { setChatTarget(null); setConv(null); setMsgs([]); setErr(''); };

  // ── resolve the thread, then its history ──────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLoading(true);
    setErr('');
    setConv(null);
    setMsgs([]);
    // Settings are otherwise read once at login; an admin may have changed the
    // relay URL since, so refresh them on every open.
    waLoadSettings().then(s => { if (alive && s) setWaSettings(s); }).catch(() => {});
    (async () => {
      const res = await waFindOrCreateConversation(chatTarget);
      if (!alive) return;
      if (!res.ok) { setErr(res.error); setLoading(false); return; }
      setConv(res.conversation);
      try {
        const list = await waLoadMessages(res.conversation.id);
        if (!alive) return;
        setMsgs(list);
        if (res.conversation.unreadCount > 0) waMarkRead(res.conversation.id);
      } catch {
        if (alive) setErr('Could not load this conversation.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isOpen, chatTarget, setWaSettings]);

  // ── realtime, filtered to this one thread ─────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const unsub = waSubscribe({
      onState: setConnState,
      onMessage: (m) => {
        if (m.conversationId !== convIdRef.current) return;
        setMsgs(prev => {
          const i = prev.findIndex(x => x.id === m.id);
          if (i === -1) return [...prev, m].sort((a, b) => new Date(a.waTimestamp) - new Date(b.waTimestamp));
          const next = prev.slice();
          next[i] = { ...m, status: mergeStatus(prev[i].status, m.status) };
          return next;
        });
        if (m.direction === 'IN') waMarkRead(m.conversationId);
      },
      onConversation: (c) => {
        if (c.id !== convIdRef.current) return;
        setConv(prev => (prev ? { ...prev, ...c, unreadCount: 0 } : prev));
      },
    });
    return unsub;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const canChat = waCanChatLead(user, waSettings);
  const relayMissing = !waSettings?.relayUrl;
  const disabledReason = !canChat
    ? 'Chat is switched off for your account.'
    : relayMissing
      ? 'No relay URL configured — an admin must set it in Chat Settings.'
      : !conv
        ? 'Opening the conversation…'
        : '';

  const handleSend = async (payload) => {
    if (!conv) return;
    const res = await waSendMessage(waSettings, { conversation: conv, user, ...payload });
    if (res.optimistic) setMsgs(prev => (prev.some(m => m.id === res.optimistic.id) ? prev : [...prev, res.optimistic]));
    if (!res.ok) {
      setMsgs(prev => prev.map(m => (m.id === res.optimistic?.id ? { ...m, status: 'FAILED', error: res.error } : m)));
      showToast(res.error || 'Message failed to send.', 'err');
    }
  };

  const handleRetry = async (msg) => {
    if (!conv) return;
    setMsgs(prev => prev.filter(m => m.id !== msg.id));
    const res = await waRetry(waSettings, msg, conv, user);
    if (res.optimistic) setMsgs(prev => [...prev, res.optimistic]);
    if (!res.ok) showToast(res.error || 'Retry failed.', 'err');
  };

  const title = chatTarget.name || conv?.name || chatTarget.phone;
  const account = conv?.account;

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wa-lead-modal">
        <header className="wa-head">
          <div className="wa-head-id">
            <div className="wa-head-name">{title}</div>
            <div className="wa-head-sub">
              {chatTarget.phone}
              {account && <span className={`wa-acct-chip wa-acct-${account}`}><Mi>sim_card</Mi>{WA_ACCOUNT_LABEL[account] || account}</span>}
              {connState !== 'online' && <span className="wa-offline"><Mi>cloud_off</Mi>{connState === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>}
            </div>
          </div>
          <button className="m-x" onClick={close} title="Close"><Mi>close</Mi></button>
        </header>

        {err
          ? (
            <div className="wa-gate-inline">
              <Mi>error_outline</Mi>
              <span>{err}</span>
              <button className="btn btn-g" onClick={close}>Close</button>
            </div>
          )
          : <ChatThread messages={msgs} loading={loading} onRetry={handleRetry} />}

        <ChatComposer disabled={!!disabledReason || !!err} disabledReason={disabledReason} onSend={handleSend} />
      </div>
    </div>
  );
}
