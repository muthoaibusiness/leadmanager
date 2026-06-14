import { Pagination as Ark } from '@ark-ui/react/pagination';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

// Numbered pagination (Ark UI) — first / prev / pages + ellipsis / next / last.
// Adapted to this project's plain-JSX + CSS stack (Tailwind classes → .pg-*).
// Controlled via the existing app API: page is 0-based; onChange gets 0-based.
export default function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  return (
    <div className="pg-wrap">
      <span className="pg-info">Showing {start}–{end} of {total}</span>
      <Ark.Root
        count={total}
        pageSize={pageSize}
        page={page + 1}
        siblingCount={1}
        onPageChange={(d) => onChange(d.page - 1)}
        className="pg"
      >
        <Ark.Context>
          {(p) => (
            <button type="button" className="pg-btn" title="First page" onClick={() => p.goToFirstPage()} disabled={p.page === 1}>
              <ChevronsLeft size={16} />
            </button>
          )}
        </Ark.Context>

        <Ark.PrevTrigger className="pg-btn" title="Previous"><ChevronLeft size={16} /></Ark.PrevTrigger>

        <Ark.Context>
          {(p) => p.pages.map((pg, i) =>
            pg.type === 'page'
              ? <Ark.Item key={i} {...pg} className="pg-item">{pg.value}</Ark.Item>
              : <Ark.Ellipsis key={i} index={i} className="pg-ellipsis">…</Ark.Ellipsis>
          )}
        </Ark.Context>

        <Ark.NextTrigger className="pg-btn" title="Next"><ChevronRight size={16} /></Ark.NextTrigger>

        <Ark.Context>
          {(p) => (
            <button type="button" className="pg-btn" title="Last page" onClick={() => p.goToLastPage()} disabled={p.page === p.totalPages}>
              <ChevronsRight size={16} />
            </button>
          )}
        </Ark.Context>
      </Ark.Root>
    </div>
  );
}
