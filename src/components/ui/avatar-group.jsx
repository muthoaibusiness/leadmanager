// animate-ui AvatarGroup — an overlapping row of avatars; the hovered (or
// tapped) one springs up and shows its tooltip.
//
// Adapted to this project's plain-JSX + CSS stack (like ui/card.jsx): types
// live in the JSDoc below, the Tailwind utilities are real CSS (.ag* in
// index.css), and the tooltip comes from ./avatar-group-utils/tooltip.jsx.
//
// @example
// <AvatarGroup invertOverlap tooltipProps={{ side: 'bottom', sideOffset: 10 }}>
//   {people.map(p => (
//     <button key={p.id} className="ag-av">{p.initials}<AvatarGroupTooltip>{p.name}</AvatarGroupTooltip></button>
//   ))}
// </AvatarGroup>

import { Children } from 'react';
import { motion } from 'motion/react';

import { cn } from '../../lib/utils.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './avatar-group-utils/tooltip.jsx';

/**
 * @typedef {object} AvatarGroupProps
 * @property {import('react').ReactElement[]} children  One element per avatar (an array)
 * @property {object} [transition]  Lift spring. Default { type: 'spring', stiffness: 300, damping: 17 }
 * @property {boolean} [invertOverlap]  First avatar on top instead of last. Default false
 * @property {string|number} [translate]  Hover lift (y). Default '-30%'
 * @property {object} [tooltipProps]  Passed to each Tooltip. Default { side: 'top', sideOffset: 24 }
 * @property {string} [className]
 */

function AvatarContainer({
  children,
  zIndex,
  transition,
  translate,
  ...props
}) {
  return (
    <Tooltip {...props}>
      <TooltipTrigger>
        <motion.div
          data-slot="avatar-container"
          initial="initial"
          whileHover="hover"
          whileTap="hover"
          className="ag-slot"
          style={{ zIndex }}
        >
          <motion.div
            variants={{
              initial: { y: 0 },
              hover: { y: translate },
            }}
            transition={transition}
          >
            {children}
          </motion.div>
        </motion.div>
      </TooltipTrigger>
    </Tooltip>
  );
}

function AvatarGroupTooltip(props) {
  return <TooltipContent {...props} />;
}

/** @param {AvatarGroupProps & { ref?: any }} props */
function AvatarGroup({
  ref,
  children,
  className,
  transition = { type: 'spring', stiffness: 300, damping: 17 },
  invertOverlap = false,
  translate = '-30%',
  tooltipProps = { side: 'top', sideOffset: 24 },
  ...props
}) {
  return (
    <TooltipProvider openDelay={0} closeDelay={0}>
      <div
        ref={ref}
        data-slot="avatar-group"
        className={cn('ag', className)}
        {...props}
      >
        {children?.map((child, index) => (
          <AvatarContainer
            key={index}
            zIndex={
              invertOverlap ? Children.count(children) - index : index
            }
            transition={transition}
            translate={translate}
            {...tooltipProps}
          >
            {child}
          </AvatarContainer>
        ))}
      </div>
    </TooltipProvider>
  );
}

export { AvatarGroup, AvatarGroupTooltip };

export default AvatarGroup;
