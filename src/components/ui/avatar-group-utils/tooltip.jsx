import { createContext, useContext, useState } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../../lib/utils.js';

// The tooltip AvatarGroup imports (animate-ui's avatar-group-utils/tooltip):
// same exports and props, built on the Radix Tooltip this project already
// ships (radix-ui) plus motion. animate-ui's own version needs
// @floating-ui/react, which is not installed. Radix positions it, flips it
// when there is no room, and keeps a screen-reader copy of the text.
//
//   <TooltipProvider openDelay={0} closeDelay={0}>
//     <Tooltip side="top" sideOffset={24}>
//       <TooltipTrigger>{element that takes a ref}</TooltipTrigger>
//       … <TooltipContent>text</TooltipContent> anywhere inside <Tooltip>
//     </Tooltip>
//   </TooltipProvider>
//
// Props (types live here, as JSDoc):
//   TooltipProps        { side?: 'top'|'right'|'bottom'|'left', sideOffset?, align?, alignOffset?, children }
//   TooltipContentProps { className?, transition?, children }

const TooltipContext = createContext(null);

// closeDelay is accepted for the API; Radix closes as the pointer leaves.
function TooltipProvider({ openDelay = 0, ...props }) {
  return <TooltipPrimitive.Provider delayDuration={openDelay} disableHoverableContent {...props} />;
}

/** @param {{ side?: string, sideOffset?: number, align?: string, alignOffset?: number, children: any }} props */
function Tooltip({ side = 'top', sideOffset = 0, align = 'center', alignOffset = 0, children, ...props }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipContext.Provider value={{ open, side, sideOffset, align, alignOffset }}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen} {...props}>
        {children}
      </TooltipPrimitive.Root>
    </TooltipContext.Provider>
  );
}

// The trigger is the single child itself (it must accept a ref).
function TooltipTrigger(props) {
  return <TooltipPrimitive.Trigger asChild {...props} />;
}

/** @param {{ className?: string, transition?: object, children: any }} props */
function TooltipContent({ className, transition = { type: 'spring', stiffness: 300, damping: 25 }, children, ...props }) {
  const ctx = useContext(TooltipContext);
  return (
    <AnimatePresence>
      {ctx?.open && (
        <TooltipPrimitive.Portal forceMount>
          <TooltipPrimitive.Content forceMount asChild side={ctx.side} sideOffset={ctx.sideOffset}
            align={ctx.align} alignOffset={ctx.alignOffset} {...props}>
            <motion.div data-slot="tooltip-content" className={cn('ag-tip', className)}
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
              transition={transition}>
              {children}
            </motion.div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
