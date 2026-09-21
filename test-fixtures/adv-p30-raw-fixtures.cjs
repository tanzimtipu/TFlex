// Raw degenerate MediaBox fixtures (correct xref offsets) for the P30 raster attack.
const fs = require('node:fs');
const path = require('node:path');

function build(mediaBox) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << >> /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const OUT = __dirname;
fs.writeFileSync(path.join(OUT, 'adv-zero-mediabox.pdf'), build('0 0 0 0'));
fs.writeFileSync(path.join(OUT, 'adv-negative-mediabox.pdf'), build('0 0 -100 -100'));
fs.writeFileSync(path.join(OUT, 'adv-huge-mediabox.pdf'), build('0 0 200000 200000'));
console.log('RAW_FIXTURES_WRITTEN');