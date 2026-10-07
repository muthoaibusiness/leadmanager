// beui.dev/components/motion/action-swap — the base the Cascade button wraps.
// Ported from the beui registry source to this project's plain-JSX + CSS
// stack (like ui/card.jsx): types are JSDoc, `motion/react` as in the
// original, and the Tailwind utilities are real CSS (.asw* in index.css) on
// the app's theme tokens. Behaviour and motion values are unchanged.

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from '../../../lib/ease.js';
import { cn } from '../../../lib/utils.js';

/**
 * @typedef {object} ActionSwapItem
 * @property {string} id
 * @property {import('react').ReactNode} label
 * @property {import('react').ReactNode} [icon]
 * @property {string} [ariaLabel]
 *
 * @typedef {'primary'|'secondary'|'outline'|'ghost'} ActionSwapButtonVariant
 * @typedef {'sm'|'md'|'lg'|'icon'} ActionSwapButtonSize
 * @typedef {'blur'|'roll'|'cascade'} ActionSwapAnimation
 *
 * ActionSwapButtonProps: motion.button props plus
 *   items, value?, defaultValue?, onValueChange?(value, item), variant?, size?,
 *   animation?, iconOnly?, cycle?
 * ActionSwapTextProps / ActionSwapIconProps: { value, children, animation?, className? }
 */

const BLUR_TRANSITION = { duration: 0.2, ease: 'easeInOut' };
const ROLL_TRANSITION = SPRING_SWAP;
const ROLL_EXIT_TRANSITION = { duration: 0.14, ease: EASE_OUT };
const SWAP_BLUR = 'blur(8px)';
const ROLL_BLUR = 'blur(3px)';

// Cascade rolls the label one letter at a time, left to right. The leaving
// and landing strings overlap as independent layers (no shared cells), so
// proportional glyph widths never jitter. Exits cascade at half the enter
// stagger so the tail of the old label lingers briefly.
const CASCADE_STAGGER = 0.025;

const CASCADE_LETTER_VARIANTS = {
  initial: { opacity: 0, y: '105%', filter: ROLL_BLUR },
  animate: (delay = 0) => ({
    opacity: 1,
    y: '0%',
    filter: 'blur(0px)',
    transition: { ...SPRING_SWAP, delay },
  }),
  exit: (delay = 0) => ({
    opacity: 0,
    y: '-105%',
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};

const TEXT_VARIANTS = {
  blur: {
    initial: { opacity: 0, scale: 0.94, filter: SWAP_BLUR },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: BLUR_TRANSITION },
    exit: { opacity: 0, scale: 0.94, filter: SWAP_BLUR, transition: BLUR_TRANSITION },
  },
  roll: {
    initial: { opacity: 0, y: '90%', filter: ROLL_BLUR },
    animate: { opacity: 1, y: '0%', filter: 'blur(0px)', transition: ROLL_TRANSITION },
    exit: { opacity: 0, y: '-90%', filter: ROLL_BLUR, transition: ROLL_EXIT_TRANSITION },
  },
};

const ICON_VARIANTS = {
  blur: {
    initial: { opacity: 0, scale: 0.25, filter: SWAP_BLUR },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: BLUR_TRANSITION },
    exit: { opacity: 0, scale: 0.25, filter: SWAP_BLUR, transition: BLUR_TRANSITION },
  },
  roll: {
    initial: { opacity: 0, y: 12, filter: ROLL_BLUR },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: ROLL_TRANSITION },
    exit: { opacity: 0, y: -12, filter: ROLL_BLUR, transition: ROLL_EXIT_TRANSITION },
  },
};

const VARIANT_CLASS = {
  primary: 'asw-primary',
  secondary: 'asw-secondary',
  outline: 'asw-outline',
  ghost: 'asw-ghost',
};

const SIZE_CLASS = {
  sm: 'asw-sm',
  md: 'asw-md',
  lg: 'asw-lg',
  icon: 'asw-icon-btn',
};

export function ActionSwapText({ value, children, animation = 'blur', className }) {
  const reduce = useReducedMotion();

  // Cascade needs a plain string to split into letters; non-string content
  // and reduced motion fall back to the closest single-element animation.
  const label = typeof children === 'string' ? children : null;
  const cascade = animation === 'cascade' && label !== null && !reduce;
  const coreAnimation = animation === 'cascade' ? 'roll' : animation;

  return (
    <span
      className={cn('asw-text', className)}
      style={{ clipPath: 'inset(0 -999px)', WebkitClipPath: 'inset(0 -999px)' }}
    >
      <span aria-hidden className="asw-measure">
        {cascade
          ? label.split('').map((char, index) => (
              // position is the slot identity
              <span key={index} className="asw-ch">{char}</span>
            ))
          : children}
      </span>
      {cascade ? (
        <>
          {/* Letters are decorative fragments; readers get the whole label. */}
          <span className="asw-sr">{label}</span>
          <AnimatePresence initial={false}>
            <motion.span
              key={`cascade-${value}`}
              aria-hidden
              initial="initial"
              animate="animate"
              exit="exit"
              className="asw-layer asw-pre"
            >
              {label.split('').map((char, i) => (
                // position is the slot identity — the letter at a position is exactly what rolls
                <motion.span
                  key={i}
                  custom={i * CASCADE_STAGGER}
                  variants={CASCADE_LETTER_VARIANTS}
                  className="asw-ch asw-will"
                >
                  {char}
                </motion.span>
              ))}
            </motion.span>
          </AnimatePresence>
        </>
      ) : (
        <AnimatePresence initial={false}>
          <motion.span
            key={`${animation}-${value}`}
            variants={TEXT_VARIANTS[coreAnimation]}
            initial={reduce ? false : 'initial'}
            animate={reduce ? { opacity: 1, filter: 'blur(0px)', scale: 1, y: 0 } : 'animate'}
            exit={reduce ? undefined : 'exit'}
            // Truncation lives on the layer that holds the text — the layer
            // moves as a whole, so clipping it never eats the roll.
            className="asw-layer asw-trunc asw-will"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
}

export function ActionSwapIcon({ value, children, animation = 'blur', className }) {
  const reduce = useReducedMotion();
  // Icons are single elements — cascade maps to its closest motion, roll.
  const coreAnimation = animation === 'cascade' ? 'roll' : animation;

  return (
    <span className={cn('asw-icon', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={`${animation}-${value}`}
          aria-hidden
          variants={ICON_VARIANTS[coreAnimation]}
          initial={reduce ? false : 'initial'}
          animate={reduce ? { opacity: 1, filter: 'blur(0px)', scale: 1, y: 0 } : 'animate'}
          exit={reduce ? undefined : 'exit'}
          className="asw-icon-in asw-will"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ActionSwapButton({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = 'secondary',
  size = 'md',
  animation = 'blur',
  iconOnly = size === 'icon',
  cycle = true,
  className,
  disabled,
  onClick,
  ...rest
}) {
  const reduce = useReducedMotion();
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.id);
  const currentValue = value ?? internalValue;
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === currentValue));
  const activeItem = items[activeIndex] ?? items[0];
  const hasIcon = items.some((item) => item.icon);
  const nextItem = cycle && items.length > 0 ? items[(activeIndex + 1) % items.length] : undefined;

  if (!activeItem) return null;

  const accessibleLabel = activeItem.ariaLabel ?? (iconOnly && typeof activeItem.label === 'string' ? activeItem.label : undefined);

  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      transition={SPRING_PRESS}
      className={cn('asw-btn', VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      aria-label={accessibleLabel}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || !cycle || !nextItem) return;
        if (value === undefined) setInternalValue(nextItem.id);
        onValueChange?.(nextItem.id, nextItem);
      }}
      {...rest}
    >
      {hasIcon ? (
        <ActionSwapIcon value={activeItem.id} animation={animation} className="asw-icon-16">
          {activeItem.icon ?? null}
        </ActionSwapIcon>
      ) : null}
      {!iconOnly ? (
        <ActionSwapText value={activeItem.id} animation={animation}>
          {activeItem.label}
        </ActionSwapText>
      ) : null}
    </motion.button>
  );
}
