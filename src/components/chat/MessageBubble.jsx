import { useState } from 'react';
import Mi from '../Mi.jsx';

// Delivery ticks, mirroring WhatsApp: one tick sent, two delivered, two accented
// read, a clock while the relay hasn't confirmed, and a retry affordance on failure.
const TICK = {
  PENDING: { ico: 'schedule', cls: 'wa-tk-pend', title: 'Sending…' },
  SENT: { ico: 'done', cls: 'wa-tk-sent', title: 'Sent' },
  DELIVERED: { ico: 'done_all', cls: 'wa-tk-sent', title: 'Delivered' },
  READ: { ico: 'done_all', cls: 'wa-tk-read', title: 'Read' },
  FAILED: { ico: 'error_outline', cls: 'wa-tk-fail', title: 'Failed to send' },
};

const fmtTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const fmtSize = (b) => {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
};

const DOC_ICON = (mime = '', name = '') => {
  const s = (mime + ' ' + name).toLowerCase();
  if (s.includes('pdf')) return 'picture_as_pdf';
  if (s.includes('sheet') || s.includes('excel') || s.includes('.csv')) return 'table_view';
  if (s.includes('word') || s.includes('document')) return 'description';
  if (s.includes('zip') || s.includes('rar')) return 'folder_zip';
  return 'insert_drive_file';
};

export default function MessageBubble({ msg, onRetry, onOpenImage }) {
  const [imgErr, setImgErr] = useState(false);
  const out = msg.direction === 'OUT';
  const tick = TICK[msg.status] || TICK.SENT;
  // Media carries its text in `caption`; a plain text message uses `body`.
  const text = msg.type === 'text' ? msg.body : msg.caption;

  return (
    <div className={`wa-row${out ? ' out' : ''}`}>
      <div className={`wa-bub${out ? ' out' : ''}${msg.status === 'FAILED' ? ' failed' : ''}`}>
        {msg.type === 'image' && msg.mediaUrl && !imgErr && (
          <button className="wa-img" onClick={() => onOpenImage?.(msg)} title="Open image">
            <img src={msg.mediaUrl} alt={msg.mediaName || 'Image'} loading="lazy" onError={() => setImgErr(true)} />
          </button>
        )}

        {msg.type === 'image' && (!msg.mediaUrl || imgErr) && (
          <div className="wa-media-dead"><Mi>broken_image</Mi><span>Image unavailable</span></div>
        )}

        {(msg.type === 'document' || msg.type === 'video' || msg.type === 'audio') && (
          msg.mediaUrl ? (
            <a className="wa-doc" href={msg.mediaUrl} target="_blank" rel="noreferrer" download={msg.mediaName || undefined}>
              <div className="wa-doc-ico"><Mi>{msg.type === 'document' ? DOC_ICON(msg.mediaMime, msg.mediaName) : (msg.type === 'video' ? 'movie' : 'graphic_eq')}</Mi></div>
              <div className="wa-doc-meta">
                <div className="wa-doc-name">{msg.mediaName || msg.type}</div>
                <div className="wa-doc-sub">{[msg.mediaMime?.split('/')[1]?.toUpperCase(), fmtSize(msg.mediaSize)].filter(Boolean).join(' · ')}</div>
              </div>
              <Mi className="wa-doc-dl">download</Mi>
            </a>
          ) : (
            <div className="wa-media-dead"><Mi>attach_file</Mi><span>Attachment unavailable</span></div>
          )
        )}

        {text && <div className="wa-txt">{text}</div>}

        <div className="wa-meta">
          <span className="wa-time">{fmtTime(msg.waTimestamp)}</span>
          {out && <Mi className={`wa-tk ${tick.cls}`} style={{ fontSize: '15px' }}>{tick.ico}</Mi>}
        </div>

        {msg.status === 'FAILED' && (
          <div className="wa-fail">
            <span title={msg.error}>{msg.error ? msg.error.slice(0, 90) : 'Not delivered'}</span>
            <button className="wa-retry" onClick={() => onRetry?.(msg)}><Mi>refresh</Mi>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
