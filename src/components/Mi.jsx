export default function Mi({ children, className = '', style }) {
  return <span className={`mi${className ? ' ' + className : ''}`} style={style}>{children}</span>;
}
