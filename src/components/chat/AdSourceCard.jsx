import Mi from '../Mi.jsx';

// Where a conversation came from. A plain WhatsApp thread gets a one-line
// source row; a click-to-WhatsApp ad gets the full referral payload, since that
// context is what the agent opens the chat with.
export default function AdSourceCard({ conv }) {
  const ad = conv?.adMeta;
  const isAd = conv?.source === 'AD' && ad;

  if (!isAd) {
    return (
      <div className="wa-src">
        <div className="wa-src-head"><Mi>chat</Mi><span>Source</span></div>
        <div className="wa-src-plain">
          <span className="wa-src-tag">Direct WhatsApp</span>
          <span className="wa-src-note">Started by the customer messaging your business number.</span>
        </div>
      </div>
    );
  }

  const rows = [
    ['Conversion source', ad.conversionSource],
    ['Source URL', ad.sourceUrl],
  ].filter(([, v]) => v);

  return (
    <div className="wa-src wa-src-ad">
      <div className="wa-src-head"><Mi>campaign</Mi><span>Came from an ad</span></div>

      {ad.thumbnailUrl && (
        <div className="wa-ad-thumb"><img src={ad.thumbnailUrl} alt="" loading="lazy" /></div>
      )}

      {ad.title && <div className="wa-ad-title">{ad.title}</div>}
      {ad.description && <div className="wa-ad-desc">{ad.description}</div>}
      {ad.body && <div className="wa-ad-body">{ad.body}</div>}

      {rows.map(([k, v]) => (
        <div className="wa-ad-kv" key={k}>
          <span className="wa-ad-k">{k}</span>
          {k === 'Source URL'
            ? <a className="wa-ad-v wa-ad-link" href={v} target="_blank" rel="noreferrer" title={v}>{v}</a>
            : <span className="wa-ad-v">{v}</span>}
        </div>
      ))}

      {ad.greetingMessageBody && (
        <div className="wa-ad-greet">
          <div className="wa-ad-k">Greeting message</div>
          <div className="wa-ad-greet-tx">{ad.greetingMessageBody}</div>
        </div>
      )}
    </div>
  );
}
