import { useId, useState } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import './color-emotion-select.css';

// Colour-emotion select (adapted from a shadcn/Tailwind .tsx to this project's
// plain-JSX + CSS stack, like progress.jsx): a radix Select whose options each
// carry a colour and an emoji. The trigger shows the placeholder until a value
// is chosen, then takes on that option's colour. Tailwind utilities replaced
// with .ces-* CSS (theme tokens).
//
//   options       [{ value, label, color, emoji }]
//   value         controlled value ('' or undefined = nothing chosen), or
//   defaultValue  initial value when uncontrolled
//   onChange      (value) => void
//   label         text before the trigger; placeholder shown when empty
//   invalid       error styling + aria-invalid
export function ColorEmotionSelect({ options, label, placeholder, value, defaultValue, onChange, invalid = false, className }) {
  const labelId = useId();
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value !== undefined ? value ?? '' : inner;
  const sel = options.find(o => o.value === current);
  const change = (v) => { if (value === undefined) setInner(v); onChange?.(v); };

  return (
    <div className={cn('ces', className)}>
      {label && <span className="ces-label" id={labelId}>{label}</span>}
      <SelectPrimitive.Root value={current} onValueChange={change}>
        <SelectPrimitive.Trigger
          className={cn('ces-trigger', !sel && 'ces-empty', invalid && 'ces-invalid')}
          style={sel ? { '--ces-color': sel.color } : undefined}
          aria-labelledby={label ? labelId : undefined}
          aria-invalid={invalid || undefined}
        >
          <SelectPrimitive.Value placeholder={<span className="ces-ph">{placeholder}</span>} />
          <SelectPrimitive.Icon className="ces-chev"><ChevronDown size={16} strokeWidth={2.5} /></SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          {/* Esc closes the list only; it must not reach handlers that would
              close whatever the select sits in (a modal, a panel). */}
          <SelectPrimitive.Content className="ces-content" position="popper" sideOffset={6} align="end"
            onEscapeKeyDown={(e) => e.stopPropagation()}>
            <SelectPrimitive.Viewport className="ces-viewport">
              {options.map(o => (
                <SelectPrimitive.Item key={o.value} value={o.value} className="ces-item" style={{ '--ces-color': o.color }}>
                  <span className="ces-dot" aria-hidden="true" />
                  <SelectPrimitive.ItemText>
                    <span className="ces-emoji" aria-hidden="true">{o.emoji}</span>{o.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="ces-check"><Check size={16} strokeWidth={3} /></SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
