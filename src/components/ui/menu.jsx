import { DropdownMenu as M } from 'radix-ui';
import Mi from '../Mi.jsx';
import { cn } from '../../lib/utils.js';
import './select.css';
import './menu.css';

// Action menu (a button that opens a list of commands), built on the radix
// DropdownMenu already in radix-ui; styled like ui/select.jsx's list.
//
//   <Menu trigger={<button className="btn btn-p">Manage</button>} label="Manage project">
//     <MenuItem icon="settings" onSelect={…}>Admin console</MenuItem>
//     <MenuSep />
//     <MenuItem icon="delete" danger onSelect={…}>Delete floor plan</MenuItem>
//   </Menu>
//
// `trigger` is the button itself (radix wires it up via asChild).
// `onCloseAutoFocus` (optional) is radix's: call e.preventDefault() in it to
// keep focus from returning to the trigger when the menu closes.

export function Menu({ trigger, label, align = 'end', className, onCloseAutoFocus, children }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild aria-label={label}>{trigger}</M.Trigger>
      <M.Portal>
        {/* Esc closes the menu only, never what it sits in (a modal, a panel). */}
        <M.Content className={cn('sel-content menu-content', className)} align={align} sideOffset={6}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ icon, onSelect, disabled, danger, hint, children }) {
  return (
    <M.Item className={cn('menu-item', danger && 'menu-danger')} disabled={disabled} onSelect={onSelect}>
      {icon && <Mi aria-hidden="true">{icon}</Mi>}
      <span className="menu-tx">{children}</span>
      {hint && <span className="sel-desc">{hint}</span>}
    </M.Item>
  );
}

// A pick-one list inside a Menu (a filter, a sort order). Radix radio items, so
// the checked option is announced; menu.css swaps the ring icon on data-state.
export function MenuRadioGroup({ value, onChange, children }) {
  return <M.RadioGroup value={value} onValueChange={onChange}>{children}</M.RadioGroup>;
}

// `onSelect` (optional) is radix's: e.preventDefault() in it keeps the menu open.
export function MenuRadio({ value, onSelect, children }) {
  return (
    <M.RadioItem className="menu-item menu-radio" value={value} onSelect={onSelect}>
      <Mi aria-hidden="true" className="menu-off">radio_button_unchecked</Mi>
      <Mi aria-hidden="true" className="menu-on">radio_button_checked</Mi>
      <span className="menu-tx">{children}</span>
    </M.RadioItem>
  );
}

// A pick-one item that marks the checked option with a small dot instead of a
// ring, for compact pickers (the phone Home's date menu). The dot is radix's
// ItemIndicator, so it renders only on the checked item.
export function MenuDotRadio({ value, children }) {
  return (
    <M.RadioItem className="menu-item menu-dot" value={value}>
      <span className="menu-dot-slot" aria-hidden="true">
        <M.ItemIndicator><span className="menu-dot-mark" /></M.ItemIndicator>
      </span>
      <span className="menu-tx">{children}</span>
    </M.RadioItem>
  );
}

export const MenuSep = () => <M.Separator className="menu-sep" />;
export const MenuLabel = ({ children }) => <M.Label className="sel-header">{children}</M.Label>;
