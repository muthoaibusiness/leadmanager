import { useEffect, useRef, useState } from 'react';
import Mi from '../Mi.jsx';
import MessageBubble from './MessageBubble.jsx';

const dayLabel = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Message scroller. Sticks to the bottom while the agent is already there, but
// leaves the scroll position alone when they've scrolled up to read history —
// a jump-to-latest pill appears instead.
export default function ChatThread({ messages, loading, onRetry }) {
  const boxRef = useRef(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  const scrollToEnd = (behavior = 'auto') => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowJump(false);
  };

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setShowJump(!near);
  };

  useEffect(() => {
    if (atBottomRef.current) scrollToEnd();
  }, [messages.length]);

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!lightbox) return;
    const h = (e) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lightbox]);

  if (loading) {
    return (
      <div className="wa-thread">
        <div className="wa-thread-load"><span className="wa-spin" />Loading conversation…</div>
      </div>
    );
  }

  let lastDay = '';

  return (
    <div className="wa-thread-wrap">
      <div className="wa-thread" ref={boxRef} onScroll={onScroll}>
        {!messages.length && (
          <div className="wa-empty-sm wa-empty-thread">
            <Mi>waving_hand</Mi>
            <p>No messages yet</p>
            <span>Send the first message to start this conversation.</span>
          </div>
        )}

        {messages.map((m) => {
          const day = dayLabel(m.waTimestamp);
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {sep && <div className="wa-day"><span>{day}</span></div>}
              <MessageBubble msg={m} onRetry={onRetry} onOpenImage={setLightbox} />
            </div>
          );
        })}
      </div>

      {showJump && (
        <button className="wa-jump" onClick={() => scrollToEnd('smooth')} title="Jump to latest">
          <Mi>keyboard_double_arrow_down</Mi>
        </button>
      )}

      {lightbox && (
        <div className="wa-lb" onClick={() => setLightbox(null)}>
          <button className="wa-lb-x" onClick={() => setLightbox(null)}><Mi>close</Mi></button>
          <img src={lightbox.mediaUrl} alt={lightbox.mediaName || ''} onClick={e => e.stopPropagation()} />
          <a
            className="wa-lb-dl"
            href={lightbox.mediaUrl}
            target="_blank"
            rel="noreferrer"
            download={lightbox.mediaName || undefined}
            onClick={e => e.stopPropagation()}
          >
            <Mi>download</Mi>Download
          </a>
        </div>
      )}
    </div>
  );
}
