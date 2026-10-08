import { ensureIcon } from '../lib/iconFont.js';

// Extra props (aria-hidden, title, …) pass straight through to the span.
export default function Mi({ children, className = '', style, ...rest }) {
  ensureIcon(children); // a name outside the subset font loads the full one
  return <span className={`mi${className ? ' ' + className : ''}`} style={style} {...rest}>{children}</span>;
}
