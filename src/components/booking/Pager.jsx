import Mi from '../Mi.jsx';

// Page controls under a booking table (Overview, Documents); `pg` comes from hooks/usePage.js.
export default function Pager({ pg }) {
  if (pg.pages <= 1) return null;
  const from = pg.page * pg.size + 1, to = Math.min(pg.total, from + pg.size - 1);
  return (
    <div className="pov-pg" role="navigation" aria-label="Pages">
      <span>{from}–{to} of {pg.total}</span>
      <button type="button" aria-label="Previous page" disabled={pg.page === 0} onClick={() => pg.go(pg.page - 1)}><Mi>chevron_left</Mi></button>
      <span>{pg.page + 1} / {pg.pages}</span>
      <button type="button" aria-label="Next page" disabled={pg.page >= pg.pages - 1} onClick={() => pg.go(pg.page + 1)}><Mi>chevron_right</Mi></button>
    </div>
  );
}
