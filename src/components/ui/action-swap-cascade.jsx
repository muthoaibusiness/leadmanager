// beui.dev/components/motion/action-swap — Cascade preset: the old label's
// letters drop away as the new ones land, left to right. Plain-JSX port of the
// beui component (types live in ./action-swap-cascade-utils/action-swap.jsx).

import {
  ActionSwapButton,
  ActionSwapIcon,
  ActionSwapText,
} from './action-swap-cascade-utils/action-swap.jsx';

export function ActionSwapCascadeButton(props) {
  return <ActionSwapButton {...props} animation="cascade" />;
}

export function ActionSwapCascadeText(props) {
  return <ActionSwapText {...props} animation="cascade" />;
}

export function ActionSwapCascadeIcon(props) {
  return <ActionSwapIcon {...props} animation="cascade" />;
}

export default ActionSwapCascadeButton;
