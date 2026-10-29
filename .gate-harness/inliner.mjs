// Inline the built bundle into one self-contained HTML: the ux-ui gate loads
// pages over file://, where Chrome blocks <script type="module"> and <link
// rel="stylesheet"> fetches (CORS). No external file refs → no CORS.
// Replacement strings with $ sequences must go through a function replacer —
// minified JS is full of `$&`-shaped sequences.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dist = '.gate-harness/dist';
const html = readFileSync(`${dist}/main.html`, 'utf8');
const assets = readdirSync(`${dist}/assets`);
const js = assets.find(f => f.endsWith('.js'));
const css = assets.find(f => f.endsWith('.css'));
// Inline the bundle at the END of <body>: an inline script in <head> runs
// before #root exists and createRoot would get null.
const inline = `<script>(function(){${readFileSync(`${dist}/assets/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script')}})();</script>`;
const out = html
  .replace(/<script type="module"[^>]*><\/script>/, '')
  .replace(/<link rel="stylesheet"[^>]*>/, () =>
    `<style>${readFileSync(`${dist}/assets/${css}`, 'utf8')}</style>`)
  .replace('</body>', () => inline + '</body>');;
writeFileSync(`${dist}/main-inline.html`, out);
console.log('inlined', js, css, '→', `${dist}/main-inline.html`);
