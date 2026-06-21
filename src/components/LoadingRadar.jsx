// Radar sweep loader — adapted from the shadcn/Tailwind reference to this
// project's plain-JSX + CSS stack (styles in index.css under .lr-*).
export default function LoadingRadar() {
  return (
    <div className="lr">
      <div className="lr-ring" />
      <div className="lr-core" />
      <span className="lr-sweep"><span className="lr-beam" /></span>
    </div>
  );
}
