import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.jsx';

// Clean dark customers table (same shadcn table primitives, adapted). Columns:
// Name · Phone · Project · Status · Value. Data-driven via `rows`.
const statusClass = (tone) =>
  tone === 'won' ? 'cot-badge ok' : tone === 'lost' ? 'cot-badge off' : 'cot-badge warn';

export default function CustomersTable({
  title = 'Customers',
  subtitle = 'Latest customers in your pipeline',
  rows = [],
  plain = false,
}) {
  return (
    <div className={`cot-card${plain ? ' cot-plain' : ''}`}>
      <div className="cot-head">
        <h2 className="cot-title">{title}</h2>
        {subtitle && <div className="cot-sub">{subtitle}</div>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="cot-name-col">Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="cot-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="cot-strong">{r.name}</TableCell>
              <TableCell className="cot-muted">{r.phone || '—'}</TableCell>
              <TableCell className="cot-muted">{r.project || '—'}</TableCell>
              <TableCell><span className={statusClass(r.tone)}>{r.status}</span></TableCell>
              <TableCell className="cot-right">{r.value}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow><TableCell colSpan={5} className="cot-empty">No customers yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
