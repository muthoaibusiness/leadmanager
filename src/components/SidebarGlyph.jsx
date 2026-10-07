// macOS-style "sidebar.left" panel glyph, shared by the sidebar's hide button
// (brand row) and the header's show button. Inline SVG rather than an icon-font
// ligature, so it draws at once instead of waiting on the 3 MB icon font.
export default function SidebarGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="5.4" width="18" height="13.2" rx="3" />
      <path d="M9 5.4v13.2" />
      <path d="M5.4 9h1.2M5.4 12.5h1.2" />
    </svg>
  );
}
