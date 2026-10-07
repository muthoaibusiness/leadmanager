// Extra props (aria-hidden, title, …) pass straight through to the span.
export default function Mi({ children, className = '', style, ...rest }) {
  return <span className={`mi${className ? ' ' + className : ''}`} style={style} {...rest}>{children}</span>;
}
