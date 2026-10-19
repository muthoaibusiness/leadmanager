import { useRef } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import Mi from '../Mi.jsx';

// The AI Trainer's section tabs as a pill bar. Presentation only: the parent
// owns the active tab, so selection, Back/Forward and reload keep working
// exactly as before (useNavState in AiTrainerView).
//
// ARIA tabs pattern: one tab stop (roving tabindex), arrow keys move and
// select, Home/End jump. Inactive tabs show only their icon; the label stays
// as the accessible name and as a hover title.
const SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 };
const LABEL = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };

export default function AiTrainerPills({ tabs, active, onChange }) {
  const refs = useRef({});
  const select = (i) => {
    const k = tabs[(i + tabs.length) % tabs.length][0];
    onChange(k);
    refs.current[k]?.focus();
    refs.current[k]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const onKeyDown = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); select(i + step); }
    else if (e.key === 'Home') { e.preventDefault(); select(0); }
    else if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1); }
  };
  return (
    // reducedMotion="user": with the OS setting on, the pill snaps instead of sliding.
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="aitrainer-pills">
        <div className="ait-pills" role="tablist" aria-label="AI Trainer sections">
          {tabs.map(([k, label, icon], i) => {
            const on = active === k;
            return (
              <motion.button
                key={k}
                ref={(el) => { refs.current[k] = el; }}
                id={`aitrainer-tab-${k}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`aitrainer-panel-${k}`}
                aria-label={label}
                title={on ? undefined : label}
                tabIndex={on ? 0 : -1}
                className={`ait-pill${on ? ' on' : ''}`}
                layout
                transition={SPRING}
                onClick={() => onChange(k)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                {on && <motion.span layoutId="ait-pill-active" className="ait-pill-bg" transition={SPRING} aria-hidden="true" />}
                <motion.span layout="position" className="ait-pill-ic" aria-hidden="true"><Mi>{icon}</Mi></motion.span>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.span
                      key="label"
                      className="ait-pill-label"
                      aria-hidden="true"
                      initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                      animate={{ width: 'auto', opacity: 1, marginLeft: 8 }}
                      exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                      transition={LABEL}
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
