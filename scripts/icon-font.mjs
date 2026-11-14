// Keeps the self-hosted icon font in step with index.html's #icon-font link:
// fetches Google's CSS for that exact subset (a Chrome UA gets the woff2 build)
// and saves the file src/index.css serves offline. Run after editing icon_names:
//   node scripts/icon-font.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const href = readFileSync('index.html', 'utf8').match(/id="icon-font" href="([^"]+)"/)?.[1];
if (!href) throw new Error('index.html: no <link id="icon-font">');
const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const css = await (await fetch(href, { headers: { 'User-Agent': ua } })).text();
// Google's subset URLs carry no extension (…/l/font?kit=…); the format() says woff2.
const url = css.match(/url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/)?.[1];
if (!url) throw new Error(`no woff2 in the font CSS:\n${css}`);
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
mkdirSync('public/fonts', { recursive: true });
writeFileSync('public/fonts/material-symbols-rounded.woff2', buf);
console.log(`public/fonts/material-symbols-rounded.woff2: ${(buf.length / 1024).toFixed(0)} KB, ${new URL(href).searchParams.get('icon_names').split(',').length} icons`);
