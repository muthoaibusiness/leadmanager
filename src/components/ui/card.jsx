import { forwardRef } from 'react';
import { cn } from '../../lib/utils.js';

// shadcn Card primitives, adapted to this project's plain-JSX + CSS stack.
// Same API/exports as shadcn; Tailwind utility classes replaced with real CSS
// (.sc-card*) styled with the app's dark theme tokens. Consumer `className`
// still passes through via cn().
const Card = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('sc-card', className)} {...props} />
));
Card.displayName = 'Card';

const CardHeader = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('sc-card-hd', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('sc-card-title', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('sc-card-desc', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('sc-card-content', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('sc-card-ft', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
