// Pure-CSS background (grid + radial glow), adapted from a shadcn/Tailwind
// snippet to this project's plain-JSX + CSS stack. No deps.
// variant="light" → white grid + purple glow (original `Component`)
// variant="dark"  → slate-950 + radial glow (original demo) + faint grid
// Fills its positioned parent (absolute inset:0).
export function Component({ variant = 'dark', className = '' }) {
  return (
    <div className={`bgsnip bgsnip-${variant} ${className}`}>
      <div className="bgsnip-glow" />
    </div>
  );
}

export default Component;
