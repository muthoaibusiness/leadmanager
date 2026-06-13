import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './table.jsx';

// Contributors overview table (adapted from a shadcn/Tailwind .tsx to this
// project's plain-JSX + CSS stack). Data-driven: pass real CRM agents via
// `rows`; falls back to the original demo data. Tailwind → .cot-*/.tbl-* CSS.
const DEMO_ROWS = [
  { id: '1', name: 'Aarav Mehta', email: 'aarav@ruixen.dev', role: 'Bangalore, India', status: 'Active', balance: '₹45,000' },
  { id: '2', name: 'Elena Torres', email: 'elena.t@ruixen.dev', role: 'Barcelona, Spain', status: 'Active', balance: '₹22,000' },
  { id: '3', name: 'Kenji Nakamura', email: 'kenji.n@ruixen.dev', role: 'Tokyo, Japan', status: 'Inactive', balance: '₹0' },
  { id: '4', name: 'Leila Ahmed', email: 'leila.a@ruixen.dev', role: 'Cairo, Egypt', status: 'Pending', balance: '₹10,000' },
  { id: '5', name: 'Ryan Smith', email: 'ryan.s@ruixen.dev', role: 'Toronto, Canada', status: 'Active', balance: '₹31,500' },
];

const badgeClass = (status) =>
  status === 'Active' ? 'cot-badge ok' : status === 'Pending' ? 'cot-badge warn' : 'cot-badge off';

function ContributorsOverviewTable({
  title = 'Team Contributors',
  subtitle,
  plain = false,
  rows = DEMO_ROWS,
  total,
  roleHeader = 'Role',
  payoutHeader = 'Payout',
  caption = 'contributors payout summary',
}) {
  return (
    <div className={`cot-card${plain ? ' cot-plain' : ''}`}>
      <div className="cot-head">
        <h2 className="cot-title">{title}</h2>
        {subtitle && <div className="cot-sub">{subtitle}</div>}
      </div>
      <Table className="cot-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="cot-name-col">Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>{roleHeader}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="cot-right">{payoutHeader}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((person) => (
            <TableRow key={person.id}>
              <TableCell className="cot-strong">{person.name}</TableCell>
              <TableCell className="cot-muted">{person.email}</TableCell>
              <TableCell className="cot-muted">{person.role}</TableCell>
              <TableCell><span className={badgeClass(person.status)}>{person.status}</span></TableCell>
              <TableCell className="cot-right">{person.balance}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow><TableCell colSpan={5} className="cot-empty">No contributors yet.</TableCell></TableRow>
          )}
        </TableBody>
        {total != null && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="cot-right cot-strong">Total</TableCell>
              <TableCell className="cot-right cot-total">{total}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
      {caption && <p className="cot-cap">{caption}</p>}
    </div>
  );
}

export default ContributorsOverviewTable;
