import { ini, avc } from '../lib/helpers.js';

// Shared user avatar — shows the uploaded picture if present, else initials on a
// stable color. `className` carries the size/shape (e.g. agc-av, ui-av, sb-av).
export default function Avatar({ name, avatar, className = '' }) {
  if (avatar) {
    return <img src={avatar} alt={name || ''} className={`${className} av-img`} />;
  }
  return <div className={className} style={{ background: avc(name) }}>{ini(name)}</div>;
}
