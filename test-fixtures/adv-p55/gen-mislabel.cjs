// Mislabeled-container fixtures for Phase-55 content-sniffing attacks. Copies
// from the existing Phase-55 QA fixtures (read-only) and a couple of hand-built
// packages. Writes only under test-fixtures/adv-p55.
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const OUT = path.resolve(__dirname);
const QA = path.resolve(OUT, '..', 'phase55');
const F = (n) => path.join(OUT, n);

function copy(src, dst) {
  if (!fs.existsSync(src)) { console.log(`MISSING source ${src}`); return; }
  fs.copyFileSync(src, F(dst));
  console.log(`${dst} <- ${path.basename(src)} (${fs.statSync(F(dst)).size} bytes)`);
}

copy(path.join(QA, 'sample.xlsx'), 'wrong-xls-is-xlsx.xls');   // OOXML named .xls
copy(path.join(QA, 'sample.docx'), 'wrong-pptx-is-docx.pptx'); // DOCX named .pptx
copy(path.join(QA, 'sample.pptx'), 'wrong-docx-is-pptx.docx'); // PPTX named .docx
copy(path.join(QA, 'sample.xlsx'), 'wrong-ods-is-xlsx.ods');   // XLSX named .ods
copy(path.join(QA, 'sample.odt'), 'wrong-xlsx-is-odt.xlsx');   // ODT named .xlsx
copy(path.join(QA, 'legacy.doc'), 'wrong-pptx-is-doc.ppt');    // legacy DOC named .ppt

// A DOCX package with word/document.xml but no [Content_Types].xml.
{
  const files = {
    'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>no content types</w:t></w:r></w:p></w:body></w:document>'),
  };
  fs.writeFileSync(F('docx-no-contenttypes.docx'), Buffer.from(zipSync(files, { level: 6 })));
  console.log('docx-no-contenttypes.docx written');
}

console.log('done');
