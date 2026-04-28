import Mi from './Mi.jsx';

export default function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  const pages = [];
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  return (
    <div className="pgn">
      <span className="pgn-info">Showing {start}–{end} of {total}</span>
      <div className="pgn-btns">
        <button className="pgn-btn" disabled={page === 0} onClick={() => onChange(page - 1)}>
          <Mi>chevron_left</Mi>
        </button>
        {pages.map((p, i) =>
          p === '...'
            ? <span key={'e' + i} className="pgn-ellipsis">…</span>
            : <button key={p} className={`pgn-btn${page === p ? ' on' : ''}`} onClick={() => onChange(p)}>{p + 1}</button>
        )}
        <button className="pgn-btn" disabled={page === totalPages - 1} onClick={() => onChange(page + 1)}>
          <Mi>chevron_right</Mi>
        </button>
      </div>
    </div>
  );
}
