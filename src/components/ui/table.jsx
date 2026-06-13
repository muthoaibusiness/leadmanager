import { forwardRef } from 'react';
import { cn } from '../../lib/utils.js';

// originui/shadcn Table primitives, adapted to this project's plain-JSX + CSS
// stack. Same API/exports; Tailwind utility classes replaced with .tbl-* CSS.
const Table = forwardRef(({ className, ...props }, ref) => (
  <div className="tbl-wrap">
    <table ref={ref} className={cn('tbl', className)} {...props} />
  </div>
));
Table.displayName = 'Table';

const TableHeader = forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('tbl-head', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('tbl-body', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = forwardRef(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('tbl-foot', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

const TableRow = forwardRef(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn('tbl-row', className)} {...props} />
));
TableRow.displayName = 'TableRow';

const TableHead = forwardRef(({ className, ...props }, ref) => (
  <th ref={ref} className={cn('tbl-th', className)} {...props} />
));
TableHead.displayName = 'TableHead';

const TableCell = forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('tbl-td', className)} {...props} />
));
TableCell.displayName = 'TableCell';

const TableCaption = forwardRef(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('tbl-cap', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
