// Builds the Mela invitation card as a one-page PDF (page = the card, no margins) from the card image.
//   node scripts/mela-card-pdf.mjs [image-url] [out.pdf]     (defaults: the live card, public/mela-invitation.pdf)
import { jsPDF } from 'jspdf';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'https://i.postimg.cc/XYV8ypwm/invitation-card-citizen-2.png';
const out = process.argv[3] || 'public/mela-invitation.pdf';
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
if (buf.readUInt32BE(1) !== 0x504e470d) throw new Error('not a PNG: ' + url);
const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);   // IHDR
const pdf = new jsPDF({ unit: 'px', format: [w, h], orientation: w > h ? 'l' : 'p', compress: true });
pdf.addImage('data:image/png;base64,' + buf.toString('base64'), 'PNG', 0, 0, w, h);
writeFileSync(out, Buffer.from(pdf.output('arraybuffer')));
console.log(`${out}: ${w}x${h}px, ${(Buffer.byteLength(Buffer.from(pdf.output('arraybuffer'))) / 1024).toFixed(0)} KB`);
