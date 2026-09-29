// Truncations of the QA Phase-55 fixtures at several offsets, for all five
// office formats. Writes under test-fixtures/adv-p55.
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve(__dirname);
const QA = path.resolve(OUT, '..', 'phase55');
const F = (n) => path.join(OUT, n);

const specs = [
  ['sample.docx', 'docx'],
  ['sample.odt', 'odt'],
  ['sample.xlsx', 'xlsx'],
  ['sample.pptx', 'pptx'],
  ['legacy.doc', 'doc'],
  ['legacy.ppt', 'ppt'],
];

for (const [src, ext] of specs) {
  const p = path.join(QA, src);
  if (!fs.existsSync(p)) { console.log(`MISSING ${src}`); continue; }
  const buf = fs.readFileSync(p);
  for (const frac of [0.25, 0.5, 0.75, 0.95]) {
    const cut = Math.max(1, Math.floor(buf.length * frac));
    fs.writeFileSync(F(`trunc-${ext}-${Math.round(frac * 100)}.${ext}`), buf.subarray(0, cut));
  }
  console.log(`${ext}: ${buf.length} bytes -> 4 truncations`);
}
console.log('done');
