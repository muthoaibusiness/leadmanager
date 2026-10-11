import { Children, createContext, useContext, useId } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import './select.css';

// Select (adapted from a jolly-ui / react-aria-components .tsx to this
// project's plain-JSX + CSS stack, like color-emotion-select.jsx): the same
// pieces, built on the radix Select that is already a dependency. Tailwind
// utilities replaced with .sel-* CSS (theme tokens).
//
//   <Select value onChange placeholder>       radix Root in a wrapper div
//     <SelectLabel>Floor</SelectLabel>         optional visible label
//     <SelectTrigger><SelectValue /></SelectTrigger>
//     <SelectPopover><SelectListBox>
//       <SelectItem value="a" description="25 available">4th Floor</SelectItem>
//     </SelectListBox></SelectPopover>
//   </Select>
//
// An item's `description` shows in the list only, never in the trigger.

const LabelCtx = createContext(null);

function Select({ className, value, defaultValue, onChange, placeholder, disabled, name, children }) {
  const id = useId();
  // The trigger is named by a SelectLabel child when there is one.
  const labelId = Children.toArray(children).some(c => c?.type === SelectLabel) ? id : null;
  return (
    <LabelCtx.Provider value={{ labelId, placeholder }}>
      <div className={cn('sel', className)}>
        <SelectPrimitive.Root value={value} defaultValue={defaultValue} onValueChange={onChange} disabled={disabled} name={name}>
          {children}
        </SelectPrimitive.Root>
      </div>
    </LabelCtx.Provider>
  );
}

// Visible label; the trigger is named by it.
function SelectLabel({ className, children }) {
  const { labelId } = useContext(LabelCtx) || {};
  return <span id={labelId || undefined} className={cn('sel-label', className)}>{children}</span>;
}

function SelectValue({ className, placeholder }) {
  const ctx = useContext(LabelCtx) || {};
  return (
    <span className={cn('sel-value', className)}>
      <SelectPrimitive.Value placeholder={<span className="sel-ph">{placeholder ?? ctx.placeholder}</span>} />
    </span>
  );
}

// `aria-label` names it when there is no SelectLabel.
function SelectTrigger({ className, children, ...props }) {
  const { labelId } = useContext(LabelCtx) || {};
  return (
    <SelectPrimitive.Trigger className={cn('sel-trigger', className)} aria-labelledby={!props['aria-label'] && labelId ? labelId : undefined} {...props}>
      {children}
      <SelectPrimitive.Icon className="sel-chev"><ChevronDown size={16} strokeWidth={2.5} aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

// The list, in a portal above everything (modals included). Esc closes the
// list only; it must not reach handlers that would close whatever the select
// sits in (a modal, a panel).
function SelectPopover({ className, align = 'start', children }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className={cn('sel-content', className)} position="popper" sideOffset={6} align={align}
        onEscapeKeyDown={(e) => e.stopPropagation()}>
        {children}
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectListBox({ className, children }) {
  return <SelectPrimitive.Viewport className={cn('sel-list', className)}>{children}</SelectPrimitive.Viewport>;
}

function SelectItem({ className, value, description, disabled, children }) {
  return (
    <SelectPrimitive.Item value={value} disabled={disabled} className={cn('sel-item', className)}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {description != null && <span className="sel-desc">{description}</span>}
      <SelectPrimitive.ItemIndicator className="sel-check"><Check size={15} strokeWidth={3} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

const SelectSection = ({ className, children }) => <SelectPrimitive.Group className={cn('sel-section', className)}>{children}</SelectPrimitive.Group>;
const SelectHeader = ({ className, children }) => <SelectPrimitive.Label className={cn('sel-header', className)}>{children}</SelectPrimitive.Label>;

// All-in-one: label, trigger, optional description / error, and the list.
//   items  [{ value, label, description? }] (or pass SelectItems as children)
function JollySelect({ label, description, errorMessage, items, children, className, ...props }) {
  return (
    <Select className={cn('sel-jolly', className)} {...props}>
      {label && <SelectLabel>{label}</SelectLabel>}
      <SelectTrigger><SelectValue /></SelectTrigger>
      {description && <span className="sel-help">{description}</span>}
      {errorMessage && <span className="sel-error" role="alert">{errorMessage}</span>}
      <SelectPopover>
        <SelectListBox>
          {items ? items.map(it => <SelectItem key={it.value} value={it.value} description={it.description}>{it.label}</SelectItem>) : children}
        </SelectListBox>
      </SelectPopover>
    </Select>
  );
}

export { Select, SelectLabel, SelectValue, SelectTrigger, SelectItem, SelectPopover, SelectHeader, SelectListBox, SelectSection, JollySelect };
