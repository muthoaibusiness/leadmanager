import { useRef, useState, useEffect } from 'react';
import Mi from '../Mi.jsx';
import { waUploadMedia } from '../../lib/wa.js';

const MAX_MB = 16; // WhatsApp rejects larger media on most account tiers

// Compose bar: text, image and document. Attachments upload to Supabase Storage
// first, then the public URL is what the relay hands to Wasender — the file
// itself never passes through the webhook body.
export default function ChatComposer({ disabled, disabledReason, onSend }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(null); // { file, kind, previewUrl, progress }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const taRef = useRef(null);
  const imgRef = useRef(null);
  const docRef = useRef(null);

  // Auto-grow the textarea up to a ceiling, like the desktop client.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 132) + 'px';
  }, [text]);

  // Revoke the object URL when the staged image changes or unmounts.
  useEffect(() => {
    const url = pending?.previewUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [pending?.previewUrl]);

  const pick = (kind) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked twice in a row
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`File is over ${MAX_MB} MB.`); return; }
    setErr('');
    setPending({ file, kind, previewUrl: kind === 'image' ? URL.createObjectURL(file) : '', progress: 0 });
  };

  const clearPending = () => setPending(null);

  const submit = async () => {
    if (disabled || busy) return;
    const body = text.trim();
    if (!pending && !body) return;

    setBusy(true);
    setErr('');
    try {
      if (pending) {
        setPending(p => ({ ...p, progress: 5 }));
        const up = await waUploadMedia(pending.file, (p) => setPending(cur => (cur ? { ...cur, progress: p } : cur)));
        if (!up.ok) { setErr(up.error || 'Upload failed.'); setBusy(false); return; }
        await onSend({
          type: pending.kind,
          body,                            // becomes the media caption
          mediaUrl: up.url,
          mediaMime: pending.file.type || '',
          mediaName: pending.file.name || '',
          mediaSize: pending.file.size || 0,
        });
        setPending(null);
      } else {
        await onSend({ type: 'text', body });
      }
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
      {err && <div className="wa-comp-err"><Mi>error_outline</Mi>{err}<button onClick={() => setErr('')}><Mi>close</Mi></button></div>}

      {pending && (
        <div className="wa-att">
          {pending.kind === 'image' && pending.previewUrl
            ? <img className="wa-att-thumb" src={pending.previewUrl} alt="" />
            : <div className="wa-att-ico"><Mi>insert_drive_file</Mi></div>}
          <div className="wa-att-meta">
            <div className="wa-att-name">{pending.file.name}</div>
            <div className="wa-att-sub">{(pending.file.size / 1024).toFixed(0)} KB · {pending.kind}</div>
            {busy && <div className="wa-att-bar"><span style={{ width: `${pending.progress || 5}%` }} /></div>}
          </div>
          {!busy && <button className="wa-att-x" onClick={clearPending} title="Remove"><Mi>close</Mi></button>}
        </div>
      )}

      <div className="wa-comp-row">
        <input ref={imgRef} type="file" accept="image/*" hidden onChange={pick('image')} />
        <input ref={docRef} type="file" hidden onChange={pick('document')} />

        <button className="wa-cbtn" title="Send image" disabled={busy} onClick={() => imgRef.current?.click()}>
          <Mi>image</Mi>
        </button>
        <button className="wa-cbtn" title="Send document" disabled={busy} onClick={() => docRef.current?.click()}>
          <Mi>attach_file</Mi>
        </button>

        <textarea
          ref={taRef}
          className="wa-ta"
          rows={1}
          placeholder={pending ? 'Add a caption…' : 'Type a message'}
          value={text}
          disabled={busy}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
        />

        <button
          className="wa-send"
          title="Send"
          disabled={busy || (!text.trim() && !pending)}
          onClick={submit}
        >
          <Mi>{busy ? 'hourglass_top' : 'send'}</Mi>
        </button>
      </div>
    </div>
  );
}
