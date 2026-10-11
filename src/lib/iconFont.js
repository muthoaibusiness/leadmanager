// The icon font is subset to the names the app ships: `icon_names=` on the
// #icon-font <link> in index.html (~176 KB instead of ~3.1 MB). A name outside
// that list (a project add-on icon an admin typed, or a new icon in code that
// was not added to the list) swaps in the full font once, so it still renders
// as a glyph instead of as its name.
let known;          // Set of subset names; null when the link is not subset
let upgraded = false;

export function ensureIcon(name) {
  if (upgraded || typeof name !== 'string' || !name) return;
  const link = document.getElementById('icon-font');
  if (known === undefined) {
    const list = link ? new URL(link.href).searchParams.get('icon_names') : null;
    known = list ? new Set(list.split(',')) : null;
  }
  if (!known || known.has(name)) return;
  upgraded = true;
  if (import.meta.env.DEV) console.warn(`[icons] "${name}" is not in index.html icon_names; loading the full icon font. Add it to the list.`);
  // A second stylesheet for the same family: the old one keeps rendering the
  // subset glyphs until the full font arrives and takes over.
  queueMicrotask(() => {
    const full = new URL(link.href);
    full.searchParams.delete('icon_names');
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = full.toString();
    document.head.appendChild(l);
  });
}
