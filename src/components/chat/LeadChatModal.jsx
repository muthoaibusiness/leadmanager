import { useEffect, useRef, useState, useCallback } from 'react';
import Mi from '../Mi.jsx';
import ChatThread from './ChatThread.jsx';
import ChatComposer from './ChatComposer.jsx';
import { useApp } from '../../context/AppContext.jsx';
import {
  waFindOrCreateConversation, waLoadMessages, waMarkRead, waSendMessage, waRetry,
  waSubscribe, mergeStatus, WA_ACCOUNT_LABEL, isLeadAssignedOrForwardedTo, waAccountForUser,
} from '../../lib/wa.js';

// Dedicated per-lead WhatsApp chatting modal.
// Opened when an agent clicks the messaging icon on a lead.
export default function LeadChatModal() {
  const { user, waSettings, chatTarget, setChatTarget, showToast } = useApp();
  const isOpen = !!chatTarget;

  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const convIdRef = useRef(null);
  useEffect(() => {
    convIdRef.current = conv?.id || null;
  }, [conv?.id]);

  const canAccess = isOpen && isLeadAssignedOrForwardedTo(chatTarget, user);

  // Initialize or fetch the conversation for this lead
  useEffect(() => {
    if (!isOpen || !chatTarget || !canAccess) {
      setConv(null);
      setMsgs([]);
      setErr('');
      return;
    }

    let active = true;
    setLoading(true);
    setErr('');

    (async () => {
      try {
        const res = await waFindOrCreateConversation(chatTarget, user);
        if (!active) return;
        if (!res.ok || !res.conversation) {
          setErr(res.error || 'Could not find or open chat for this lead.');
          setLoading(false);
          return;
        }

        const c = res.conversation;
        setConv(c);

        const list = await waLoadMessages(c.id);
        if (!active) return;
        setMsgs(list);

        if (c.unreadCount > 0) {
          waMarkRead(c.id);
        }
      } catch (e) {
        if (!active) return;
        setErr(e.message || 'Error loading conversation.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen, chatTarget?.id, chatTarget?.phone, canAccess, user]);

  // Realtime subscription for incoming/outgoing updates on this conversation
  useEffect(() => {
    if (!isOpen || !conv?.id) return;

    const unsub = waSubscribe({
      onMessage: (m) => {
        if (m.conversationId === convIdRef.current) {
          setMsgs(prev => {
            const i = prev.findIndex(x => x.id === m.id);
            if (i === -1) return [...prev, m].sort((a, b) => new Date(a.waTimestamp) - new Date(b.waTimestamp));
            const next = prev.slice();
            next[i] = { ...m, status: mergeStatus(prev[i].status, m.status) };
            return next;
          });
          if (m.direction === 'IN') waMarkRead(m.conversationId);
        }
      },
      onConversation: (updatedConv) => {
        if (updatedConv.id === convIdRef.current) {
          setConv(prev => (prev ? { ...prev, ...updatedConv } : updatedConv));
        }
      },
    });

    return unsub;
  }, [isOpen, conv?.id]);

  const handleSend = useCallback(async (payload) => {
    if (!conv) return;
    const res = await waSendMessage(waSettings, { conversation: conv, user, ...payload });
    if (res.optimistic) {
      setMsgs(prev => (prev.some(m => m.id === res.optimistic.id) ? prev : [...prev, res.optimistic]));
    }
    if (!res.ok) {
      setMsgs(prev => prev.map(m => (m.id === res.optimistic?.id ? { ...m, status: 'FAILED', error: res.error } : m)));
      showToast(res.error || 'Message failed to send.', 'err');
    }
  }, [conv, user, waSettings, showToast]);

  const handleRetry = useCallback(async (msg) => {
    if (!conv) return;
    setMsgs(prev => prev.filter(m => m.id !== msg.id));
    const res = await waRetry(waSettings, msg, conv, user);
    if (res.optimistic) setMsgs(prev => [...prev, res.optimistic]);
    if (!res.ok) showToast(res.error || 'Retry failed.', 'err');
  }, [conv, user, waSettings, showToast]);

  if (!isOpen) return null;

  const currentAccount = conv?.account || waAccountForUser(user, chatTarget);
  const accountLabel = WA_ACCOUNT_LABEL[currentAccount] || 'WhatsApp';

  // The send endpoint is fixed at build time (WA_RELAY_URL), so it is never missing.
  const disabledReason = !waSettings?.enabled
    ? 'Chat is disabled globally.'
    : !conv
      ? 'Preparing conversation…'
      : '';

  return (
    <div className="mov on" onClick={e => { if (e.target === e.currentTarget) setChatTarget(null); }}>
      <div className="modal modal-chat" style={{
        maxWidth: '680px',
        width: '94%',
        height: '84vh',
        maxHeight: '760px',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        overflow: 'hidden',
        borderRadius: '16px',
        boxShadow: '0 20px 48px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div className="m-hd" style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--bd)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--surf)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: '#25D366',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              flexShrink: 0,
            }}>
              <Mi style={{ fontSize: '22px' }}>chat</Mi>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {chatTarget.name || 'Unnamed customer'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>{chatTarget.phone || 'No phone'}</span>
                <span className="bdg" style={{
                  background: currentAccount === 'dubai' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  color: currentAccount === 'dubai' ? '#3B82F6' : '#22C55E',
                  border: currentAccount === 'dubai' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(34, 197, 94, 0.3)',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                }}>
                  <Mi style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '3px' }}>send</Mi>
                  via {accountLabel}
                </span>
              </div>
            </div>
          </div>

          <button className="m-x" onClick={() => setChatTarget(null)} aria-label="Close chat">
            <Mi>close</Mi>
          </button>
        </div>

        {/* Content body */}
        {!canAccess ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center', gap: '10px' }}>
            <Mi style={{ fontSize: '48px', color: 'var(--orange)' }}>lock</Mi>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--t1)' }}>Restricted Access</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--t3)', maxWidth: '360px' }}>
              You can only view and participate in chats for leads that are assigned or forwarded to you.
            </p>
          </div>
        ) : err ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center', gap: '10px' }}>
            <Mi style={{ fontSize: '42px', color: 'var(--red)' }}>error_outline</Mi>
            <div style={{ color: 'var(--red)', fontSize: '14px', fontWeight: 600 }}>{err}</div>
            <button className="btn btn-g btn-sm" onClick={() => setChatTarget({ ...chatTarget })}>
              <Mi>refresh</Mi> Try again
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--surf2)' }}>
            <ChatThread messages={msgs} loading={loading} onRetry={handleRetry} />
          </div>
        )}

        {/* Composer Footer */}
        {canAccess && !err && (
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--bd)',
            background: 'var(--surf)',
            flexShrink: 0,
          }}>
            <ChatComposer
              disabled={!conv || loading || !!disabledReason}
              disabledReason={disabledReason}
              onSend={handleSend}
            />
          </div>
        )}
      </div>
    </div>
  );
}
