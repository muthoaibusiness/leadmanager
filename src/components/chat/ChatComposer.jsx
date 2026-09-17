import { useRef, useState, useEffect } from 'react';
import Mi from '../Mi.jsx';

// Compose bar: text only for now. Media (image / document) is deliberately
// left out of this pass — waSendMessage and the relay already understand it,
// so attachments can return here without touching the send path.
export default function ChatComposer({ disabled, disabledReason, onSend }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);

  // Auto-grow the textarea up to a ceiling, like the desktop client.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
  }, [text]);

  const submit = async () => {
    if (disabled || busy) return;
    const body = text.trim();
    if (!body) return;

    setBusy(true);
    try {
      await onSend({ type: 'text', body });
      setText('');
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  if (disabled) {
    return (
      <div className="wa-comp wa-comp-off">
        <Mi>lock</Mi>
        <span>{disabledReason || 'Sending is unavailable.'}</span>
      </div>
    );
  }

  return (
    <div className="wa-comp">
      <div className="wa-comp-row">
        <textarea
          ref={taRef}
          className="wa-ta"
          rows={1}
          placeholder="Type a message"
          value={text}
          disabled={busy}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
        />

        <button
          className="wa-send"
          title="Send"
          disabled={busy || !text.trim()}
          onClick={submit}
        >
          <Mi>{busy ? 'hourglass_top' : 'send'}</Mi>
        </button>
      </div>
    </div>
  );
}
