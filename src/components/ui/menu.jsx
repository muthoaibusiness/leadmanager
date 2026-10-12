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

export function Menu({ trigger, label, align = 'end', className, children }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild aria-label={label}>{trigger}</M.Trigger>
      <M.Portal>
        {/* Esc closes the menu only, never what it sits in (a modal, a panel). */}
        <M.Content className={cn('sel-content menu-content', className)} align={align} sideOffset={6}
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

export function MenuRadio({ value, children }) {
  return (
    <M.RadioItem className="menu-item menu-radio" value={value}>
      <Mi aria-hidden="true" className="menu-off">radio_button_unchecked</Mi>
      <Mi aria-hidden="true" className="menu-on">radio_button_checked</Mi>
      <span className="menu-tx">{children}</span>
    </M.RadioItem>
  );
}

export const MenuSep = () => <M.Separator className="menu-sep" />;
export const MenuLabel = ({ children }) => <M.Label className="sel-header">{children}</M.Label>;
