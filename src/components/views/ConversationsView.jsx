import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Mi from '../Mi.jsx';
import ChatList from '../chat/ChatList.jsx';
import ChatThread from '../chat/ChatThread.jsx';
import ChatComposer from '../chat/ChatComposer.jsx';
import ChatLeadPane from '../chat/ChatLeadPane.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { getDB, getLead } from '../../lib/db.js';
import { pushNotify } from '../../lib/pushNotify.js';
import {
  waLoadConversations, waLoadMessages, waMarkRead, waSendMessage, waRetry,
  waSubscribe, matchLead, mergeStatus, isChatAdmin,
} from '../../lib/wa.js';

export default function ConversationsView() {
  const { user, waSettings, chatOk, setWaUnread, openModal, dbVersion, showToast } = useApp();

  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [connState, setConnState] = useState('connecting');
  const [loadErr, setLoadErr] = useState('');
  const [showPane, setShowPane] = useState(true);

  // Realtime callbacks are registered once, so they read live values via refs
  // rather than closing over stale state.
  const activeIdRef = useRef(null);
  const visibleRef = useRef(true);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const active = useMemo(() => convs.find(c => c.id === activeId) || null, [convs, activeId]);
  const leads = getDB().leads || [];
  // dbVersion is a dependency so a lead created elsewhere re-resolves the link.
  const lead = useMemo(
    () => (active ? (active.leadId ? getLead(active.leadId) || matchLead(active, leads) : matchLead(active, leads)) : null),
    [active, leads, dbVersion]
  );

  // ── initial load ──────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoadingConvs(true);
    setLoadErr('');
    try {
      const list = await waLoadConversations();
      setConvs(list);
    } catch (e) {
      setLoadErr(e.message || 'Could not load conversations.');
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { if (chatOk) reload(); }, [chatOk, reload]);

  // Publish the unread total so the sidebar badge stays in step.
  useEffect(() => {
    setWaUnread(convs.reduce((s, c) => s + (c.unreadCount || 0), 0));
  }, [convs, setWaUnread]);

  useEffect(() => {
    const h = () => { visibleRef.current = document.visibilityState === 'visible'; };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  // ── realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatOk) return;

    const unsub = waSubscribe({
      onState: setConnState,

      onMessage: (m) => {
        // Thread currently open → merge into the visible transcript.
        if (m.conversationId === activeIdRef.current) {
          setMsgs(prev => {
            const i = prev.findIndex(x => x.id === m.id);
            if (i === -1) return [...prev, m].sort((a, b) => new Date(a.waTimestamp) - new Date(b.waTimestamp));
            const next = prev.slice();
            next[i] = { ...m, status: mergeStatus(prev[i].status, m.status) };
            return next;
          });
          if (m.direction === 'IN') waMarkRead(m.conversationId);
        }

        // Keep the rail's preview/order correct even for threads that aren't open.
        setConvs(prev => {
          const i = prev.findIndex(c => c.id === m.conversationId);
          if (i === -1) { reload(); return prev; }   // first message of a brand-new thread
          const c = prev[i];
          const isNewInbound = m.direction === 'IN';
          const bumped = {
            ...c,
            lastMessageAt: m.waTimestamp,
            lastMessagePreview: m.type === 'text' ? m.body : (m.mediaName || m.type),
            lastMessageDir: m.direction,
            unreadCount: isNewInbound && m.conversationId !== activeIdRef.current
              ? (c.unreadCount || 0) + 1
              : (m.conversationId === activeIdRef.current ? 0 : c.unreadCount),
          };
          const next = prev.slice();
          next[i] = bumped;
          return next;
        });

        // Instant notification for inbound messages the agent isn't looking at.
        if (m.direction === 'IN') {
          const suppress = visibleRef.current && m.conversationId === activeIdRef.current;
          pushNotify(
            { id: 'wa-' + m.id, message: `${m.senderName || m.phone}: ${m.type === 'text' ? (m.body || '') : m.type}`.slice(0, 140) },
            { suppress, onClick: () => { setActiveId(m.conversationId); window.focus(); } }
          );
        }
      },

      onConversation: (c) => {
        setConvs(prev => {
          const i = prev.findIndex(x => x.id === c.id);
          if (i === -1) return [c, ...prev];
          const next = prev.slice();
          // Don't let a stale broadcast resurrect a badge on the open thread.
          next[i] = { ...c, unreadCount: c.id === activeIdRef.current ? 0 : c.unreadCount };
          return next;
        });
      },
    });

    return unsub;
  }, [chatOk, reload]);

  // ── open a thread ─────────────────────────────────────────────────────────
  const openConv = useCallback(async (c) => {
    setActiveId(c.id);
    setLoadingMsgs(true);
    setMsgs([]);
    try {
      const list = await waLoadMessages(c.id);
      setMsgs(list);
      if (c.unreadCount > 0) {
        await waMarkRead(c.id);
        setConvs(prev => prev.map(x => (x.id === c.id ? { ...x, unreadCount: 0 } : x)));
      }
    } catch {
      showToast('Could not load that conversation.', 'err');
    } finally {
      setLoadingMsgs(false);
    }
  }, [showToast]);

  // ── send / retry ──────────────────────────────────────────────────────────
  const handleSend = async (payload) => {
    if (!active) return;
    const res = await waSendMessage(waSettings, { conversation: active, user, ...payload });
    if (res.optimistic) {
      setMsgs(prev => (prev.some(m => m.id === res.optimistic.id) ? prev : [...prev, res.optimistic]));
      setConvs(prev => prev.map(c => (c.id === active.id
        ? { ...c, lastMessageAt: res.optimistic.waTimestamp, lastMessageDir: 'OUT', lastMessagePreview: payload.type === 'text' ? payload.body : (payload.mediaName || payload.type) }
        : c)));
    }
    if (!res.ok) {
      setMsgs(prev => prev.map(m => (m.id === res.optimistic?.id ? { ...m, status: 'FAILED', error: res.error } : m)));
      showToast(res.error || 'Message failed to send.', 'err');
    }
  };

  const handleRetry = async (msg) => {
    if (!active) return;
    setMsgs(prev => prev.filter(m => m.id !== msg.id));
    const res = await waRetry(waSettings, msg, active, user);
    if (res.optimistic) setMsgs(prev => [...prev, res.optimistic]);
    if (!res.ok) showToast(res.error || 'Retry failed.', 'err');
  };

  // ── gates ─────────────────────────────────────────────────────────────────
  if (!chatOk) {
    return (
      <div className="wa-gate">
        <Mi>lock</Mi>
        <h3>Conversations isn't enabled for your account</h3>
        <p>Ask an administrator to grant chat access from Chat Settings.</p>
      </div>
    );
  }

  const relayMissing = !waSettings?.relayUrl;
  const disabledReason = !waSettings?.enabled
    ? 'Chat is switched off in Chat Settings.'
    : relayMissing
      ? 'No relay URL configured — an admin must set it in Chat Settings.'
      : !active
        ? 'Select a conversation to reply.'
        : '';

  return (
    <div className="wa-wrap">
      <div className="wa-bar">
        <div className="wa-bar-l">
          <h2 className="wa-bar-t">Conversations</h2>
          <span className="wa-bar-sub">WhatsApp · {convs.length} thread{convs.length === 1 ? '' : 's'}</span>
        </div>
        <div className="wa-bar-r">
          {connState !== 'online' && (
            <span className="wa-offline">
              <Mi>cloud_off</Mi>
              {connState === 'connecting' ? 'Connecting…'
                : connState === 'error' ? 'Realtime rejected — check the console'
                : 'Reconnecting…'}
            </span>
          )}
          <button className="btn btn-g" onClick={reload} title="Reload"><Mi>refresh</Mi></button>
          {isChatAdmin(user) && (
            <button className="btn btn-g" onClick={() => openModal('chat-settings')}><Mi>settings</Mi>Chat Settings</button>
          )}
        </div>
      </div>

      {loadErr && (
        <div className="wa-err">
          <Mi>error_outline</Mi>
          <span>{loadErr}</span>
          <button className="btn btn-g" onClick={reload}>Retry</button>
        </div>
      )}

      {relayMissing && isChatAdmin(user) && (
        <div className="wa-warn">
          <Mi>info</Mi>
          <span>No relay URL is set, so replies can't be delivered. Open Chat Settings to finish setup.</span>
        </div>
      )}

      {/* wa-grid-list keeps the rail (not the transcript) on screen on phones
          while no thread is open. */}
      <div className={`wa-grid${showPane && active ? '' : ' wa-grid-2'}${active ? '' : ' wa-grid-list'}`}>
        <ChatList
          conversations={convs}
          activeId={activeId}
          onSelect={openConv}
          connState={connState}
          loading={loadingConvs}
        />

        <section className="wa-main">
          {!active && (
            <div className="wa-empty">
              <Mi>forum</Mi>
              <h3>Select a conversation</h3>
              <p>Pick a chat on the left to read the history and reply.</p>
            </div>
          )}

          {active && (
            <>
              <header className="wa-head">
                <button className="wa-back" title="Back to chats" onClick={() => setActiveId(null)}><Mi>arrow_back</Mi></button>
                <div className="wa-head-id">
                  <div className="wa-head-name">{active.name || active.phone}</div>
                  <div className="wa-head-sub">
                    {active.phone}
                    {active.source === 'AD' && <span className="wa-src-chip"><Mi>campaign</Mi>From ad</span>}
                    {lead && <span className="wa-link-chip"><Mi>link</Mi>{lead.name}</span>}
                  </div>
                </div>
                <button
                  className={`wa-cbtn${showPane ? ' on' : ''}`}
                  title={showPane ? 'Hide details' : 'Show details'}
                  onClick={() => setShowPane(v => !v)}
                >
                  <Mi>info</Mi>
                </button>
              </header>

              <ChatThread messages={msgs} loading={loadingMsgs} onRetry={handleRetry} />

              <ChatComposer
                disabled={!!disabledReason}
                disabledReason={disabledReason}
                onSend={handleSend}
              />
            </>
          )}
        </section>

        {showPane && active && (
          <ChatLeadPane
            conv={active}
            lead={lead}
            onLinked={(id) => setConvs(prev => prev.map(c => (c.id === active.id ? { ...c, leadId: id } : c)))}
          />
        )}
      </div>
    </div>
  );
}
