// Loader — a monochrome ring loader with a title and subtitle: four masked
// conic-gradient rings (two clockwise, one counter-clockwise, a thin accent
// ring) inside a slow breathing scale, the text fading in under it.
//
// Adapted to this project's plain-JSX + CSS stack (like ui/avatar-group.jsx):
// the props are in the JSDoc below, the Tailwind utilities are real CSS
// (./loader.css), and `cn` is the plain join in lib/utils.js. The original drew
// every ring twice, black and a `dark:` white copy; here each ring is drawn once
// in --ldr-ink (white in the dark theme, black in light, see loader.css), so it
// follows the theme switch with nothing to show or hide. The title is a <p>, not
// an <h1>, since the loader sits inside a page that has its own heading.
//
// @example
// <Loader title="Loading Inventory…" subtitle="Fetching budgets, expenses and statements" />

import { motion } from 'motion/react';

import { cn } from '../../lib/utils.js';
import './loader.css';

/**
 * @typedef {object} LoaderProps
 * @property {string} [title]  Default "Configuring your account..."
 * @property {string} [subtitle]  Default "Please wait while we prepare everything for you"
 * @property {'sm'|'md'|'lg'} [size]  Ring 80 / 128 / 160 px. Default 'md'
 * @property {string} [className]
 * Any other prop goes to the outer <div>.
 */

const EASE = [0.4, 0, 0.6, 1];
const ink = (a = 1) => (a === 1 ? 'rgb(var(--ldr-ink))' : `rgba(var(--ldr-ink), ${a})`);
const ring = (inner, a, b, outer) => `radial-gradient(circle at 50% 50%, transparent ${inner}%, black ${a}%, black ${b}%, transparent ${outer}%)`;

// Outermost first, as in the original: outer shimmer, primary, counter, accent.
const RINGS = [
  { bg: `conic-gradient(from 0deg, transparent 0deg, ${ink()} 90deg, transparent 180deg)`, mask: ring(35, 37, 39, 41), opacity: 0.8, turn: 360, duration: 3, ease: 'linear' },
  { bg: `conic-gradient(from 0deg, transparent 0deg, ${ink()} 120deg, ${ink(0.5)} 240deg, transparent 360deg)`, mask: ring(42, 44, 48, 50), opacity: 0.9, turn: 360, duration: 2.5, ease: EASE },
  { bg: `conic-gradient(from 180deg, transparent 0deg, ${ink(0.6)} 45deg, transparent 90deg)`, mask: ring(52, 54, 56, 58), opacity: 0.35, turn: -360, duration: 4, ease: EASE },
  { bg: `conic-gradient(from 270deg, transparent 0deg, ${ink(0.4)} 20deg, transparent 40deg)`, mask: ring(61, 62, 63, 64), opacity: 0.5, turn: 360, duration: 3.5, ease: 'linear' },
];

/** @param {LoaderProps} props */
export default function Loader({
  title = 'Configuring your account...',
  subtitle = 'Please wait while we prepare everything for you',
  size = 'md',
  className,
  ...props
}) {
  return (
    <div className={cn('ldr', `ldr-${size}`, className)} role="status" aria-live="polite" {...props}>
      <motion.div
        animate={{ scale: [1, 1.02, 1] }}
        className="ldr-rings"
        transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, ease: EASE }}
        aria-hidden="true"
      >
        {RINGS.map((r, i) => (
          <motion.div
            key={i}
            animate={{ rotate: [0, r.turn] }}
            className="ldr-ring"
            style={{ background: r.bg, mask: r.mask, WebkitMask: r.mask, opacity: r.opacity }}
            transition={{ duration: r.duration, repeat: Number.POSITIVE_INFINITY, ease: r.ease }}
          />
        ))}
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="ldr-text"
        initial={{ opacity: 0, y: 12 }}
        transition={{ delay: 0.4, duration: 1, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.p
          animate={{ opacity: 1, y: 0 }}
          className="ldr-title"
          initial={{ opacity: 0, y: 12 }}
          transition={{ delay: 0.6, duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.span
            animate={{ opacity: [0.9, 0.7, 0.9] }}
            transition={{ duration: 3, repeat: Number.POSITIVE_INFINITY, ease: EASE }}
          >
            {title}
          </motion.span>
        </motion.p>

        <motion.p
          animate={{ opacity: 1, y: 0 }}
          className="ldr-sub"
          initial={{ opacity: 0, y: 8 }}
          transition={{ delay: 0.8, duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.span
            animate={{ opacity: [0.6, 0.4, 0.6] }}
            transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, ease: EASE }}
          >
            {subtitle}
          </motion.span>
        </motion.p>
      </motion.div>
    </div>
  );
}
