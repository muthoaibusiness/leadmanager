import { AvatarGroup, AvatarGroupTooltip } from './ui/avatar-group.jsx';

// The header's own face with AvatarGroup's lift and tooltip. UserMenu loads it
// lazily so motion and the tooltip primitives stay out of the entry chunk, and
// shows the same markup without them until it arrives. `face(tip)` renders the
// button with the tooltip inside it. The tooltip opens below, the header being
// the top edge of the screen; AvatarGroup maps its children, so the one face
// goes in as an array.
export default function HeaderFace({ face, tip }) {
  return (
    <AvatarGroup tooltipProps={{ side: 'bottom', sideOffset: 10 }}>
      {[face(<AvatarGroupTooltip>{tip}</AvatarGroupTooltip>)]}
    </AvatarGroup>
  );
}
